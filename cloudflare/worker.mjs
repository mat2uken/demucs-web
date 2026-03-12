const MODEL_PATH = '/model/htdemucs_embedded.onnx';
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';

function withCorsHeaders(headersLike) {
  const headers = new Headers(headersLike);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return headers;
}

async function proxyModel(request) {
  const upstream = await fetch(MODEL_URL, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: {
      // Request identity encoding to keep content-length stable when possible.
      'Accept-Encoding': 'identity',
    },
  });

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: withCorsHeaders(upstream.headers),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === MODEL_PATH) {
      return proxyModel(request);
    }

    return env.ASSETS.fetch(request);
  },
};
