import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Le contrôle de session du layout ne protège aucune page : Next rend la page sans attendre le
// layout, et ne rend pas le layout du tout lors d'une navigation interne. Chaque page vérifie donc
// la session elle-même, avant toute lecture. Ce test lit le source : aucun test n'exécute une page.

const APP = path.resolve(import.meta.dirname, "../../app");
/** Pages servies sans session. */
const PUBLIC_PAGES = new Set(["login/page.tsx"]);
/** Exports qu'une page peut ajouter à son composant et que Next appelle à chaque requête. */
const REQUEST_EXPORTS = new Set(["generateMetadata", "generateViewport"]);

function startsWithSessionCheck(body: ts.Block): boolean {
  const first = body.statements.at(0);
  if (!first) return false;
  const expression = ts.isExpressionStatement(first)
    ? first.expression
    : ts.isVariableStatement(first)
      ? first.declarationList.declarations.at(0)?.initializer
      : undefined;
  if (!expression || !ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return false;
  const callee = expression.expression.expression;
  return ts.isIdentifier(callee) && callee.text === "requireSession";
}

function importsRequireSession(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    const bindings = statement.importClause?.namedBindings;
    return (
      statement.moduleSpecifier.text === "@/lib/auth/session" &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === "requireSession" && element.propertyName === undefined)
    );
  });
}

/** Ce qui, dans le source d'une page, laisserait rendre du contenu sans session vérifiée. */
function unguarded(text: string): string[] {
  const source = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const exported = (node: ts.HasModifiers, kind: ts.SyntaxKind) => (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
  const failures: string[] = [];
  let component = false;

  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && exported(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "";
        if (REQUEST_EXPORTS.has(name)) failures.push(`${name} : à écrire en déclaration de fonction`);
      }
    }
    if (!ts.isFunctionDeclaration(statement) || !exported(statement, ts.SyntaxKind.ExportKeyword)) continue;
    const isComponent = exported(statement, ts.SyntaxKind.DefaultKeyword);
    const name = statement.name?.text ?? "default";
    if (isComponent) component = true;
    else if (!REQUEST_EXPORTS.has(name)) continue;
    if (!statement.body || !startsWithSessionCheck(statement.body)) failures.push(`${name} : ne commence pas par « await requireSession() »`);
  }

  if (!component) failures.push("export default : déclaration de fonction attendue");
  if (!importsRequireSession(source)) failures.push("requireSession n'est pas importé de @/lib/auth/session");
  return failures;
}

const pages = readdirSync(APP, { recursive: true, encoding: "utf8" })
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => path.posix.basename(file) === "page.tsx")
  .sort();

test("les pages du site sont trouvées, la page de connexion est la seule publique", () => {
  assert.ok(pages.length > PUBLIC_PAGES.size, "aucune page privée trouvée : chemin de src/app à revoir");
  for (const page of PUBLIC_PAGES) assert.ok(pages.includes(page), `page publique introuvable : ${page}`);
});

for (const page of pages.filter((file) => !PUBLIC_PAGES.has(file))) {
  test(`${page} vérifie la session avant toute lecture`, () => {
    assert.deepEqual(unguarded(readFileSync(path.join(APP, page), "utf8")), []);
  });
}

const IMPORT = 'import { requireSession } from "@/lib/auth/session";\n';

test("une page conforme passe, avec ou sans usage de la session rendue", () => {
  assert.deepEqual(unguarded(`${IMPORT}export default async function Page() {\n  await requireSession();\n  return null;\n}\n`), []);
  assert.deepEqual(unguarded(`${IMPORT}export default async function Page() {\n  const session = await requireSession();\n  return session.email;\n}\n`), []);
});

test("un contrôle absent, tardif ou non attendu est refusé", () => {
  const refused = [
    "export default async function Page() {\n  return null;\n}\n",
    "export default async function Page() {\n  const rows = await list();\n  await requireSession();\n  return rows;\n}\n",
    "export default async function Page() {\n  requireSession();\n  return null;\n}\n",
    "export default async function Page() {\n  if (flag) await requireSession();\n  return null;\n}\n",
  ];
  for (const body of refused) assert.deepEqual(unguarded(IMPORT + body), ["Page : ne commence pas par « await requireSession() »"], body);
});

test("generateMetadata est contrôlé comme le composant", () => {
  const component = "export default async function Page() {\n  await requireSession();\n  return null;\n}\n";

  assert.deepEqual(unguarded(`${IMPORT}export async function generateMetadata() {\n  return { title: await name() };\n}\n${component}`), [
    "generateMetadata : ne commence pas par « await requireSession() »",
  ]);
  assert.deepEqual(unguarded(`${IMPORT}export const generateMetadata = async () => ({ title: await name() });\n${component}`), [
    "generateMetadata : à écrire en déclaration de fonction",
  ]);
  assert.deepEqual(unguarded(`${IMPORT}export const metadata = { title: "Machines" };\n${component}`), []);
});

test("un composant exporté autrement, ou un autre requireSession, est refusé", () => {
  assert.deepEqual(unguarded(`${IMPORT}const Page = async () => {\n  await requireSession();\n  return null;\n};\nexport default Page;\n`), [
    "export default : déclaration de fonction attendue",
  ]);
  assert.deepEqual(unguarded('import { requireSession } from "./fake";\nexport default async function Page() {\n  await requireSession();\n  return null;\n}\n'), [
    "requireSession n'est pas importé de @/lib/auth/session",
  ]);
});
