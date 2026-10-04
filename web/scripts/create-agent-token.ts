// Crée un jeton d'agent et l'affiche une seule fois : npm run token:create -- "PC-Gaming"
import { createDatabase, createPool } from "../src/db/client";
import { appDatabaseUrl, describeTarget } from "../src/db/env";
import { createAgentToken } from "../src/lib/agent-tokens";

const label = process.argv[2]?.trim();
if (!label) {
  console.error('Usage : npm run token:create -- "<libellé de la machine>"');
  process.exit(2);
}

const url = appDatabaseUrl();
const pool = createPool(url);
try {
  const { id, token } = await createAgentToken(createDatabase(pool), label);
  console.log(`Base    : ${describeTarget(url)}`);
  console.log(`Jeton n°${id} créé pour « ${label} ». Il ne sera plus jamais affiché :`);
  console.log("");
  console.log(token);
  console.log("");
  console.log("Sur le PC concerné : AltBoardSync.exe token set");
} finally {
  await pool.end();
}
