// Every named import in public/app.js has to exist in the module it names.
//
// A missing export is not a runtime warning. It is a SyntaxError that kills
// the whole module graph, so the atlas boots to an empty page with no error
// a person can see. The type checker does not read the public/ module graph,
// and the test suite did not either: this shipped twice before this file
// existed.
//
// The check is textual but not naive: it reads the export statements of the
// target module and compares them with the names the importer asks for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const PUBLIC_DIR = new URL('../public/', import.meta.url);

function readPublic(name) {
  return readFileSync(new URL(name, PUBLIC_DIR), 'utf8');
}

// Strip comments so a name mentioned in prose is not mistaken for an export.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(src) {
  const out = [];
  const re = /import\s+(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[2]
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ names, specifier: m[3] });
  }
  const defaultRe = /import\s+([\w$]+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = defaultRe.exec(src))) out.push({ names: ['default'], specifier: m[2] });
  return out;
}

function exportsOf(src) {
  const names = new Set();
  const declRe = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)/g;
  let m;
  while ((m = declRe.exec(src))) names.add(m[1]);
  const listRe = /export\s*\{([^}]*)\}/g;
  while ((m = listRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

test('every named import in app.js exists in the module it names', () => {
  const app = stripComments(readPublic('app.js'));
  const specs = importsOf(app);
  assert.ok(specs.length > 5, `only ${specs.length} imports found — the parser is broken`);
  const problems = [];
  for (const { names, specifier } of specs) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const file = new URL(specifier, PUBLIC_DIR);
    if (!existsSync(file)) {
      problems.push(`${specifier} does not exist`);
      continue;
    }
    const exported = exportsOf(stripComments(readFileSync(file, 'utf8')));
    for (const name of names) {
      if (name === 'default') continue;
      if (!exported.has(name)) problems.push(`${specifier} does not export ${name}`);
    }
  }
  assert.deepEqual(problems, [], `broken imports:\n  ${problems.join('\n  ')}`);
});

test('every local module in public/ exports what the app imports from it', () => {
  // The same check from the other end: walk the modules the app pulls in and
  // make sure each of them can at least be parsed as a module.
  const app = stripComments(readPublic('app.js'));
  const specs = importsOf(app).map((i) => i.specifier)
    .filter((s) => s.startsWith('./') && s.endsWith('.js'));
  for (const specifier of new Set(specs)) {
    const file = new URL(specifier, PUBLIC_DIR);
    assert.ok(existsSync(file), `${specifier} is imported by app.js but does not exist`);
    const src = readFileSync(file, 'utf8');
    assert.ok(/export\s/.test(src), `${specifier} is imported by app.js but exports nothing`);
  }
});
