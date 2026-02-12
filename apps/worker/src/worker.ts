import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { EVENT_CHANNELS, JOB_NAMES, QUEUE_NAME } from "@exametest/shared";
import { env } from "./env.js";
import { pool } from "./db.js";
import { chunkAndEmbedSource } from "./jobs/chunkAndEmbedSource.js";
import { generatePaper } from "./jobs/generatePaper.js";
import { gradeAttempt } from "./jobs/gradeAttempt.js";
import { publishEvent } from "./events.js";

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

type JobPayload = Record<string, unknown>;

const worker = new Worker<JobPayload>(
  QUEUE_NAME,
  async (job) => {
    job.log(`Received job: ${job.name}`);
    switch (job.name) {
      case JOB_NAMES.chunkAndEmbedSource: {
        const sourceId = String((job.data as any)?.sourceId ?? "");
        try {
          await chunkAndEmbedSource(job as any);
          return { ok: true };
        } catch (err) {
          if (sourceId) {
            const msg = err instanceof Error ? err.message : String(err);
            await pool.query(
              `UPDATE sources
               SET status = 'FAILED', error = $2, updated_at = NOW()
               WHERE id = $1`,
              [sourceId, msg]
            );
            await publishEvent(EVENT_CHANNELS.source(sourceId), {
              type: "source",
              sourceId,
              status: "FAILED",
              error: msg
            });
          }
          throw err;
        }
      }

      case JOB_NAMES.generatePaper: {
        await generatePaper(job as any);
        return { ok: true };
      }

      case JOB_NAMES.gradeAttempt: {
        const attemptId = String((job.data as any)?.attemptId ?? "");
        try {
          if (attemptId) {
            await pool.query(`UPDATE attempts SET error = NULL WHERE id = $1`, [attemptId]);
          }
          await gradeAttempt(job as any);
          return { ok: true };
        } catch (err) {
          if (attemptId) {
            const msg = err instanceof Error ? err.message : String(err);
            await pool.query(`UPDATE attempts SET error = $2 WHERE id = $1`, [
              attemptId,
              msg
            ]);
            await publishEvent(EVENT_CHANNELS.attempt(attemptId), {
              type: "attempt",
              attemptId,
              status: "FAILED",
              error: msg
            });
          }
          throw err;
        }
      }

      default:
        job.log(`Unknown job name: ${job.name}`);
        return { ok: false, error: "Unknown job name" };
    }
  },
  { connection }
);

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[worker] completed`, { id: job.id, name: job.name });
});

worker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[worker] failed`, { id: job?.id, name: job?.name, err });
});
