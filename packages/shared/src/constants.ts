export const QUEUE_NAME = "exametest";

export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export const JOB_NAMES = {
  chunkAndEmbedSource: "chunk_and_embed_source",
  generatePaper: "generate_paper",
  gradeAttempt: "grade_attempt"
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
