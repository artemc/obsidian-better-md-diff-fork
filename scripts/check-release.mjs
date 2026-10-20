import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const versions = await json('versions.json');
const versionPattern = /^\d+\.\d+\.\d+$/;

for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
  assert(typeof manifest[key] === 'string' && manifest[key].trim(), `Missing manifest.${key}`);
}
assert(/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id), 'Use a lowercase, hyphenated plugin ID');
assert(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'), 'Invalid plugin ID');
assert(!/obsidian|plugin/i.test(manifest.name), 'Plugin name must not contain Obsidian or Plugin');
assert(versionPattern.test(manifest.version) && versionPattern.test(manifest.minAppVersion), 'Use x.y.z versions');
assert(manifest.isDesktopOnly === true, 'Local Git requires desktop-only mode');
assert(manifest.description.length <= 250 && manifest.description.endsWith('.'), 'Use a short description ending in a period');
assert.equal(pkg.version, manifest.version, 'Package and manifest versions differ');
assert.equal(lock.version, manifest.version, 'Lockfile version differs');
assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root package version differs');
if (process.env.RELEASE_TAG !== undefined) assert.equal(process.env.RELEASE_TAG, manifest.version, 'Release tag must exactly match manifest.version (no v prefix)');
assert.equal(versions[manifest.version], manifest.minAppVersion, 'Missing compatibility entry');
assert.equal(pkg.license, 'MIT');

for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const source = await readFile(name);
  const asset = await readFile(`dist/${manifest.id}/${name}`);
  assert(source.length > 0 && source.equals(asset), `Release asset differs: ${name}`);
}
const bundle = await readFile('main.js', 'utf8');
for (const license of ['LICENSE', 'node_modules/diff/LICENSE']) {
  assert(bundle.includes((await readFile(license, 'utf8')).trim()), `Missing bundled license: ${license}`);
}
const readme = await readFile('README.md', 'utf8');
assert(readme.includes('## Installation') && readme.includes('## Usage'), 'Keep the README installation and usage sections');

// Everything shipped or documented is English. Tests and host scripts keep deliberate Unicode fixtures.
const nonEnglish = /[\p{Script=Han}\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const textFiles = /\.(?:ts|mjs|js|json|css|md|yml)$/;
async function* walk(path) {
  const entry = await stat(path);
  if (entry.isFile()) { yield path; return; }
  for (const name of await readdir(path)) yield* walk(join(path, name));
}
const languageRoots = ['src', 'docs', '.github', 'README.md', 'CONTRIBUTING.md', 'manifest.json', 'package.json', 'versions.json', 'styles.css',
  'esbuild.config.mjs', 'eslint.config.mjs', 'version-bump.mjs', 'scripts/check-release.mjs', 'scripts/check-large-documents.mjs'];
for (const root of languageRoots) {
  for await (const file of walk(root)) {
    if (!textFiles.test(file)) continue;
    const line = (await readFile(file, 'utf8')).split('\n').findIndex((text) => nonEnglish.test(text));
    assert(line < 0, `Non-English text in ${file}:${line + 1}; the project is English only`);
  }
}
console.log(`Release ${manifest.version} validated. Use tag ${manifest.version} (without a v prefix).`);
