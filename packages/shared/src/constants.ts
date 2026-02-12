export const QUEUE_NAME = "exametest";

export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export const JOB_NAMES = {
  chunkAndEmbedSource: "chunk_and_embed_source",
  generatePaper: "generate_paper",
  gradeAttempt: "grade_attempt"
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// ----------------------------
// Realtime events (Redis pub/sub)
// ----------------------------
//
// The worker publishes status changes to Redis channels, and the API exposes
// these channels via Server-Sent Events (SSE) endpoints to the web app.
//
// Channel naming is kept in shared to avoid API/worker drift.
export const EVENTS_PREFIX = "exametest:events";

export const EVENT_CHANNELS = {
  source: (sourceId: string) => `${EVENTS_PREFIX}:source:${sourceId}`,
  paper: (paperId: string) => `${EVENTS_PREFIX}:paper:${paperId}`,
  attempt: (attemptId: string) => `${EVENTS_PREFIX}:attempt:${attemptId}`
} as const;
