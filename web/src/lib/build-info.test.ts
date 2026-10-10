import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { readAgentVersion, readBuildInfo, readCommit } from "./build-info";

const HASH = "4381cf0a1b2c3d4e5f60718293a4b5c6d7e8f901";
const OTHER = "bcfd352d6960e0616c47c00ef546d0f2b9867616";
const directories: string[] = [];

/** Dossier temporaire garni des fichiers donnés (chemin relatif → contenu). */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "wab-build-info-"));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test("le commit d'une branche se lit dans sa référence, abrégé", () => {
  const repo = tree({ ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": `${HASH}\n` });
  assert.equal(readCommit(repo), "4381cf0");
});

test("la référence d'une branche l'emporte sur packed-refs, qui sert à défaut", () => {
  const packed = `# pack-refs with: peeled fully-peeled sorted \n${OTHER} refs/heads/main\n${HASH} refs/heads/feat/x\n`;

  assert.equal(readCommit(tree({ ".git/HEAD": "ref: refs/heads/main\n", ".git/packed-refs": packed })), "bcfd352");
  assert.equal(readCommit(tree({ ".git/HEAD": "ref: refs/heads/feat/x\r\n", ".git/packed-refs": packed })), "4381cf0");
  assert.equal(
    readCommit(tree({ ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": `${HASH}\n`, ".git/packed-refs": packed })),
    "4381cf0",
  );
});

test("un commit extrait sans branche se lit directement dans HEAD", () => {
  assert.equal(readCommit(tree({ ".git/HEAD": `${HASH}\n` })), "4381cf0");
});

test("sans dépôt lisible, pas de commit plutôt qu'une valeur douteuse", () => {
  assert.equal(readCommit(tree({})), null);
  assert.equal(readCommit(tree({ ".git/HEAD": "ref: refs/heads/main\n" })), null);
  assert.equal(readCommit(tree({ ".git/HEAD": "ref: ../../etc/passwd\n" })), null);
  assert.equal(readCommit(tree({ ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": "pas un commit\n" })), null);
});

test("la version de l'agent vient de Directory.Build.props", () => {
  const props = "<Project>\r\n  <PropertyGroup>\r\n    <Version>0.4.0</Version>\r\n  </PropertyGroup>\r\n</Project>\r\n";

  assert.equal(readAgentVersion(tree({ "agent/Directory.Build.props": props })), "0.4.0");
  assert.equal(readAgentVersion(tree({ "agent/Directory.Build.props": "<Project />" })), null);
  assert.equal(readAgentVersion(tree({})), null);
});

test("les informations de construction tolèrent chaque absence", () => {
  const now = new Date("2026-10-10T18:41:00Z");
  const web = tree({ "package.json": '{ "name": "wow-altboard-web", "version": "0.1.0" }' });
  const repo = tree({
    ".git/HEAD": `${HASH}\n`,
    "agent/Directory.Build.props": "<Project><PropertyGroup><Version>0.4.0</Version></PropertyGroup></Project>",
  });

  assert.deepEqual(readBuildInfo(web, repo, now), { siteVersion: "0.1.0", commit: "4381cf0", agentVersion: "0.4.0", builtAt: "2026-10-10T18:41:00.000Z" });
  assert.deepEqual(readBuildInfo(tree({ "package.json": "illisible" }), tree({}), now), {
    siteVersion: null,
    commit: null,
    agentVersion: null,
    builtAt: "2026-10-10T18:41:00.000Z",
  });
});

test("le dépôt réel donne un commit et la version de l'agent", () => {
  const web = path.resolve(import.meta.dirname, "../..");
  const info = readBuildInfo(web, path.resolve(web, ".."), new Date());

  assert.match(info.siteVersion ?? "", /^\d+\.\d+\.\d+/);
  assert.match(info.agentVersion ?? "", /^\d+\.\d+\.\d+/);
  // Absent d'une archive sans .git ; présent, il a la forme d'un commit abrégé.
  if (info.commit !== null) assert.match(info.commit, /^[0-9a-f]{7}$/);
});
