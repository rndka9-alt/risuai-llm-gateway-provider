import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { minify } from 'terser';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);

// 설정은 pluginStorage를 원천으로 삼고 registerSetting 화면에서만 관리한다.
const BANNER = `/*!
//@name llm-gateway-provider
//@display-name LLM Gateway Provider
//@version ${version}
//@api 3.0
//@update-url https://raw.githubusercontent.com/rndka9-alt/risuai-llm-gateway-provider/main/plugin.min.js
*/`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'llm-gateway-provider-'));
try {
  const generatedCssPath = join(temporaryDirectory, 'settings.css');
  const tailwindPackagePath = require.resolve('@tailwindcss/cli/package.json');
  const tailwindCliPath = join(dirname(tailwindPackagePath), 'dist', 'index.mjs');
  await executeFile(process.execPath, [
    tailwindCliPath,
    '-i',
    'src/settings/styles/settings.css',
    '-o',
    generatedCssPath,
    '--minify',
  ]);
  const settingsStyles = await readFile(generatedCssPath, 'utf8');

  // 1. esbuild: TSX + generated Tailwind CSS → single IIFE bundle
  await build({
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    format: 'iife',
    target: 'esnext',
    platform: 'browser',
    outfile: 'plugin.js',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: {
      __SETTINGS_STYLES__: JSON.stringify(settingsStyles),
      __VERSION__: JSON.stringify(version),
    },
  });
} finally {
  await rm(temporaryDirectory, { recursive: true });
}

// 2. terser: minify (/*! */ 주석 보존)
const code = await readFile('plugin.js', 'utf8');
const result = await minify(code, {
  compress: { passes: 2 },
  mangle: true,
  format: {
    comments: /^!/,
    semicolons: true,
  },
});

await writeFile('plugin.min.js', BANNER + '\n' + result.code);

const raw = Buffer.byteLength(code);
const min = Buffer.byteLength(BANNER + '\n' + result.code);
console.log(`plugin.js  → ${(raw / 1024).toFixed(1)} KB`);
console.log(`plugin.min.js → ${(min / 1024).toFixed(1)} KB (${((1 - min / raw) * 100).toFixed(0)}% 절감)`);
