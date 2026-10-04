import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { appDatabaseUrl } from "./env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
// Base ou transaction en cours : les fonctions d'écriture acceptent l'une ou l'autre.
export type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    // Délai côté client. Surtout pas statement_timeout : node-postgres l'envoie comme paramètre de
    // démarrage, que PgBouncer refuse (« unsupported startup parameter »). Le serveur applique
    // déjà son propre statement_timeout.
    query_timeout: 15_000,
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

type GlobalWithDatabase = typeof globalThis & { __wowAltboardDb?: { pool: Pool; db: Database } };

// Singleton paresseux : aucune connexion n'est ouverte à l'import (le build tourne sans base).
export function getDatabase(): Database {
  const holder = globalThis as GlobalWithDatabase;
  if (!holder.__wowAltboardDb) {
    const pool = createPool(appDatabaseUrl());
    holder.__wowAltboardDb = { pool, db: createDatabase(pool) };
  }
  return holder.__wowAltboardDb.db;
}
