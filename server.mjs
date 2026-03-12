import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const requestedPort = Number(process.env.PORT || 8080);
const hasExplicitPort = Boolean(process.env.PORT);
let currentPort = requestedPort;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
};

function sendHeaders(res, statusCode, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...extraHeaders,
  });
}

function getLanUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => `http://${address.address}:${port}/`);
}

function resolveRequestPaths(urlPath) {
  if (urlPath === '/' || urlPath === '') {
    return [path.join(rootDir, 'demo', 'index.html')];
  }

  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  return [
    path.join(rootDir, normalized),
    path.join(rootDir, 'demo', normalized),
  ];
}

async function streamFile(filePath, res) {
  const stats = await fs.stat(filePath);

  if (stats.isDirectory()) {
    return streamFile(path.join(filePath, 'index.html'), res);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  sendHeaders(res, 200, {
    'Content-Length': stats.size,
    'Content-Type': contentType,
  });
  createReadStream(filePath).pipe(res);
}

async function serveFile(filePaths, res) {
  for (const filePath of filePaths) {
    try {
      await streamFile(filePath, res);
      return;
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }

      sendHeaders(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }
  }

  sendHeaders(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendHeaders(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const filePaths = resolveRequestPaths(requestUrl.pathname);
  await serveFile(filePaths, res);
});

function startServer(port) {
  currentPort = port;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Open http://localhost:${port}/ in your browser.`);
    for (const lanUrl of getLanUrls(port)) {
      console.log(`LAN access: ${lanUrl}`);
    }
  });
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !hasExplicitPort) {
    const nextPort = currentPort + 1;
    console.warn(`Port ${currentPort} is in use, retrying on ${nextPort}.`);
    startServer(nextPort);
    return;
  }

  console.error(error);
  process.exit(1);
});

startServer(requestedPort);
