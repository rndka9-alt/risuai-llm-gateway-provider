import { build } from 'esbuild';
import { minify } from 'terser';
import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const BANNER = `/*!
//@name llm-gateway-provider
//@display-name LLM Gateway Provider
//@version ${version}
//@api 3.0
//@arg api_key string LLM Gateway API 키 (llmgtwy_...)
//@arg model string 모델 ID (예: gpt-5.6)
//@arg base_url string 셀프호스팅 endpoint. 비우면 https://api.llmgateway.io/v1
//@update-url https://raw.githubusercontent.com/rndka9-alt/risuai-llm-gateway-provider/main/plugin.min.js
*/`;

// 1. esbuild: TS → single JS bundle
await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  format: 'iife',
  target: 'esnext',
  platform: 'browser',
  outfile: 'plugin.js',
  define: { __VERSION__: JSON.stringify(version) },
});

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
