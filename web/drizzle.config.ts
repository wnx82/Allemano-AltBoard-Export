import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Pas de .env.local : les variables viennent de l'environnement.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Les migrations passent en connexion directe, jamais par PgBouncer.
    url: process.env.WOW_DATABASE_URL_DIRECT ?? process.env.WOW_DATABASE_URL ?? "",
  },
});
