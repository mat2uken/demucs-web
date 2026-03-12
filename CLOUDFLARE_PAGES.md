# Cloudflare Pages Setup

This repository is prepared for Cloudflare Pages Git integration.

Build settings:
- Framework preset: `None`
- Build command: `npm run prepare:cloudflare-pages`
- Build output directory: `deploy-cloudflare-pages`
- Root directory: leave blank

Notes:
- The generated static package includes `_headers` with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`.
- The ONNX model is not uploaded to Cloudflare Pages because Pages static assets are limited to 25 MiB per file.
- The deployed site downloads the model from Hugging Face by default.

Optional:
- If the Pages build image needs an explicit Node version, set `NODE_VERSION=20` in the Pages project environment variables.
