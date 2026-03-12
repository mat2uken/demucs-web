/**
 * Demucs Web Demo App
 */
import { CONSTANTS } from '../src/index.js';

const { SAMPLE_RATE } = CONSTANTS;

// Global state
let worker = null;
let audioContext = null;
let loadedAudio = null;
let modelReady = false;
let isProcessing = false;
let processStartTime = null;
let resultUrls = [];

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const progressFill = document.getElementById('progressFill');
const status = document.getElementById('status');
const results = document.getElementById('results');
const trackList = document.getElementById('trackList');
const backendBadge = document.getElementById('backendBadge');
const audioFileName = document.getElementById('audioFileName');
const statusDetail = document.getElementById('statusDetail');
const statsRow = document.getElementById('statsRow');
const statElapsed = document.getElementById('statElapsed');
const statSegment = document.getElementById('statSegment');
const statSpeed = document.getElementById('statSpeed');
const statETA = document.getElementById('statETA');

const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm'];

function log(phase, message) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false });
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    logLine.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="log-phase">[${phase}]</span>${message}`;
    statusDetail.appendChild(logLine);
    statusDetail.scrollTop = statusDetail.scrollHeight;
    console.log(`[${phase}] ${message}`);
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: SAMPLE_RATE
        });
    }

    return audioContext;
}

function canHandleAudioFile(file) {
    if (!file) return false;

    if (typeof file.type === 'string' && file.type.startsWith('audio/')) {
        return true;
    }

    const lowerName = file.name.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function setBackendBadge(backend, threads) {
    if (backend === 'webgpu') {
        backendBadge.textContent = 'WebGPU (GPU加速)';
        backendBadge.style.background = 'rgba(100, 255, 218, 0.2)';
        backendBadge.style.color = '#64ffda';
        return;
    }

    backendBadge.textContent = `WebAssembly (CPU ${threads}線程)`;
    backendBadge.style.background = 'rgba(255, 200, 100, 0.2)';
    backendBadge.style.color = '#ffc864';
}

function updateProcessButton() {
    processBtn.disabled = !loadedAudio || !modelReady || isProcessing;
    fileInput.disabled = isProcessing;
}

function updateLoadedStatus() {
    if (!loadedAudio) {
        return;
    }

    const duration = loadedAudio.duration.toFixed(1);
    if (modelReady) {
        status.textContent = `已載入: ${duration}秒, ${loadedAudio.channels}聲道`;
    } else {
        status.textContent = `音訊已載入 (${duration}秒)，等待模型載入完成...`;
    }
}

function clearResults() {
    for (const url of resultUrls) {
        URL.revokeObjectURL(url);
    }
    resultUrls = [];
    trackList.innerHTML = '';
    results.classList.remove('visible');
}

function handleWorkerMessage(event) {
    const { type } = event.data;

    switch (type) {
        case 'backend':
            setBackendBadge(event.data.backend, event.data.threads);
            break;
        case 'status':
            if (!loadedAudio || !modelReady) {
                status.textContent = event.data.text;
            }
            break;
        case 'download-progress': {
            const { loaded, total } = event.data;
            const percent = ((loaded / total) * 100).toFixed(1);
            const loadedMB = (loaded / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            status.textContent = `下載模型中... ${loadedMB}MB / ${totalMB}MB (${percent}%)`;
            progressFill.style.width = (loaded / total * 100) + '%';
            break;
        }
        case 'model-ready':
            modelReady = true;
            updateLoadedStatus();
            if (!loadedAudio) {
                status.textContent = '模型載入完成，請選擇音訊檔案';
            }
            updateProcessButton();
            break;
        case 'log':
            log(event.data.phase, event.data.message);
            break;
        case 'progress': {
            const { progress, currentSegment, totalSegments } = event.data;
            progressFill.style.width = (5 + progress * 90) + '%';

            const elapsed = (Date.now() - processStartTime) / 1000;
            statElapsed.textContent = formatTime(elapsed);
            statSegment.textContent = `${currentSegment}/${totalSegments}`;

            if (currentSegment > 0 && loadedAudio) {
                const processedDuration = (currentSegment / totalSegments) * loadedAudio.duration;
                const speed = processedDuration / elapsed;
                statSpeed.textContent = speed.toFixed(2) + 'x';

                const remainingSegments = totalSegments - currentSegment;
                const avgTimePerSegment = elapsed / currentSegment;
                const eta = remainingSegments * avgTimePerSegment;
                statETA.textContent = formatTime(eta);
            }
            break;
        }
        case 'result': {
            isProcessing = false;
            updateProcessButton();
            displayResults(event.data.tracks);

            const totalTime = ((Date.now() - processStartTime) / 1000).toFixed(1);
            const speedRatio = (loadedAudio.duration / parseFloat(totalTime)).toFixed(2);

            log('完成', `總耗時: ${totalTime}秒, 處理速度: ${speedRatio}x 即時`);
            status.textContent = `處理完成！(${totalTime}秒, ${speedRatio}x 即時速度)`;
            progressFill.style.width = '100%';
            break;
        }
        case 'error':
            isProcessing = false;
            updateProcessButton();
            status.textContent = event.data.stage === 'init'
                ? `模型載入失敗: ${event.data.message}`
                : `處理失敗: ${event.data.message}`;
            console.error(`[${event.data.stage}]`, event.data.message);
            break;
        default:
            break;
    }
}

function initWorker() {
    worker = new Worker(new URL('./separation-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', (error) => {
        isProcessing = false;
        updateProcessButton();
        status.textContent = `Worker 啟動失敗: ${error.message}`;
        console.error('Worker error:', error);
    });
    worker.postMessage({ type: 'init' });
}

async function init() {
    ensureAudioContext();
    initWorker();
}

// Drag and drop handlers
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (canHandleAudioFile(file)) {
        handleFile(file);
        return;
    }

    status.textContent = '未支援的檔案格式。請使用 WAV, MP3, M4A, AAC，或瀏覽器可解碼的音訊格式。';
});
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

async function handleFile(file) {
    audioFileName.textContent = file.name;
    status.textContent = '讀取音訊檔案...';
    clearResults();
    updateProcessButton();

    try {
        const context = ensureAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const decodedAudio = await context.decodeAudioData(arrayBuffer);
        const left = new Float32Array(decodedAudio.getChannelData(0));
        const right = decodedAudio.numberOfChannels > 1
            ? new Float32Array(decodedAudio.getChannelData(1))
            : new Float32Array(left);

        loadedAudio = {
            name: file.name,
            channels: decodedAudio.numberOfChannels,
            duration: decodedAudio.duration,
            left,
            right,
            sampleRate: decodedAudio.sampleRate
        };

        updateLoadedStatus();
        updateProcessButton();
    } catch (e) {
        loadedAudio = null;
        updateProcessButton();
        status.textContent = '無法讀取音訊檔案。建議先改用 WAV, MP3, M4A, AAC 再試。';
        console.error('Failed to decode audio:', e);
    }
}

processBtn.addEventListener('click', async () => {
    if (!loadedAudio || !modelReady || isProcessing) return;

    isProcessing = true;
    updateProcessButton();
    clearResults();
    processStartTime = Date.now();
    statusDetail.innerHTML = '';
    statusDetail.classList.add('visible');
    statsRow.style.display = 'flex';
    statElapsed.textContent = '0:00';
    statSegment.textContent = '0/0';
    statSpeed.textContent = '-';
    statETA.textContent = '--:--';

    const left = new Float32Array(loadedAudio.left);
    const right = new Float32Array(loadedAudio.right);

    log('初始化', '開始處理音訊...');
    if (loadedAudio.sampleRate !== SAMPLE_RATE) {
        log('重取樣', `${loadedAudio.sampleRate}Hz → ${SAMPLE_RATE}Hz`);
    }

    status.textContent = '處理中...';
    progressFill.style.width = '2%';

    worker.postMessage({
        type: 'separate',
        left,
        right,
        sampleRate: loadedAudio.sampleRate
    }, [left.buffer, right.buffer]);
});

function displayResults(tracks) {
    clearResults();

    for (const [name, track] of Object.entries(tracks)) {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track';

        const trackBuffer = audioContext.createBuffer(2, track.left.length, SAMPLE_RATE);
        trackBuffer.getChannelData(0).set(track.left);
        trackBuffer.getChannelData(1).set(track.right);

        const audioBlob = audioBufferToWav(trackBuffer);
        const audioUrl = URL.createObjectURL(audioBlob);
        resultUrls.push(audioUrl);

        trackDiv.innerHTML = `
            <span class="track-name">${name.charAt(0).toUpperCase() + name.slice(1)}</span>
            <div class="track-controls">
                <audio controls src="${audioUrl}" style="height: 32px;"></audio>
                <a href="${audioUrl}" download="${name}.wav" class="track-btn">下載</a>
            </div>
        `;

        trackList.appendChild(trackDiv);
    }

    results.classList.add('visible');
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const samples = buffer.length;
    const dataSize = samples * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let c = 0; c < numChannels; c++) {
        channels.push(buffer.getChannelData(c));
    }

    let offset = 44;
    for (let i = 0; i < samples; i++) {
        for (let c = 0; c < numChannels; c++) {
            const sample = Math.max(-1, Math.min(1, channels[c][i]));
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

init();
