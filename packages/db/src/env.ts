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
  DATABASE_URL: requireEnv("DATABASE_URL")
};
