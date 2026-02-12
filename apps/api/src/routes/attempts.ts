import type { FastifyInstance } from "fastify";
import {
  CreateAttemptRequestSchema,
  DEMO_USER_ID,
  EVENT_CHANNELS,
  JOB_NAMES,
  SubmitAttemptRequestSchema
} from "@exametest/shared";
import { pool, ensureDemoUser } from "../db.js";
import { queue } from "../queue.js";
import { subscribeChannel } from "../realtime.js";
import { initSse, sseComment, sseSend } from "../sse.js";

export const registerAttemptRoutes = async (app: FastifyInstance) => {
  app.get("/attempts", async (req) => {
    const limitRaw = (req.query as any)?.limit;
    const limitNum = typeof limitRaw === "string" ? Number(limitRaw) : Number(limitRaw ?? 50);
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(200, Math.floor(limitNum))) : 50;

    const res = await pool.query(
      `SELECT a.id,
              a.paper_id AS "paperId",
              p.title AS "paperTitle",
              a.status,
              a.error,
              a.started_at AS "startedAt",
              a.submitted_at AS "submittedAt",
              a.graded_at AS "gradedAt",
              (SELECT COUNT(*) FROM questions q WHERE q.paper_id = a.paper_id)::int AS "totalQuestions",
              (SELECT COUNT(*) FROM grades g WHERE g.attempt_id = a.id)::int AS "gradedQuestions",
              (SELECT COALESCE(SUM(g.score), 0) FROM grades g WHERE g.attempt_id = a.id)::float AS "score",
              (SELECT COALESCE(SUM(g.max_score), 0) FROM grades g WHERE g.attempt_id = a.id)::float AS "maxScore"
       FROM attempts a
       JOIN papers p ON p.id = a.paper_id
       WHERE a.user_id = $1
       ORDER BY a.started_at DESC
       LIMIT $2`,
      [DEMO_USER_ID, limit]
    );

    return { items: res.rows };
  });

  app.post("/attempts", async (req, reply) => {
    const parsed = CreateAttemptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    await ensureDemoUser();
    const { paperId } = parsed.data;

    const paperRes = await pool.query(`SELECT id, status FROM papers WHERE id = $1 AND user_id = $2`, [paperId, DEMO_USER_ID]);
    const paper = paperRes.rows[0];
    if (!paper) {
      return reply.status(404).send({ error: "Paper not found" });
    }
    if (paper.status !== "READY") {
      return reply.status(409).send({ error: "Paper not ready", status: paper.status });
    }

    const attemptRes = await pool.query<{ id: string }>(
      `INSERT INTO attempts (paper_id, user_id, status)
       VALUES ($1, $2, 'IN_PROGRESS')
       RETURNING id`,
      [paperId, DEMO_USER_ID]
    );

    const attemptId = attemptRes.rows[0]?.id;
    if (!attemptId) {
      throw new Error("Failed to create attempt");
    }

    return reply.status(201).send({ id: attemptId, status: "IN_PROGRESS" });
  });

  app.get("/attempts/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const attemptRes = await pool.query(
      `SELECT id, paper_id AS "paperId", status, error, started_at AS "startedAt", submitted_at AS "submittedAt", graded_at AS "gradedAt"
       FROM attempts
       WHERE id = $1 AND user_id = $2`,
      [id, DEMO_USER_ID]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt) {
      return reply.status(404).send({ error: "Not found" });
    }

    const paperRes = await pool.query(
      `SELECT id, title, status
       FROM papers
       WHERE id = $1 AND user_id = $2`,
      [attempt.paperId, DEMO_USER_ID]
    );
    const paper = paperRes.rows[0];
    if (!paper) {
      return reply.status(500).send({ error: "Paper missing" });
    }

    const qRes = await pool.query(
      `SELECT id, type, difficulty, prompt, options, tags
       FROM questions
       WHERE paper_id = $1
       ORDER BY created_at ASC`,
      [attempt.paperId]
    );

    const ansRes = await pool.query(
      `SELECT question_id AS "questionId", answer_text AS "answerText", answer_option_id AS "answerOptionId"
       FROM answers
       WHERE attempt_id = $1`,
      [id]
    );

    return { attempt, paper, questions: qRes.rows, answers: ansRes.rows };
  });

  app.post("/attempts/:id/submit", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const parsed = SubmitAttemptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const attemptRes = await pool.query<{ status: string; paperId: string }>(
      `SELECT status, paper_id AS "paperId"
       FROM attempts
       WHERE id = $1 AND user_id = $2`,
      [id, DEMO_USER_ID]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt) {
      return reply.status(404).send({ error: "Not found" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: "Attempt not in progress", status: attempt.status });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const a of parsed.data.answers) {
        await client.query(
          `INSERT INTO answers (attempt_id, question_id, answer_text, answer_option_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (attempt_id, question_id)
           DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_option_id = EXCLUDED.answer_option_id`,
          [id, a.questionId, a.text ?? null, a.optionId ?? null]
        );
      }

      await client.query(
        `UPDATE attempts
         SET status = 'SUBMITTED', submitted_at = NOW(), error = NULL
         WHERE id = $1 AND user_id = $2`,
        [id, DEMO_USER_ID]
      );

      await client.query("COMMIT");
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

    await queue.add(JOB_NAMES.gradeAttempt, { attemptId: id }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });

    return { id, status: "SUBMITTED" };
  });

  app.get("/attempts/:id/result", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const sumRubric = (rubric: any): number => {
      if (!Array.isArray(rubric)) return 0;
      return rubric.reduce((acc, p) => acc + (typeof p?.points === "number" ? p.points : 0), 0);
    };

    const attemptRes = await pool.query(
      `SELECT id, paper_id AS "paperId", status, error, started_at AS "startedAt", submitted_at AS "submittedAt", graded_at AS "gradedAt"
       FROM attempts
       WHERE id = $1 AND user_id = $2`,
      [id, DEMO_USER_ID]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt) {
      return reply.status(404).send({ error: "Not found" });
    }

    if (attempt.status === "IN_PROGRESS") {
      return reply.status(409).send({ error: "Attempt not submitted", status: attempt.status });
    }

    const qRes = await pool.query(
      `SELECT id, type, prompt, options,
              answer_key AS "answerKey",
              rubric, tags
       FROM questions
       WHERE paper_id = $1
       ORDER BY created_at ASC`,
      [attempt.paperId]
    );

    const ansRes = await pool.query(
      `SELECT question_id AS "questionId", answer_text AS "answerText", answer_option_id AS "answerOptionId"
       FROM answers
       WHERE attempt_id = $1`,
      [id]
    );

    const gradeRes = await pool.query(
      `SELECT question_id AS "questionId", score, max_score AS "maxScore", verdict, feedback_md AS "feedbackMd", citations, confidence
       FROM grades
       WHERE attempt_id = $1`,
      [id]
    );

    const totalScore = gradeRes.rows.reduce((acc, g) => acc + Number(g.score), 0);
    const totalMax = qRes.rows.reduce((acc, q: any) => {
      const type = String(q?.type ?? "");
      if (type === "MCQ") return acc + 1;
      return acc + sumRubric(q?.rubric);
    }, 0);

    return { attempt, totals: { score: totalScore, max: totalMax }, questions: qRes.rows, answers: ansRes.rows, grades: gradeRes.rows };
  });

  app.get("/wrong-items", async () => {
    const res = await pool.query(
      `SELECT wi.question_id AS "questionId", wi.last_wrong_at AS "lastWrongAt", wi.wrong_count AS "wrongCount", wi.weak_tags AS "weakTags"
       FROM wrong_items wi
       WHERE wi.user_id = $1
       ORDER BY wi.last_wrong_at DESC
       LIMIT 200`,
      [DEMO_USER_ID]
    );
    return { items: res.rows };
  });

  // Server-Sent Events (SSE): push attempt grading status updates to the UI.
  app.get("/attempts/:id/events", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const attemptRes = await pool.query(`SELECT id, status, error FROM attempts WHERE id = $1 AND user_id = $2`, [
      id,
      DEMO_USER_ID
    ]);
    const attempt = attemptRes.rows[0];
    if (!attempt) {
      return reply.status(404).send({ error: "Not found" });
    }

    initSse(req, reply);
    reply.hijack();

    sseSend(reply, {
      event: "snapshot",
      data: { type: "attempt", attemptId: id, status: attempt.status, error: attempt.error }
    });

    const channel = EVENT_CHANNELS.attempt(id);
    let unsubscribe: (() => Promise<void>) | null = null;
    try {
      unsubscribe = await subscribeChannel(channel, (message) => {
        if (reply.raw.writableEnded) return;
        let data: any = null;
        try {
          data = JSON.parse(message);
        } catch {
          data = { type: "attempt", attemptId: id, raw: message };
        }
        sseSend(reply, { event: "update", data });
      });
    } catch (err) {
      sseSend(reply, {
        event: "error",
        data: { type: "attempt", attemptId: id, error: err instanceof Error ? err.message : String(err) }
      });
      reply.raw.end();
      return;
    }

    const keepAlive = setInterval(() => {
      if (reply.raw.writableEnded) return;
      sseComment(reply, "keep-alive");
    }, 15_000);

    req.raw.on("close", async () => {
      clearInterval(keepAlive);
      if (unsubscribe) await unsubscribe();
      try {
        reply.raw.end();
      } catch {
        // ignore
      }
    });
  });
};
