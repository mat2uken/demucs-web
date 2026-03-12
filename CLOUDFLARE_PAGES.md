# Cloudflare Workers Builds Setup

This repository is prepared for Cloudflare Workers Builds Git integration.

Build settings:
- Build command: `npm run prepare:cloudflare-pages`
- Deploy command: `npx wrangler deploy`
- Non-production branch deploy command: `npx wrangler versions upload`
- Path / Root directory: leave blank

Notes:
- The build step generates `deploy-cloudflare-pages/`.
- `wrangler.jsonc` points Workers static assets to `deploy-cloudflare-pages/`.
- The generated static package includes `_headers` with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`.
- The ONNX model is not uploaded to Workers static assets because the per-file limit is 25 MiB.
- The deployed site downloads the model from Hugging Face by default.

Optional:
- If the build image needs an explicit Node version, set `NODE_VERSION=20` in the Worker build environment variables.
