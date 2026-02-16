import type { Job } from "bullmq";
import { EVENT_CHANNELS, LlmPaperSchema } from "@exametest/shared";
import { pool } from "../db.js";
import { chatJson, hasOpenAI } from "../llm/openai.js";
import { publishEvent } from "../events.js";

type PaperRow = {
  id: string;
  sourceId: string;
  title: string;
  config: unknown;
};

type ChunkRow = {
  id: string;
  text: string;
};

const truncate = (s: string, max = 1200): string => {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
};

const pickEvenly = <T>(items: T[], limit: number): T[] => {
  if (items.length <= limit) return items;
  const step = items.length / limit;
  const picked: T[] = [];
  for (let i = 0; i < limit; i += 1) {
    picked.push(items[Math.floor(i * step)]!);
  }
  return picked;
};

export const generatePaper = async (job: Job<{ paperId: string }>) => {
  const paperId = job.data.paperId;
  await job.log(`generatePaper: ${paperId}`);

  if (!hasOpenAI()) {
    await pool.query(
      `UPDATE papers
       SET status = 'FAILED', error = $2
       WHERE id = $1`,
      [paperId, "OPENAI_API_KEY is not set. Paper generation requires OpenAI."]
    );
    await publishEvent(EVENT_CHANNELS.paper(paperId), {
      type: "paper",
      paperId,
      status: "FAILED",
      error: "OPENAI_API_KEY is not set. Paper generation requires OpenAI."
    });
    return;
  }

  const paperRes = await pool.query<PaperRow>(
    `SELECT id, source_id AS "sourceId", title, config
     FROM papers
     WHERE id = $1`,
    [paperId]
  );
  const paper = paperRes.rows[0];
  if (!paper) {
    throw new Error(`Paper not found: ${paperId}`);
  }

  const chunkRes = await pool.query<ChunkRow>(
    `SELECT c.id, c.text
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE d.source_id = $1
     ORDER BY d.created_at ASC, c.chunk_index ASC
     LIMIT 400`,
    [paper.sourceId]
  );

  if (chunkRes.rowCount === 0) {
    await pool.query(
      `UPDATE papers
       SET status = 'FAILED', error = $2
       WHERE id = $1`,
      [paperId, "No chunks found for this source. Is the source READY?"]
    );
    await publishEvent(EVENT_CHANNELS.paper(paperId), {
      type: "paper",
      paperId,
      status: "FAILED",
      error: "No chunks found for this source. Is the source READY?"
    });
    return;
  }

  const candidates = pickEvenly(chunkRes.rows, 24).map((c, idx) => ({
    ref: `c${idx + 1}`,
    chunkId: c.id,
    text: truncate(c.text)
  }));

  const refToChunkId = new Map(candidates.map((c) => [c.ref, c.chunkId]));

  const config = (paper.config ?? {}) as Record<string, unknown>;

  const system = [
    "You generate exam papers from provided study material excerpts (chunks).",
    "You MUST output a single JSON object, and nothing else.",
    "Every question MUST include citations referencing ONLY the provided chunk refs.",
    "Do not invent chunk ids/refs; use the exact refs from the list.",
    "Keep the exam answerable solely from the provided chunks."
  ].join("\n");

  const user = JSON.stringify(
    {
      paperTitle: paper.title,
      config,
      chunks: candidates.map((c) => ({ ref: c.ref, text: c.text }))
    },
    null,
    2
  );

  let llmPaper: unknown;
  try {
    llmPaper = await chatJson({
      system,
      user: [
        "Generate a paper according to the input JSON.",
        "Output must match the schema fields:",
        "- paperTitle: string",
        "- questions: array of MCQ or SHORT_ANSWER",
        "MCQ rules:",
        "- 4 options A-D",
        "- exactly one correct answerKey (A/B/C/D)",
        "- rationale MUST include 3 parts:",
        "  1) Why the correct option is right (cite source evidence)",
        "  2) Why each wrong option is wrong (briefly, 1 sentence each)",
        "  3) A short takeaway that helps the student remember the key concept",
        "SHORT_ANSWER rules:",
        "- referenceAnswer: short but complete",
        "- rubric: 3-6 points, with ids like p1,p2,... and points sum ~5-10",
        "Citations rules:",
        "- citations[].chunkId must be one of the provided chunk refs (e.g. c1, c2...)",
        "- citations[].snippet (optional) should be <= 2 sentences",
        "Return JSON only."
      ].join("\n") + `\n\nINPUT_JSON:\n${user}\n`,
      schema: LlmPaperSchema,
      temperature: 0.6
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE papers
       SET status = 'FAILED', error = $2
       WHERE id = $1`,
      [paperId, msg]
    );
    await publishEvent(EVENT_CHANNELS.paper(paperId), {
      type: "paper",
      paperId,
      status: "FAILED",
      error: msg
    });
    throw err;
  }

  const parsedPaper = LlmPaperSchema.parse(llmPaper);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM questions WHERE paper_id = $1`, [paperId]);

    for (const q of parsedPaper.questions) {
      const qRes = await client.query<{ id: string }>(
        `INSERT INTO questions (paper_id, type, difficulty, prompt, options, answer_key, rubric, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          paperId,
          q.type,
          q.difficulty,
          q.prompt,
          q.type === "MCQ" ? JSON.stringify(q.options) : null,
          JSON.stringify(
            q.type === "MCQ"
              ? { correctOptionId: q.answerKey, rationale: q.rationale }
              : { referenceAnswer: q.referenceAnswer }
          ),
          JSON.stringify(q.type === "SHORT_ANSWER" ? q.rubric : []),
          JSON.stringify(q.tags)
        ]
      );

      const questionId = qRes.rows[0]!.id;

      for (const c of q.citations) {
        const chunkId = refToChunkId.get(c.chunkId);
        if (!chunkId) {
          throw new Error(`LLM returned unknown chunk ref: ${c.chunkId}`);
        }
        await client.query(
          `INSERT INTO question_citations (question_id, chunk_id, snippet, relevance)
           VALUES ($1, $2, $3, NULL)`,
          [questionId, chunkId, c.snippet ?? null]
        );
      }
    }

    await client.query(`UPDATE papers SET status = 'READY', error = NULL WHERE id = $1`, [paperId]);
    await client.query("COMMIT");
    await publishEvent(EVENT_CHANNELS.paper(paperId), {
      type: "paper",
      paperId,
      status: "READY"
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE papers
       SET status = 'FAILED', error = $2
       WHERE id = $1`,
      [paperId, msg]
    );
    await publishEvent(EVENT_CHANNELS.paper(paperId), {
      type: "paper",
      paperId,
      status: "FAILED",
      error: msg
    });

    throw err;
  } finally {
    client.release();
  }
};
