// Crée ou met à jour un compte d'accès au tableau de bord : npm run admin:create -- <email>
// Le mot de passe est demandé sans écho, ou lu sur l'entrée standard si elle est redirigée.
import { createInterface } from "node:readline";
import { createDatabase, createPool } from "../src/db/client";
import { appDatabaseUrl, describeTarget } from "../src/db/env";
import { adminUsers } from "../src/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";

function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
    });
  }

  return new Promise((resolve) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = terminal as unknown as { _writeToOutput: (text: string) => void };
    process.stdout.write(`Mot de passe (${MIN_PASSWORD_LENGTH} caractères minimum) : `);
    output._writeToOutput = () => {};
    terminal.question("", (answer) => {
      terminal.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage : npm run admin:create -- <email>");
  process.exit(2);
}

const password = await readPassword();
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`);
  process.exit(2);
}

const url = appDatabaseUrl();
const pool = createPool(url);
try {
  const passwordHash = await hashPassword(password);
  await createDatabase(pool)
    .insert(adminUsers)
    .values({ email, passwordHash })
    .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash, active: true, updatedAt: new Date() } });
  console.log(`Compte ${email} enregistré dans ${describeTarget(url)}.`);
} finally {
  await pool.end();
}
