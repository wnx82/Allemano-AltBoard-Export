import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import { test } from "node:test";
import { BLOCKED_CODE, isPublicAddress, publicLookup } from "./guard";

test("seule une adresse IP publique est acceptée", () => {
  for (const address of ["24.105.52.94", "66.40.178.65", "8.8.8.8", "172.32.0.1", "192.0.2.10", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.254",
    "10.0.0.15",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "64:ff9b::c0a8:10f",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("une IPv4 interne écrite en IPv6 reste refusée", () => {
  for (const address of ["::ffff:10.0.0.15", "::ffff:c0a8:10f", "::ffff:127.0.0.1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
});

test("ce qui n'est pas une adresse IP n'est jamais tenu pour public", () => {
  for (const value of ["", "localhost", "example.test", "192.168.1", "8.8.8.8:53"]) assert.equal(isPublicAddress(value), false, value);
});

const resolve = (hostname: string) =>
  new Promise<{ code: string | undefined; address: string | LookupAddress[] }>((done) => {
    publicLookup(hostname, { all: true }, (error, address) => done({ code: error?.code, address }));
  });

test("un nom résolu vers une adresse interne est refusé", async () => {
  assert.equal((await resolve("localhost")).code, BLOCKED_CODE);
});

test("un nom résolu vers une adresse publique est rendu tel quel", async () => {
  // Une adresse IP donnée comme nom se résout en elle-même, sans requête DNS.
  const result = await resolve("192.0.2.10");

  assert.equal(result.code, undefined);
  assert.deepEqual(result.address, [{ address: "192.0.2.10", family: 4 }]);
});

test("un nom introuvable garde son erreur de résolution", async () => {
  const result = await resolve("nom-inexistant.invalid");

  assert.ok(result.code !== undefined && result.code !== BLOCKED_CODE, String(result.code));
});
