import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { agentDirectory, AGENT_FILE_NAME, findAgent, formatAgentSize } from "./agent-download";

let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "wow-agent-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("l'exécutable publié est décrit par sa taille et son empreinte SHA-256", async () => {
  const folder = path.join(directory, "publie");
  await mkdir(folder);
  const content = Buffer.from("MZ exécutable de démonstration");
  await writeFile(path.join(folder, AGENT_FILE_NAME), content);

  const agent = await findAgent(folder);

  assert.deepEqual(agent, {
    path: path.join(folder, AGENT_FILE_NAME),
    size: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
});

test("l'empreinte suit le fichier quand il est remplacé", async () => {
  const folder = path.join(directory, "remplace");
  await mkdir(folder);
  const file = path.join(folder, AGENT_FILE_NAME);
  await writeFile(file, "version 1");
  const first = await findAgent(folder);
  await writeFile(file, "version 2, plus longue");

  const second = await findAgent(folder);

  assert.notEqual(second?.sha256, first?.sha256);
  assert.equal(second?.sha256, createHash("sha256").update("version 2, plus longue").digest("hex"));
});

test("rien à télécharger sans dossier, sans fichier ou avec un fichier vide", async () => {
  // Image construite sans le contexte « repo » : le dossier existe, l'agent n'a pas été publié.
  const empty = path.join(directory, "vide");
  await mkdir(empty);
  const zero = path.join(directory, "zero");
  await mkdir(zero);
  await writeFile(path.join(zero, AGENT_FILE_NAME), "");
  const misnamed = path.join(directory, "dossier");
  await mkdir(path.join(misnamed, AGENT_FILE_NAME), { recursive: true });

  assert.equal(await findAgent(null), null);
  assert.equal(await findAgent(path.join(directory, "absent")), null);
  assert.equal(await findAgent(empty), null);
  assert.equal(await findAgent(zero), null);
  assert.equal(await findAgent(misnamed), null);
});

test("le dossier vient de WOW_AGENT_DIR, vide s'il n'est pas défini", () => {
  assert.equal(agentDirectory({ WOW_AGENT_DIR: "/app/agent" }), "/app/agent");
  assert.equal(agentDirectory({ WOW_AGENT_DIR: "" }), null);
  assert.equal(agentDirectory({}), null);
});

test("taille en mégaoctets, à une décimale", () => {
  assert.equal(formatAgentSize(12_336_126), "11,8 Mo");
  assert.equal(formatAgentSize(1024 * 1024), "1 Mo");
});
