import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Connection string from environment
const connectionString =
  process.env["DATABASE_URL"] ??
  "postgres://postgres:postgres@localhost:5432/prune";

// Create postgres client
const client = postgres(connectionString, {
  max: 10, // Connection pool size
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export for direct SQL queries if needed
export { client };

// Graceful shutdown helper
export async function closeDatabase(): Promise<void> {
  await client.end();
}
