import assert from "node:assert/strict";
import { test } from "node:test";
import { createPool } from "./client";

// En production l'application passe par PgBouncer, qui refuse tout paramètre de démarrage hors de
// sa liste (ignore_startup_parameters). La base locale, jointe en direct, ne révèle pas ce défaut :
// la première mise en production a échoué sur statement_timeout.
test("le pool n'envoie aucun paramètre de démarrage que PgBouncer refuserait", async () => {
  const pool = createPool("postgres://user:secret@127.0.0.1:1/wow_altboard");
  const options = pool.options as unknown as Record<string, unknown>;

  for (const forbidden of ["statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout", "options"]) {
    assert.equal(options[forbidden], undefined, forbidden);
  }
  assert.equal(options.query_timeout, 15_000);
  await pool.end();
});
