import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'deploy-cloudflare-pages');

async function copyAndRewrite(sourcePath, targetPath, replacements) {
  let content = await readFile(sourcePath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.replaceAll(from, to);
  }
  await writeFile(targetPath, content);
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, 'models'), { recursive: true });

  await cp(path.join(rootDir, 'src'), path.join(outDir, 'src'), { recursive: true });
  await cp(path.join(rootDir, 'demo', 'index.html'), path.join(outDir, 'index.html'));

  const replacements = [
    ['../src/index.js', './src/index.js'],
    ['../models/htdemucs_embedded.onnx', './models/htdemucs_embedded.onnx'],
  ];

  await copyAndRewrite(
    path.join(rootDir, 'demo', 'app.js'),
    path.join(outDir, 'app.js'),
    replacements
  );

  await copyAndRewrite(
    path.join(rootDir, 'demo', 'separation-worker.js'),
    path.join(outDir, 'separation-worker.js'),
    replacements
  );

  await writeFile(
    path.join(outDir, '_headers'),
    [
      '/*',
      '  Cross-Origin-Opener-Policy: same-origin',
      '  Cross-Origin-Embedder-Policy: require-corp',
      '  Access-Control-Allow-Origin: *',
      '',
    ].join('\n')
  );

  const readme = [
    '# Cloudflare Workers Deploy Package',
    '',
    'This folder is prepared specifically for Cloudflare Workers Builds.',
    '',
    'How this folder is used:',
    '1. The build step generates this folder.',
    '2. Wrangler deploys the Worker and serves these files as static assets.',
    '',
    'This package does not include the 172MB ONNX model file.',
    'Cloudflare Workers static assets have a 25 MiB per-file limit, so the model cannot be uploaded here as a static asset.',
    'The deployed Worker proxies /model/htdemucs_embedded.onnx to Hugging Face on the same origin.',
    '',
    'Required headers:',
    '- The included _headers file sets Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy for SharedArrayBuffer.',
    '- Cloudflare static assets parse _headers from the generated output directory.',
    '',
    'Files in this folder:',
    '- index.html',
    '- app.js',
    '- separation-worker.js',
    '- src/',
    '- _headers',
    '- models/README.txt',
    '',
    'Optional next step if you want to stop relying on Hugging Face later:',
    '- Put the model in Cloudflare R2 or another HTTPS object store.',
    '- Then change the model URL in separation-worker.js to that HTTPS URL.',
    '',
  ].join('\n');

  await writeFile(path.join(outDir, 'README.md'), readme);
  await writeFile(
    path.join(outDir, 'models', 'README.txt'),
    [
      'Optional local model location.',
      'Cloudflare Workers static assets cannot host the ONNX model here because static assets are limited to 25 MiB per file.',
      '',
      'Default package behavior:',
      '- The app calls /model/htdemucs_embedded.onnx on the same origin.',
      '- If you want to self-host the model, use Cloudflare R2 or another HTTPS object store and update separation-worker.js.',
      '',
    ].join('\n')
  );

  console.log(`Prepared static deploy package at: ${outDir}`);
  console.log('Cloudflare Workers package uses the same-origin /model proxy backed by Hugging Face.');
}

await main();
