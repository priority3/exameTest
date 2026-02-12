import type { FastifyInstance } from "fastify";
import { CreatePaperRequestSchema, DEMO_USER_ID, EVENT_CHANNELS, JOB_NAMES } from "@exametest/shared";
import { pool, ensureDemoUser } from "../db.js";
import { queue } from "../queue.js";
import { subscribeChannel } from "../realtime.js";
import { initSse, sseComment, sseSend } from "../sse.js";

const defaultPaperTitle = (sourceTitle: string): string => {
  return `${sourceTitle} - Paper`;
};

export const registerPaperRoutes = async (app: FastifyInstance) => {
  app.post("/papers", async (req, reply) => {
    const parsed = CreatePaperRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    await ensureDemoUser();
    const { sourceId, title, config } = parsed.data;

    const sourceRes = await pool.query<{ title: string; status: string }>(
      `SELECT title, status
       FROM sources
       WHERE id = $1 AND user_id = $2`,
      [sourceId, DEMO_USER_ID]
    );
    const source = sourceRes.rows[0];
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    if (source.status !== "READY") {
      return reply.status(409).send({ error: "Source not ready", status: source.status });
    }

    const paperRes = await pool.query<{ id: string }>(
      `INSERT INTO papers (user_id, source_id, title, config, status)
       VALUES ($1, $2, $3, $4, 'DRAFT')
       RETURNING id`,
      [DEMO_USER_ID, sourceId, title?.trim() || defaultPaperTitle(source.title), config ?? {}]
    );

    const paperId = paperRes.rows[0]?.id;
    if (!paperId) {
      throw new Error("Failed to create paper");
    }

    await queue.add(JOB_NAMES.generatePaper, { paperId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });

    return reply.status(201).send({ id: paperId, status: "DRAFT" });
  });

  app.get("/papers/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const paperRes = await pool.query(
      `SELECT id, title, config, status, error, created_at AS "createdAt"
       FROM papers
       WHERE id = $1 AND user_id = $2`,
      [id, DEMO_USER_ID]
    );
    const paper = paperRes.rows[0];
    if (!paper) {
      return reply.status(404).send({ error: "Not found" });
    }

    const qRes = await pool.query(
      `SELECT id, type, difficulty, prompt, options, tags
       FROM questions
       WHERE paper_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return { ...paper, questions: qRes.rows };
  });

  // Debug endpoint for local dev.
  app.get("/papers/:id/answer-key", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const paperRes = await pool.query(`SELECT id FROM papers WHERE id = $1 AND user_id = $2`, [id, DEMO_USER_ID]);
    if (paperRes.rowCount === 0) {
      return reply.status(404).send({ error: "Not found" });
    }

    const qRes = await pool.query(
      `SELECT id, type, prompt, options, answer_key AS "answerKey", rubric, tags
       FROM questions
       WHERE paper_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return { paperId: id, questions: qRes.rows };
  });

  // Server-Sent Events (SSE): push paper status updates to the UI.
  app.get("/papers/:id/events", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const paperRes = await pool.query(`SELECT id, status, error FROM papers WHERE id = $1 AND user_id = $2`, [
      id,
      DEMO_USER_ID
    ]);
    const paper = paperRes.rows[0];
    if (!paper) {
      return reply.status(404).send({ error: "Not found" });
    }

    initSse(reply);
    reply.hijack();

    sseSend(reply, { event: "snapshot", data: { type: "paper", paperId: id, status: paper.status, error: paper.error } });

    const channel = EVENT_CHANNELS.paper(id);
    let unsubscribe: (() => Promise<void>) | null = null;
    try {
      unsubscribe = await subscribeChannel(channel, (message) => {
        if (reply.raw.writableEnded) return;
        let data: any = null;
        try {
          data = JSON.parse(message);
        } catch {
          data = { type: "paper", paperId: id, raw: message };
        }
        sseSend(reply, { event: "update", data });
      });
    } catch (err) {
      sseSend(reply, {
        event: "error",
        data: { type: "paper", paperId: id, error: err instanceof Error ? err.message : String(err) }
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
