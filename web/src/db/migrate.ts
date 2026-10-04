import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, createPool } from "./client";
import { assertProjectDatabase, describeTarget, migrationDatabaseUrl, testDatabaseUrl } from "./env";

// Dans l'image de production le script est empaqueté en un seul fichier : le dossier des
// migrations est alors indiqué par WOW_MIGRATIONS_DIR.
export const MIGRATIONS_FOLDER = process.env.WOW_MIGRATIONS_DIR || path.resolve(import.meta.dirname, "../../drizzle");

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPool(assertProjectDatabase(connectionString));
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Exécution directe : npm run db:migrate [-- --test]
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const url = process.argv.includes("--test") ? testDatabaseUrl() : migrationDatabaseUrl();
    console.log(`Migrations vers ${describeTarget(url)}`);
    await runMigrations(url);
    console.log("Migrations appliquées.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
