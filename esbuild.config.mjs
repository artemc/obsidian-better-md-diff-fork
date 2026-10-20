import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

const production = process.argv.includes('production');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
  banner: { js: `/*! ${manifest.name}\n${await readFile('LICENSE', 'utf8')}\nBundled dependency: diff\n${await readFile('node_modules/diff/LICENSE', 'utf8')}\n*/` },
});

if (production) {
  await context.rebuild();
  await context.dispose();
  await mkdir(`dist/${manifest.id}`, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    await copyFile(file, `dist/${manifest.id}/${file}`);
  }
} else {
  await context.watch();
}
