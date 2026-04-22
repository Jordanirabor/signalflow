import { Pool, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PG_HOST ?? 'localhost',
        port: Number(process.env.PG_PORT ?? 5432),
        database: process.env.PG_DATABASE ?? 'signalflow',
        user: process.env.PG_USER ?? 'postgres',
        password: process.env.PG_PASSWORD ?? '',
      },
);

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export default pool;
