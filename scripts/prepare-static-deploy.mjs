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

  const workerReplacements = [
    ...replacements,
    ["const LOCAL_MODEL_URL = './models/htdemucs_embedded.onnx';\n", ''],
    [
      `  try {
    try {
      post('status', { text: '從 Hugging Face 下載模型中 (約 172MB)...' });
      await processor.loadModel(DEFAULT_MODEL_URL);
    } catch {
      post('status', { text: '載入本地模型...' });
      await processor.loadModel(LOCAL_MODEL_URL);
    }

    modelReady = true;
    post('model-ready');
  } catch (error) {
    post('error', { stage: 'init', message: error.message });
  }
`,
      `  try {
    post('status', { text: '從 Hugging Face 下載模型中 (約 172MB)...' });
    await processor.loadModel(DEFAULT_MODEL_URL);
    modelReady = true;
    post('model-ready');
  } catch (error) {
    post('error', {
      stage: 'init',
      message: \`\${error.message} (Cloudflare Pages package expects the model to load from Hugging Face or another external HTTPS URL.)\`
    });
  }
`
    ],
  ];

  await copyAndRewrite(
    path.join(rootDir, 'demo', 'separation-worker.js'),
    path.join(outDir, 'separation-worker.js'),
    workerReplacements
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
    '# Cloudflare Pages Deploy Package',
    '',
    'This folder is prepared specifically for Cloudflare Pages.',
    '',
    'How to deploy with Cloudflare Pages Direct Upload:',
    '1. Open Cloudflare Dashboard > Workers & Pages.',
    '2. Create application > Pages > Direct Upload.',
    '3. Upload the contents of this folder, or drag this folder itself.',
    '4. Deploy the site.',
    '',
    'This package does not include the 172MB ONNX model file.',
    'Cloudflare Pages has a 25 MiB per-asset limit, so the model cannot be uploaded there as a static asset.',
    'The app will download the model from Hugging Face instead.',
    '',
    'Required headers:',
    '- The included _headers file sets Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy for SharedArrayBuffer.',
    '- Cloudflare Pages parses _headers from the static output directory.',
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
      'Cloudflare Pages cannot host the ONNX model here because Pages static assets are limited to 25 MiB per file.',
      '',
      'Default package behavior:',
      '- The app downloads the model from Hugging Face.',
      '- If you want to self-host the model, use Cloudflare R2 or another HTTPS object store and update separation-worker.js.',
      '',
    ].join('\n')
  );

  console.log(`Prepared static deploy package at: ${outDir}`);
  console.log('Cloudflare Pages package uses the Hugging Face model URL by default.');
}

await main();
