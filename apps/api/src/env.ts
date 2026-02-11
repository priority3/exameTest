import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

const requireEnv = (key: string): string => {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  API_PORT: Number(process.env.API_PORT ?? 4000),
  DATABASE_URL: requireEnv("DATABASE_URL"),
  REDIS_URL: requireEnv("REDIS_URL"),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "",
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini"
};
