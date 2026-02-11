import pg from "pg";

export type DbConfig = {
  databaseUrl: string;
};

export const createPool = (config: DbConfig) => {
  return new pg.Pool({
    connectionString: config.databaseUrl
  });
};

