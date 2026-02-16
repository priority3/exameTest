import crypto from "node:crypto";
import type { Job } from "bullmq";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { EVENT_CHANNELS, JOB_NAMES, QUEUE_NAME } from "@exametest/shared";
import { pool } from "../db.js";
import { env } from "../env.js";
import { publishEvent } from "../events.js";
import {
  fetchRepoTree,
  fetchFileContent,
  filterFiles,
  isDocExtension,
  detectLanguage,
  buildFileUrl,
} from "../github/fetch.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchGithubSourcePayload = {
  sourceId: string;
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sha256 = (input: string): string =>
  crypto.createHash("sha256").update(input, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

export async function fetchGithubSource(
  job: Job<FetchGithubSourcePayload>,
): Promise<void> {
  const { sourceId, owner, repo, subpath } = job.data;
  let { ref } = job.data;

  await job.log(`fetchGithubSource: ${owner}/${repo} ref=${ref ?? "default"} subpath=${subpath ?? "/"}`);

  try {
    // 1. Fetch file tree
    const tree = await fetchRepoTree(owner, repo, ref);
    ref = tree.ref; // resolved default branch if ref was undefined

    await job.log(`Tree fetched: ${tree.files.length} blobs, resolved ref=${ref}`);

    // 2. Filter to supported files
    const files = filterFiles(tree.files, subpath);

    if (files.length === 0) {
      throw new Error("No supported files found in the repository (or subpath).");
    }

    await job.log(`Filtered to ${files.length} files`);

    // 3. Fetch content and create documents
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        await job.log(`Fetching [${i + 1}/${files.length}] ${file.path}`);

        let content: string;
        try {
          content = await fetchFileContent(owner, repo, ref, file.path);
        } catch (err) {
          // Reason: Individual file fetch failures should not abort the
          // entire job — skip the file and continue with the rest.
          await job.log(`Skipped ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        // Skip empty files
        if (!content.trim()) continue;

        const isDoc = isDocExtension(file.path);
        const language = detectLanguage(file.path);
        const uri = buildFileUrl(owner, repo, ref, file.path);

        await client.query(
          `INSERT INTO documents (source_id, doc_type, uri, content_hash, content_text, content_md, meta)
           VALUES ($1, 'GITHUB_FILE', $2, $3, $4, $5, $6)`,
          [
            sourceId,
            uri,
            sha256(content),
            content,
            isDoc ? content : null,
            { path: file.path, repo: `${owner}/${repo}`, ref, language },
          ],
        );

        await job.updateProgress(Math.round(((i + 1) / files.length) * 80));
      }

      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      client.release();
    }

    // 4. Enqueue chunk-and-embed job (reuses existing pipeline)
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    try {
      const queue = new Queue(QUEUE_NAME, { connection });
      await queue.add(
        JOB_NAMES.chunkAndEmbedSource,
        { sourceId },
        { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
      );
      await queue.close();
    } finally {
      await connection.quit();
    }

    await job.log("Enqueued chunkAndEmbedSource job");
    await job.updateProgress(100);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    await pool.query(
      `UPDATE sources SET status = 'FAILED', error = $2, updated_at = NOW() WHERE id = $1`,
      [sourceId, msg],
    );
    await publishEvent(EVENT_CHANNELS.source(sourceId), {
      type: "source",
      sourceId,
      status: "FAILED",
      error: msg,
    });

    throw err;
  }
}
