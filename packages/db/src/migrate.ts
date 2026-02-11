import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./db.js";
import { env } from "./env.js";

type MigrationRow = { name: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../../../");
const migrationsDir = path.join(repoRoot, "db/migrations");

const main = async () => {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations dir not found: ${migrationsDir}`);
  }

  const pool = createPool({ databaseUrl: env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query("COMMIT");

    const applied = await client.query<MigrationRow>("SELECT name FROM schema_migrations");
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");

      process.stdout.write(`Applying migration ${file}...\n`);
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    }

    process.stdout.write("Migrations complete.\n");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
