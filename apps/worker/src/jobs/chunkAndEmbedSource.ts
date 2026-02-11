import type { Job } from "bullmq";
import { pool } from "../db.js";
import { env } from "../env.js";
import { embedTexts, hasOpenAI } from "../llm/openai.js";

type DocumentRow = {
  id: string;
  content_text: string;
};

type ChunkPlan = {
  text: string;
  meta: Record<string, unknown>;
};

const normalizeText = (text: string): string => {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
};

const extractHeading = (paragraph: string): string | null => {
  const firstLine = paragraph.split("\n", 1)[0] ?? "";
  const m = firstLine.match(/^#{1,6}\s+(.*)$/);
  if (!m) return null;
  return m[1]?.trim() || null;
};

const chunkText = (rawText: string, maxChars = 1800): ChunkPlan[] => {
  const text = normalizeText(rawText);
  if (!text) return [];

  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  let heading = "";
  const chunks: ChunkPlan[] = [];

  let current = "";
  let currentHeading = "";
  let paraStart = 0;

  const push = (paraEnd: number) => {
    if (!current.trim()) return;
    chunks.push({
      text: current.trim(),
      meta: {
        heading: currentHeading || null,
        paraStart,
        paraEnd
      }
    });
  };

  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i]!;
    const h = extractHeading(p);
    if (h) heading = h;

    if (!current) {
      currentHeading = heading;
      paraStart = i;
      current = p;
      continue;
    }

    const next = `${current}\n\n${p}`;
    if (next.length > maxChars) {
      push(i - 1);
      currentHeading = heading;
      paraStart = i;
      current = p;
      continue;
    }

    current = next;
  }

  push(paragraphs.length - 1);
  return chunks;
};

const toVectorLiteral = (embedding: number[]): string => {
  return `[${embedding.join(",")}]`;
};

export const chunkAndEmbedSource = async (job: Job<{ sourceId: string }>) => {
  const sourceId = job.data.sourceId;

  await job.log(`chunkAndEmbedSource: ${sourceId}`);

  const docRes = await pool.query<DocumentRow>(
    `SELECT d.id, d.content_text
     FROM documents d
     WHERE d.source_id = $1
     ORDER BY d.created_at ASC`,
    [sourceId]
  );

  if (docRes.rowCount === 0) {
    throw new Error(`No documents found for sourceId=${sourceId}`);
  }

  const client = await pool.connect();
  const insertedChunks: { id: string; text: string }[] = [];

  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE sources
       SET status = 'PROCESSING', error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [sourceId]
    );

    // Clean existing chunks (cascade deletes embeddings)
    await client.query(
      `DELETE FROM chunks
       WHERE document_id IN (SELECT id FROM documents WHERE source_id = $1)`,
      [sourceId]
    );

    for (const doc of docRes.rows) {
      const plans = chunkText(doc.content_text);
      await job.log(`document ${doc.id}: ${plans.length} chunks`);

      for (let i = 0; i < plans.length; i += 1) {
        const plan = plans[i]!;
        const res = await client.query<{ id: string }>(
          `INSERT INTO chunks (document_id, chunk_index, text, meta)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [doc.id, i, plan.text, plan.meta]
        );
        insertedChunks.push({ id: res.rows[0]!.id, text: plan.text });
      }
    }

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

  if (insertedChunks.length === 0) {
    await pool.query(
      `UPDATE sources
       SET status = 'FAILED', error = $2, updated_at = NOW()
       WHERE id = $1`,
      [sourceId, "No chunks generated (empty input?)"]
    );
    return;
  }

  if (hasOpenAI()) {
    try {
      await job.log(`embedding ${insertedChunks.length} chunks using ${env.OPENAI_EMBEDDING_MODEL}`);

      const batchSize = 64;
      for (let i = 0; i < insertedChunks.length; i += batchSize) {
        const batch = insertedChunks.slice(i, i + batchSize);
        const embeddings = await embedTexts(batch.map((c) => c.text));

        const client2 = await pool.connect();
        try {
          await client2.query("BEGIN");
          for (let j = 0; j < batch.length; j += 1) {
            const chunk = batch[j]!;
            const embedding = embeddings[j]!;
            await client2.query(
              `INSERT INTO chunk_embeddings (chunk_id, embedding, model)
               VALUES ($1, $2, $3)
               ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
              [chunk.id, toVectorLiteral(embedding), env.OPENAI_EMBEDDING_MODEL]
            );
          }
          await client2.query("COMMIT");
        } catch (err) {
          try {
            await client2.query("ROLLBACK");
          } catch {
            // ignore
          }
          throw err;
        } finally {
          client2.release();
        }

        await job.updateProgress(Math.round(((i + batch.length) / insertedChunks.length) * 100));
      }
    } catch (err) {
      await job.log(
        `Embedding failed (continuing without embeddings): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    await job.log("OPENAI_API_KEY missing: skipping embeddings for now.");
  }

  await pool.query(
    `UPDATE sources
     SET status = 'READY', error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [sourceId]
  );
};
