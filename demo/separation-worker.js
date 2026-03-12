import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs';
import { DemucsProcessor, CONSTANTS } from '../src/index.js';

const { SAMPLE_RATE, DEFAULT_MODEL_URL } = CONSTANTS;
const LOCAL_MODEL_URL = '../models/htdemucs_embedded.onnx';

let processor = null;
let modelReady = false;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function resampleChannels(leftChannel, rightChannel, sourceSampleRate) {
  if (sourceSampleRate === SAMPLE_RATE) {
    return { leftChannel, rightChannel };
  }

  const ratio = SAMPLE_RATE / sourceSampleRate;
  const newLength = Math.floor(leftChannel.length * ratio);
  const newLeft = new Float32Array(newLength);
  const newRight = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIdx = i / ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, leftChannel.length - 1);
    const frac = srcIdx - idx0;
    newLeft[i] = leftChannel[idx0] * (1 - frac) + leftChannel[idx1] * frac;
    newRight[i] = rightChannel[idx0] * (1 - frac) + rightChannel[idx1] * frac;
  }

  return { leftChannel: newLeft, rightChannel: newRight };
}

async function detectBackend() {
  if ('gpu' in navigator) {
    try {
      const gpuAdapter = await navigator.gpu.requestAdapter();
      if (gpuAdapter) {
        return 'webgpu';
      }
    } catch (error) {
      console.log('WebGPU not available in worker:', error);
    }
  }

  return 'wasm';
}

async function initProcessor() {
  if (processor) {
    if (modelReady) {
      post('model-ready');
    }
    return;
  }

  const backend = await detectBackend();
  const threads = navigator.hardwareConcurrency || 4;

  ort.env.wasm.numThreads = threads;
  if (backend === 'webgpu') {
    ort.env.webgpu = ort.env.webgpu || {};
    ort.env.webgpu.powerPreference = 'high-performance';
  }

  post('backend', { backend, threads });
  post('status', { text: '載入模型中...' });

  processor = new DemucsProcessor({
    ort,
    onProgress: ({ progress, currentSegment, totalSegments }) => {
      post('progress', { progress, currentSegment, totalSegments });
    },
    onLog: (phase, message) => {
      post('log', { phase, message });
    },
    onDownloadProgress: (loaded, total) => {
      post('download-progress', { loaded, total });
    }
  });

  try {
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
}

self.addEventListener('message', async (event) => {
  const { type } = event.data;

  if (type === 'init') {
    await initProcessor();
    return;
  }

  if (type !== 'separate') {
    return;
  }

  if (!modelReady || !processor) {
    post('error', { stage: 'separate', message: 'Model not loaded yet.' });
    return;
  }

  try {
    let { left, right, sampleRate } = event.data;
    if (!(left instanceof Float32Array)) {
      left = new Float32Array(left);
    }
    if (!(right instanceof Float32Array)) {
      right = new Float32Array(right);
    }

    if (sampleRate !== SAMPLE_RATE) {
      ({ leftChannel: left, rightChannel: right } = resampleChannels(left, right, sampleRate));
    }

    const tracks = await processor.separate(left, right);
    const transferables = [];

    for (const track of Object.values(tracks)) {
      transferables.push(track.left.buffer, track.right.buffer);
    }

    self.postMessage({ type: 'result', tracks }, transferables);
  } catch (error) {
    post('error', { stage: 'separate', message: error.message });
  }
});
