import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateSourceRequestSchema, DEMO_USER_ID, EVENT_CHANNELS, JOB_NAMES } from "@exametest/shared";
import { pool, ensureDemoUser } from "../db.js";
import { queue } from "../queue.js";
import { subscribeChannel } from "../realtime.js";
import { initSse, sseComment, sseSend } from "../sse.js";

const sha256 = (input: string): string => {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
};

const defaultTitle = (type: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  return `${type} ${ts}`;
};

/**
 * Parse a GitHub URL to extract owner, repo, optional ref and subpath.
 * Supports: github.com/owner/repo[/tree/ref[/subpath]]
 */
const parseGitHubUrl = (url: string): { owner: string; repo: string; ref?: string; subpath?: string } => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.hostname !== "github.com") {
    throw new Error("Only github.com URLs are supported");
  }

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error("Cannot extract owner/repo from URL");
  }

  const result: { owner: string; repo: string; ref?: string; subpath?: string } = {
    owner: parts[0],
    repo: parts[1],
  };

  if (parts.length >= 4 && parts[2] === "tree") {
    result.ref = parts[3];
    if (parts.length > 4) {
      result.subpath = parts.slice(4).join("/");
    }
  }

  return result;
};

export const registerSourceRoutes = async (app: FastifyInstance) => {
  app.get("/sources", async () => {
    const res = await pool.query(
      `SELECT id, type, title, status, error, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sources
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [DEMO_USER_ID]
    );
    return { items: res.rows };
  });

  app.post("/sources", async (req, reply) => {
    const parsed = CreateSourceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid payload",
        details: parsed.error.flatten()
      });
    }

    const payload = parsed.data;
    await ensureDemoUser();

    if (payload.type === "URL") {
      return reply.status(501).send({
        error: "Not implemented",
        message: "URL source type is not yet supported."
      });
    }

    // --- GITHUB type: parse URL, create source, enqueue fetch job ---
    if (payload.type === "GITHUB") {
      let ghInfo: { owner: string; repo: string; ref?: string; subpath?: string };
      try {
        ghInfo = parseGitHubUrl(payload.url);
      } catch (err) {
        return reply.status(400).send({
          error: "Invalid GitHub URL",
          message: err instanceof Error ? err.message : String(err)
        });
      }

      const title = payload.title?.trim() || `${ghInfo.owner}/${ghInfo.repo}`;

      const sourceRes = await pool.query<{ id: string }>(
        `INSERT INTO sources (user_id, type, title, status)
         VALUES ($1, 'GITHUB', $2, 'PROCESSING')
         RETURNING id`,
        [DEMO_USER_ID, title]
      );
      const sourceId = sourceRes.rows[0]?.id;
      if (!sourceId) {
        throw new Error("Failed to create source");
      }

      await queue.add(
        JOB_NAMES.fetchGithubSource,
        { sourceId, owner: ghInfo.owner, repo: ghInfo.repo, ref: ghInfo.ref, subpath: ghInfo.subpath },
        { attempts: 2, backoff: { type: "exponential", delay: 2000 } }
      );

      return reply.status(201).send({ id: sourceId, status: "PROCESSING" });
    }

    // Normalize to content_text / content_md
    const contentText = payload.type === "MARKDOWN_UPLOAD" ? payload.md : payload.text;
    const contentMd = payload.type === "MARKDOWN_UPLOAD" ? payload.md : null;

    const title = payload.title?.trim() || defaultTitle(payload.type);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const sourceRes = await client.query<{ id: string }>(
        `INSERT INTO sources (user_id, type, title, status)
         VALUES ($1, $2, $3, 'PROCESSING')
         RETURNING id`,
        [DEMO_USER_ID, payload.type, title]
      );

      const sourceId = sourceRes.rows[0]?.id;
      if (!sourceId) {
        throw new Error("Failed to create source");
      }

      await client.query(
        `INSERT INTO documents (source_id, doc_type, uri, content_hash, content_text, content_md, meta)
         VALUES ($1, 'ARTICLE', NULL, $2, $3, $4, $5)`,
        [
          sourceId,
          sha256(contentText),
          contentText,
          contentMd,
          { sourceType: payload.type }
        ]
      );

      await client.query("COMMIT");

      await queue.add(
        JOB_NAMES.chunkAndEmbedSource,
        { sourceId },
        { attempts: 3, backoff: { type: "exponential", delay: 1000 } }
      );

      return reply.status(201).send({ id: sourceId, status: "PROCESSING" });
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
  });

  app.get("/sources/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const sourceRes = await pool.query(
      `SELECT id, type, title, status, error, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sources
       WHERE id = $1 AND user_id = $2`,
      [id, DEMO_USER_ID]
    );
    const source = sourceRes.rows[0];
    if (!source) {
      return reply.status(404).send({ error: "Not found" });
    }

    const countsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM documents WHERE source_id = $1)::int AS documents,
         (SELECT COUNT(*)
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
          WHERE d.source_id = $1)::int AS chunks`,
      [id]
    );

    return { ...source, counts: countsRes.rows[0] };
  });

  app.get("/sources/:id/preview", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const sourceRes = await pool.query(`SELECT id FROM sources WHERE id = $1 AND user_id = $2`, [
      id,
      DEMO_USER_ID
    ]);
    if (sourceRes.rowCount === 0) {
      return reply.status(404).send({ error: "Not found" });
    }

    const docRes = await pool.query(
      `SELECT id, doc_type AS "docType", uri, meta,
              content_text AS "rawText",
              OCTET_LENGTH(content_text) AS bytes
       FROM documents
       WHERE source_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Reason: Postgres LEFT/substring on text can fail with certain
    // multi-byte data due to glibc locale issues inside the Docker
    // container, so we truncate in JS instead.
    const documents = docRes.rows.map((row: any) => {
      const { rawText, ...rest } = row;
      return { ...rest, preview: rawText ? rawText.slice(0, 800) : "" };
    });

    return { sourceId: id, documents };
  });

  app.delete("/sources/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const res = await pool.query(
      `DELETE FROM sources WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, DEMO_USER_ID]
    );

    if (res.rowCount === 0) {
      return reply.status(404).send({ error: "Not found" });
    }

    return reply.status(204).send();
  });

  // Server-Sent Events (SSE): push source status updates to the UI.
  app.get("/sources/:id/events", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const sourceRes = await pool.query(`SELECT id, status, error FROM sources WHERE id = $1 AND user_id = $2`, [
      id,
      DEMO_USER_ID
    ]);
    const source = sourceRes.rows[0];
    if (!source) {
      return reply.status(404).send({ error: "Not found" });
    }

    initSse(req, reply);
    reply.hijack();

    sseSend(reply, { event: "snapshot", data: { type: "source", sourceId: id, status: source.status, error: source.error } });

    const channel = EVENT_CHANNELS.source(id);
    let unsubscribe: (() => Promise<void>) | null = null;
    try {
      unsubscribe = await subscribeChannel(channel, (message) => {
        if (reply.raw.writableEnded) return;
        let data: any = null;
        try {
          data = JSON.parse(message);
        } catch {
          data = { type: "source", sourceId: id, raw: message };
        }
        sseSend(reply, { event: "update", data });
      });
    } catch (err) {
      sseSend(reply, {
        event: "error",
        data: { type: "source", sourceId: id, error: err instanceof Error ? err.message : String(err) }
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
