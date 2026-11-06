import { Client } from "pg";

/**
 * Provisions a uniquely named PostgreSQL database for one test run and returns
 * a query handle plus a dispose() that drops it again.
 *
 * dispose() closes its own clients in `finally`, terminates any leaked backends
 * still attached to the database, and drops with WITH (FORCE) (PostgreSQL 13+)
 * so a failed test can never wedge the suite on error 55006.
 */
export async function provisionDatabase(baseUrl) {
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  const name = `helix_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return {
    url: url.toString(),
    query: (text, params) => client.query(text, params),
    dispose: async () => {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
      const drop = new Client({ connectionString: baseUrl });
      try {
        await drop.connect();
        // Belt and braces: terminate any leaked backends before dropping.
        await drop
          .query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [name],
          )
          .catch(() => {});
        await drop.query(`DROP DATABASE ${name} WITH (FORCE)`).catch(async (error) => {
          if (error.code === "42601") {
            // Syntax error: server older than PostgreSQL 13 — plain drop.
            await drop.query(`DROP DATABASE ${name}`);
          } else {
            throw error;
          }
        });
      } finally {
        await drop.end().catch(() => {});
      }
    },
  };
}
