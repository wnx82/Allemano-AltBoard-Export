// Crée ou met à jour un compte d'accès au tableau de bord : npm run admin:create -- <email>
// Le mot de passe est demandé deux fois sans écho, ou lu sur l'entrée standard si elle est redirigée.
import { createDatabase, createPool } from "../src/db/client";
import { appDatabaseUrl, describeTarget } from "../src/db/env";
import { adminUsers } from "../src/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";

/** Première ligne de l'entrée standard redirigée. */
function readPiped(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
  });
}

/**
 * Saisie sans écho dans un terminal. Lecture caractère par caractère en mode brut : pas de
 * readline, qui efface la ligne courante — et donc l'invite — quand sa sortie est neutralisée.
 */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003" || character === "\u0004") return finish(new Error("Saisie annulée."));
        if (character === "\u007f" || character === "\b") value = [...value].slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readPiped();
  const password = await readHidden(`Mot de passe (${MIN_PASSWORD_LENGTH} caractères minimum, saisie masquée) : `);
  const confirmation = await readHidden("Confirmation : ");
  if (password !== confirmation) throw new Error("Les deux saisies diffèrent : rien n'a été enregistré.");
  return password;
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage : npm run admin:create -- <email>");
  process.exit(2);
}

let password: string;
try {
  password = await readPassword();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum) : rien n'a été enregistré.`);
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
