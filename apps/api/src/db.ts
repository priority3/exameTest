import { createPool } from "@exametest/db";
import { DEMO_USER_ID } from "@exametest/shared";
import { env } from "./env.js";

export const pool = createPool({ databaseUrl: env.DATABASE_URL });

export const ensureDemoUser = async (): Promise<void> => {
  await pool.query(
    `INSERT INTO users (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_USER_ID]
  );
};
