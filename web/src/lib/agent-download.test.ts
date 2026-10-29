import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { agentDirectory, AGENT_FILE_NAME, archiveAgent, findAgent, formatAgentSize, README_FILE_NAME } from "./agent-download";

let directory: string;

/** Entrées d'une archive, relues par leurs en-têtes locaux : ce qu'un outil d'extraction en tire. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressed = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const name = archive.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength;
    entries.set(name, inflateRawSync(archive.subarray(start, start + compressed)));
    offset = start + compressed;
  }
  return entries;
}

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

test("l'archive contient l'exécutable intact et des instructions qui citent son empreinte", async () => {
  const folder = path.join(directory, "archive");
  await mkdir(folder);
  // Contenu répétitif : la compression doit se voir sur la taille.
  const content = Buffer.alloc(200_000, "MZ altboard ");
  await writeFile(path.join(folder, AGENT_FILE_NAME), content);
  const agent = (await findAgent(folder))!;

  const archive = await archiveAgent(agent, "9.9.9");
  const entries = unzip(archive.data);

  assert.deepEqual([...entries.keys()], [AGENT_FILE_NAME, README_FILE_NAME]);
  assert.ok(entries.get(AGENT_FILE_NAME)!.equals(content));
  const readme = entries.get(README_FILE_NAME)!.toString("utf8");
  assert.match(readme, /^AltBoard Sync 9\.9\.9\r\n/);
  assert.match(readme, /World of Warcraft\\_forever_\\Interface\\AddOns/);
  assert.ok(readme.includes(`SHA-256 de ${AGENT_FILE_NAME} : ${agent.sha256}`));
  assert.ok(archive.size < content.length / 10);
  assert.equal(archive.size, archive.data.length);
  assert.equal(archive.sha256, createHash("sha256").update(archive.data).digest("hex"));
});

test("l'archive est gardée tant que l'exécutable et la version ne changent pas", async () => {
  const folder = path.join(directory, "memoire");
  await mkdir(folder);
  await writeFile(path.join(folder, AGENT_FILE_NAME), "version 1");
  const first = (await findAgent(folder))!;

  assert.equal(await archiveAgent(first, "1.0.0"), await archiveAgent(first, "1.0.0"));
  assert.notEqual(await archiveAgent(first, "1.0.1"), await archiveAgent(first, "1.0.0"));

  await writeFile(path.join(folder, AGENT_FILE_NAME), "version 2");
  const second = (await findAgent(folder))!;
  const replaced = await archiveAgent(second, "1.0.0");
  assert.ok(unzip(replaced.data).get(AGENT_FILE_NAME)!.equals(Buffer.from("version 2")));
});

test("sans version connue, les instructions n'en affichent pas", async () => {
  const folder = path.join(directory, "sans-version");
  await mkdir(folder);
  await writeFile(path.join(folder, AGENT_FILE_NAME), "MZ");
  const archive = await archiveAgent((await findAgent(folder))!, null);

  assert.match(unzip(archive.data).get(README_FILE_NAME)!.toString("utf8"), /^AltBoard Sync\r\n/);
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
