import { createPool } from "@exametest/db";
import { env } from "./env.js";

export const pool = createPool({ databaseUrl: env.DATABASE_URL });
