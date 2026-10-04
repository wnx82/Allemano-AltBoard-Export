import assert from "node:assert/strict";
import { test } from "node:test";
import { assertProjectDatabase, assertTestDatabase, describeTarget } from "./env";

const url = (database: string) => `postgres://user:secret@127.0.0.1:54329/${database}`;

test("assertProjectDatabase accepte uniquement les bases du projet", () => {
  assert.equal(assertProjectDatabase(url("wow_altboard")), url("wow_altboard"));
  assert.equal(assertProjectDatabase(url("wow_altboard_test")), url("wow_altboard_test"));
  for (const foreign of ["ekreativ", "sysaudit_test", "postgres", "wow_altboardx", "my_wow_altboard", ""]) {
    assert.throws(() => assertProjectDatabase(url(foreign)), /does not belong to this project/, foreign);
  }
});

test("assertTestDatabase refuse toute base qui n'est pas une base de test du projet", () => {
  assert.equal(assertTestDatabase(url("wow_altboard_test")), url("wow_altboard_test"));
  assert.equal(assertTestDatabase(url("wow_altboard_ci_test")), url("wow_altboard_ci_test"));
  for (const refused of ["wow_altboard", "sysaudit_test", "wow_altboard_test_copy", "test"]) {
    assert.throws(() => assertTestDatabase(url(refused)), /is not a test database of this project/, refused);
  }
});

test("describeTarget n'expose jamais les identifiants de connexion", () => {
  const described = describeTarget(url("wow_altboard"));
  assert.equal(described, "127.0.0.1:54329/wow_altboard");
  assert.ok(!described.includes("secret"));
});
