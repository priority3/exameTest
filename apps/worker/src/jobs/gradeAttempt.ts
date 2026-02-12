import type { Job } from "bullmq";
import { DEMO_USER_ID, EVENT_CHANNELS, LlmGradeSchema } from "@exametest/shared";
import { pool } from "../db.js";
import { chatJson, hasOpenAI } from "../llm/openai.js";
import { publishEvent } from "../events.js";

type AttemptRow = {
  id: string;
  paperId: string;
  status: string;
};

type QuestionRow = {
  id: string;
  type: "MCQ" | "SHORT_ANSWER";
  prompt: string;
  options: unknown;
  answerKey: any;
  rubric: any;
  tags: string[];
};

type AnswerRow = {
  questionId: string;
  answerText: string | null;
  answerOptionId: string | null;
};

type CitationChunkRow = {
  chunkId: string;
  text: string;
};

const sumRubric = (rubric: any): number => {
  if (!Array.isArray(rubric)) return 0;
  return rubric.reduce((acc, p) => acc + (typeof p?.points === "number" ? p.points : 0), 0);
};

const upsertWrongItem = async (client: any, params: { userId: string; questionId: string; tags: string[] }) => {
  await client.query(
    `INSERT INTO wrong_items (user_id, question_id, last_wrong_at, wrong_count, weak_tags)
     VALUES ($1, $2, NOW(), 1, $3)
     ON CONFLICT (user_id, question_id)
     DO UPDATE SET last_wrong_at = NOW(), wrong_count = wrong_items.wrong_count + 1, weak_tags = EXCLUDED.weak_tags`,
    [params.userId, params.questionId, JSON.stringify(params.tags)]
  );
};

export const gradeAttempt = async (job: Job<{ attemptId: string }>) => {
  const attemptId = job.data.attemptId;
  await job.log(`gradeAttempt: ${attemptId}`);

  const attemptRes = await pool.query<AttemptRow>(
    `SELECT id, paper_id AS "paperId", status
     FROM attempts
     WHERE id = $1`,
    [attemptId]
  );
  const attempt = attemptRes.rows[0];
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }
  if (attempt.status !== "SUBMITTED") {
    await job.log(`Attempt status is ${attempt.status}, skipping grading.`);
    return;
  }

  const qRes = await pool.query<QuestionRow>(
    `SELECT id, type, prompt, options,
            answer_key AS "answerKey",
            rubric, tags
     FROM questions
     WHERE paper_id = $1
     ORDER BY created_at ASC`,
    [attempt.paperId]
  );

  const ansRes = await pool.query<AnswerRow>(
    `SELECT question_id AS "questionId", answer_text AS "answerText", answer_option_id AS "answerOptionId"
     FROM answers
     WHERE attempt_id = $1`,
    [attemptId]
  );
  const answerByQuestion = new Map(ansRes.rows.map((a) => [a.questionId, a]));

  const grades: Array<{
    questionId: string;
    score: number;
    maxScore: number;
    verdict: unknown;
    feedbackMd: string;
    citations: string[];
    confidence?: number | null;
    isWrong: boolean;
    tags: string[];
  }> = [];

  for (const q of qRes.rows) {
    const answer = answerByQuestion.get(q.id);

    const citationsRes = await pool.query<{ chunkId: string }>(
      `SELECT chunk_id AS "chunkId"
       FROM question_citations
       WHERE question_id = $1`,
      [q.id]
    );
    const citationChunkIds = citationsRes.rows.map((r) => r.chunkId);

    if (q.type === "MCQ") {
      const correct = String(q.answerKey?.correctOptionId ?? "").toUpperCase();
      const got = (answer?.answerOptionId ?? "").toUpperCase();
      const isCorrect = Boolean(correct) && got === correct;

      const rationale = typeof q.answerKey?.rationale === "string" ? q.answerKey.rationale : "";
      const feedback = isCorrect
        ? `正确。\n\n${rationale ? `解析：${rationale}` : ""}`.trim()
        : `错误。正确答案：${correct || "(missing)"}。\n\n${rationale ? `解析：${rationale}` : ""}`.trim();

      grades.push({
        questionId: q.id,
        score: isCorrect ? 1 : 0,
        maxScore: 1,
        verdict: { correct: isCorrect, expected: correct, got },
        feedbackMd: feedback,
        citations: citationChunkIds,
        confidence: 1,
        isWrong: !isCorrect,
        tags: Array.isArray(q.tags) ? q.tags : []
      });
      continue;
    }

    // SHORT_ANSWER
    const rubric = q.rubric ?? [];
    const maxScore = sumRubric(rubric);

    if (!hasOpenAI()) {
      grades.push({
        questionId: q.id,
        score: 0,
        maxScore,
        verdict: { error: "OPENAI_API_KEY missing" },
        feedbackMd: "无法阅卷：未配置 OPENAI_API_KEY（本地开发请在 .env 设置）。",
        citations: citationChunkIds,
        confidence: 0,
        isWrong: true,
        tags: Array.isArray(q.tags) ? q.tags : []
      });
      continue;
    }

    const citeChunkRes = await pool.query<CitationChunkRow>(
      `SELECT qc.chunk_id AS "chunkId", c.text
       FROM question_citations qc
       JOIN chunks c ON c.id = qc.chunk_id
       WHERE qc.question_id = $1
       ORDER BY qc.created_at ASC`,
      [q.id]
    );

    const chunkRefs = citeChunkRes.rows.map((c, idx) => ({
      ref: `c${idx + 1}`,
      chunkId: c.chunkId,
      text: c.text.length > 1200 ? `${c.text.slice(0, 1200)}…` : c.text
    }));
    const refToChunkId = new Map(chunkRefs.map((c) => [c.ref, c.chunkId]));

    const system = [
      "You are a strict exam grader AND a helpful tutor.",
      "Only use the provided reference chunks as evidence (do not use outside knowledge).",
      "Grade by rubric points.",
      "Be concrete: point to evidence and include chunk refs like (c1).",
      "Return JSON only."
    ].join("\n");

    const user = JSON.stringify(
      {
        prompt: q.prompt,
        referenceAnswer: q.answerKey?.referenceAnswer ?? "",
        rubric,
        maxScore,
        studentAnswer: answer?.answerText ?? "",
        referenceChunks: chunkRefs.map((c) => ({ ref: c.ref, text: c.text }))
      },
      null,
      2
    );

    const grade = await chatJson({
      system,
      user: [
        "Grade the studentAnswer based on the rubric and referenceChunks in the input JSON.",
        "",
        "You MUST output a JSON object with EXACTLY these keys:",
        "- score (number)",
        "- maxScore (number)",
        "- hitPoints (array of { rubricPointId, comment })",
        "- missingPoints (array of strings)",
        "- misconceptions (array of strings)",
        "- actionableSuggestions (array of strings)",
        "- suggestedAnswer (string)",
        "- feedbackMd (string, markdown)",
        "- recommendedReviewChunkIds (array of chunk refs like c1,c2...)",
        "- confidence (number between 0 and 1)",
        "",
        "Rules:",
        `- score must be between 0 and maxScore (maxScore=${maxScore}).`,
        "- Use the same language as the question prompt.",
        "- hitPoints: include 1+ items when score > 0; each comment should mention what the student did right and cite evidence (c#).",
        "- missingPoints: when score < maxScore, include 1+ items; each item should start with the rubric id like `p2:` and explain what's missing + how to fix it, citing evidence (c#).",
        "- misconceptions: list specific misunderstandings (if none, return empty array).",
        "- actionableSuggestions: 3-6 concrete next steps the student can do, each should cite evidence (c#).",
        "- suggestedAnswer: a short corrected answer (1-4 sentences) that would get full points; must be supported by referenceChunks.",
        "- recommendedReviewChunkIds: pick 1-3 refs that best support the missingPoints (empty only if full score).",
        "- feedbackMd: write like a teacher. Include sections:",
        "  - Overall (1-2 sentences)",
        "  - What you did well (bullets)",
        "  - What to improve (bullets)",
        "  - Suggested corrected answer",
        "  - Evidence to review (list chunk refs)",
        "Return JSON only."
      ].join("\n") + `\n\nINPUT_JSON:\n${user}\n`,
      schema: LlmGradeSchema,
      temperature: 0.1
    });

    const safeScore = Math.max(0, Math.min(maxScore, grade.score));
    const hitPointIds = new Set(
      (grade.hitPoints ?? [])
        .map((p) => (typeof p?.rubricPointId === "string" ? p.rubricPointId : ""))
        .filter(Boolean)
    );

    const fallbackMissingPoints =
      safeScore < maxScore
        ? (Array.isArray(rubric) ? rubric : [])
            .filter((p: any) => typeof p?.id === "string" && !hitPointIds.has(String(p.id)))
            .map((p: any) => `${p.id}: ${typeof p?.criteria === "string" ? p.criteria : "Missing rubric point."}`)
        : [];

    const missingPoints =
      Array.isArray(grade.missingPoints) && grade.missingPoints.length > 0 ? grade.missingPoints : fallbackMissingPoints;

    const misconceptions = Array.isArray(grade.misconceptions) ? grade.misconceptions : [];

    const actionableSuggestionsRaw = Array.isArray((grade as any).actionableSuggestions)
      ? (grade as any).actionableSuggestions
      : [];
    const actionableSuggestions =
      actionableSuggestionsRaw.length > 0 ? actionableSuggestionsRaw : missingPoints.slice(0, 6);

    const suggestedAnswer =
      typeof (grade as any).suggestedAnswer === "string" && (grade as any).suggestedAnswer.trim()
        ? (grade as any).suggestedAnswer.trim()
        : typeof q.answerKey?.referenceAnswer === "string" && q.answerKey.referenceAnswer.trim()
          ? q.answerKey.referenceAnswer.trim()
          : null;

    const recommendedChunkIds = (grade.recommendedReviewChunkIds ?? [])
      .map((ref) => refToChunkId.get(ref) ?? null)
      .filter((x): x is string => Boolean(x));

    grades.push({
      questionId: q.id,
      score: safeScore,
      maxScore,
      verdict: {
        hitPoints: grade.hitPoints,
        missingPoints,
        misconceptions,
        actionableSuggestions,
        suggestedAnswer,
        recommendedReviewChunkIds: recommendedChunkIds
      },
      feedbackMd: grade.feedbackMd,
      citations: citationChunkIds,
      confidence: grade.confidence ?? null,
      isWrong: safeScore < maxScore,
      tags: Array.isArray(q.tags) ? q.tags : []
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM grades WHERE attempt_id = $1`, [attemptId]);

    for (const g of grades) {
      await client.query(
        `INSERT INTO grades (attempt_id, question_id, score, max_score, verdict, feedback_md, citations, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET score = EXCLUDED.score, max_score = EXCLUDED.max_score, verdict = EXCLUDED.verdict, feedback_md = EXCLUDED.feedback_md, citations = EXCLUDED.citations, confidence = EXCLUDED.confidence`,
        [
          attemptId,
          g.questionId,
          g.score,
          g.maxScore,
          JSON.stringify(g.verdict),
          g.feedbackMd,
          JSON.stringify(g.citations),
          g.confidence ?? null
        ]
      );

      if (g.isWrong) {
        // NOTE: MVP uses a single demo user id; if you add auth, pass attempt.user_id.
        await upsertWrongItem(client, { userId: DEMO_USER_ID, questionId: g.questionId, tags: g.tags });
      }
    }

    await client.query(
      `UPDATE attempts
       SET status = 'GRADED', graded_at = NOW()
       WHERE id = $1`,
      [attemptId]
    );

    await client.query("COMMIT");
    await publishEvent(EVENT_CHANNELS.attempt(attemptId), {
      type: "attempt",
      attemptId,
      status: "GRADED"
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
};
