// Les variables portent un préfixe propre au projet : des noms génériques (DATABASE_URL,
// TEST_DATABASE_URL) peuvent déjà exister dans l'environnement pour un autre projet et feraient
// viser la mauvaise base.

const PROJECT_DATABASE = /^wow_altboard(_[a-z0-9_]+)?$/;
const TEST_DATABASE = /^wow_altboard(_[a-z0-9_]+)?_test$/;

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function requireUrl(name: string): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is not set`);
  return url;
}

/** Refuse toute base dont le nom n'appartient pas au projet. */
export function assertProjectDatabase(url: string): string {
  const name = databaseName(url);
  if (!PROJECT_DATABASE.test(name)) {
    throw new Error(`Refused: database "${name}" does not belong to this project (expected wow_altboard*)`);
  }
  return url;
}

/** Les tests vident la base : seule une base wow_altboard*_test est acceptée. */
export function assertTestDatabase(url: string): string {
  const name = databaseName(url);
  if (!TEST_DATABASE.test(name)) {
    throw new Error(`Refused: database "${name}" is not a test database of this project (expected wow_altboard*_test)`);
  }
  return url;
}

export function describeTarget(url: string): string {
  const target = new URL(url);
  return `${target.hostname}:${target.port || "5432"}/${databaseName(url)}`;
}

export function appDatabaseUrl(): string {
  return assertProjectDatabase(requireUrl("WOW_DATABASE_URL"));
}

export function migrationDatabaseUrl(): string {
  return assertProjectDatabase(process.env.WOW_DATABASE_URL_DIRECT || requireUrl("WOW_DATABASE_URL"));
}

export function testDatabaseUrl(): string {
  return assertTestDatabase(requireUrl("WOW_TEST_DATABASE_URL"));
}
