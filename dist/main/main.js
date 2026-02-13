/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/main/main.ts"
/*!**************************!*\
  !*** ./src/main/main.ts ***!
  \**************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const electron_1 = __webpack_require__(/*! electron */ "electron");
const child_process_1 = __webpack_require__(/*! child_process */ "child_process");
const path = __importStar(__webpack_require__(/*! path */ "path"));
const electron_store_1 = __importDefault(__webpack_require__(/*! electron-store */ "electron-store"));
const types_1 = __webpack_require__(/*! ../shared/types */ "./src/shared/types.ts");
const openai_transcription_1 = __webpack_require__(/*! ./openai-transcription */ "./src/main/openai-transcription.ts");
const whisper_live_client_1 = __webpack_require__(/*! ./whisper-live-client */ "./src/main/whisper-live-client.ts");
// Initialize settings store
const store = new electron_store_1.default({
    defaults: {
        settings: types_1.DEFAULT_SETTINGS,
    },
});
// Window references
let controlWindow = null;
let overlayWindow = null;
let tray = null;
// State
let transcriptionState = 'idle';
let transcriptionService = null;
let whisperLiveClient = null;
let useWhisperLive = true; // Toggle between WhisperLive and OpenAI API
// WhisperLive server config (can be made configurable via settings)
const WHISPER_LIVE_CONFIG = {
    host: 'localhost',
    port: 9090,
    useVad: true,
    model: 'tiny',
};
// macOS system audio capture
let systemAudioProc = null;
// Audio format constants (matching DESKTOP_AUDIO_CAPTURE_RESEARCH.md)
const CAPTURE_SAMPLE_RATE = 24000; // From native binary
const WHISPER_SAMPLE_RATE = 16000; // Required by Whisper
const CHANNELS = 2; // stereo from native binary
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHUNK_DURATION = 0.1; // 100ms chunks
const CHUNK_SIZE = CAPTURE_SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;
function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4; // 4 bytes per stereo sample pair
    const monoBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }
    return monoBuffer;
}
function resampleInt16(input, fromRate, toRate) {
    if (fromRate === toRate)
        return input;
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
        const fraction = srcIndex - srcIndexFloor;
        // Linear interpolation
        output[i] = Math.round(input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction);
    }
    return output;
}
function int16ToFloat32(int16Data) {
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
    }
    return float32Data;
}
function startMacOSAudioCapture() {
    if (process.platform !== 'darwin')
        return false;
    // Path to native binary
    const binaryPath = electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'SystemAudioDump')
        : path.join(electron_1.app.getAppPath(), 'assets', 'SystemAudioDump');
    console.log('Starting macOS audio capture, binary path:', binaryPath);
    // Check if binary exists
    const fs = __webpack_require__(/*! fs */ "fs");
    if (!fs.existsSync(binaryPath)) {
        console.error('SystemAudioDump binary not found at:', binaryPath);
        return false;
    }
    console.log('Binary exists, spawning...');
    try {
        systemAudioProc = (0, child_process_1.spawn)(binaryPath, [], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let audioBuffer = Buffer.alloc(0);
        let totalBytesReceived = 0;
        systemAudioProc.stdout?.on('data', (data) => {
            totalBytesReceived += data.length;
            if (totalBytesReceived % 50000 < data.length) {
                console.log('Audio data received, total bytes:', totalBytesReceived);
            }
            audioBuffer = Buffer.concat([audioBuffer, data]);
            // Process in chunks
            while (audioBuffer.length >= CHUNK_SIZE) {
                const chunk = audioBuffer.slice(0, CHUNK_SIZE);
                audioBuffer = audioBuffer.slice(CHUNK_SIZE);
                // Convert stereo to mono (Int16)
                const monoChunk = convertStereoToMono(chunk);
                const int16Data = new Int16Array(monoChunk.buffer, monoChunk.byteOffset, monoChunk.length / 2);
                if (useWhisperLive && whisperLiveClient?.connected) {
                    // Stream directly to WhisperLive server
                    // Resample from 24kHz to 16kHz and send as Int16 bytes
                    const resampled = resampleInt16(int16Data, CAPTURE_SAMPLE_RATE, WHISPER_SAMPLE_RATE);
                    whisperLiveClient.sendAudioInt16(resampled);
                }
                else {
                    // Send to renderer for OpenAI API batching
                    const base64Data = monoChunk.toString('base64');
                    controlWindow?.webContents.send(types_1.IPC_CHANNELS.SYSTEM_AUDIO_DATA, { data: base64Data });
                }
            }
        });
        systemAudioProc.stderr?.on('data', (data) => {
            console.log('SystemAudioDump stderr:', data.toString());
        });
        systemAudioProc.on('close', (code) => {
            console.log('SystemAudioDump closed with code:', code);
            systemAudioProc = null;
        });
        systemAudioProc.on('error', (err) => {
            console.error('Failed to start SystemAudioDump:', err.message);
            systemAudioProc = null;
        });
        console.log('SystemAudioDump spawned, PID:', systemAudioProc.pid);
        return true;
    }
    catch (error) {
        console.error('Failed to spawn SystemAudioDump:', error);
        return false;
    }
}
function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
        console.log('macOS audio capture stopped');
    }
}
function setupWindowsLoopbackHandler() {
    if (process.platform !== 'win32')
        return;
    // Setup native loopback audio capture handler for Windows
    electron_1.session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        electron_1.desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            // Grant access to first screen with loopback audio
            callback({ video: sources[0], audio: 'loopback' });
        }).catch((error) => {
            console.error('Failed to get sources:', error);
            callback({});
        });
    });
    console.log('Windows loopback handler configured');
}
function getSettings() {
    return store.get('settings');
}
function updateSettings(newSettings) {
    const current = getSettings();
    const updated = { ...current, ...newSettings };
    store.set('settings', updated);
    return updated;
}
function createControlWindow() {
    const settings = getSettings();
    controlWindow = new electron_1.BrowserWindow({
        width: 500,
        height: 650,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        maximizable: true,
        title: 'Language Agent',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-control.js'),
        },
    });
    controlWindow.loadFile(path.join(__dirname, '../renderer/control/index.html'));
    // Open DevTools for debugging
    controlWindow.webContents.openDevTools();
    controlWindow.on('close', (event) => {
        if (settings.minimizeToTray && tray) {
            event.preventDefault();
            controlWindow?.hide();
        }
    });
    controlWindow.on('closed', () => {
        controlWindow = null;
    });
}
function createOverlayWindow() {
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    overlayWindow = new electron_1.BrowserWindow({
        width: Math.min(800, width - 100), // Not full width
        height: 120,
        x: Math.floor((width - Math.min(800, width - 100)) / 2), // Centered
        y: height - 140, // Near bottom
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        show: false, // Don't show on creation
        backgroundColor: '#00000000', // Fully transparent background
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-overlay.js'),
        },
    });
    overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay/index.html'));
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    // Set window level to float above other windows
    overlayWindow.setAlwaysOnTop(true, 'floating');
    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}
function createTray() {
    // Create a simple tray icon (16x16 transparent PNG would be ideal)
    const icon = electron_1.nativeImage.createEmpty();
    tray = new electron_1.Tray(icon);
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: 'Show Control Panel',
            click: () => {
                controlWindow?.show();
                controlWindow?.focus();
            },
        },
        {
            label: 'Toggle Transcription',
            click: () => {
                toggleTranscription();
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                electron_1.app.quit();
            },
        },
    ]);
    tray.setToolTip('Language Agent');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        controlWindow?.show();
        controlWindow?.focus();
    });
}
function registerShortcuts() {
    const settings = getSettings();
    // Toggle transcription shortcut
    electron_1.globalShortcut.register(settings.toggleShortcut, () => {
        toggleTranscription();
    });
    // Show/hide overlay shortcut
    electron_1.globalShortcut.register(settings.showHideShortcut, () => {
        if (overlayWindow?.isVisible()) {
            overlayWindow.hide();
        }
        else {
            overlayWindow?.show();
        }
    });
}
async function toggleTranscription() {
    if (transcriptionState === 'active') {
        await stopTranscription();
    }
    else if (transcriptionState === 'idle') {
        await startTranscription();
    }
}
async function startTranscription() {
    if (transcriptionState !== 'idle') {
        return { success: false, error: 'Already running or transitioning' };
    }
    try {
        updateState('starting');
        const settings = getSettings();
        if (useWhisperLive) {
            // Connect to WhisperLive server
            console.log('Connecting to WhisperLive server...');
            whisperLiveClient = new whisper_live_client_1.WhisperLiveClient({
                ...WHISPER_LIVE_CONFIG,
                language: settings.language === 'auto' ? undefined : settings.language,
            });
            // Set up transcription handler
            whisperLiveClient.on('transcription', (segments) => {
                // Get the latest segment
                const latest = segments[segments.length - 1];
                if (latest && latest.text.trim()) {
                    console.log('WhisperLive transcription:', latest.text);
                    sendTranscriptionToOverlay({
                        text: latest.text,
                        timestamp: Date.now(),
                        confidence: 1.0,
                        language: settings.language === 'auto' ? undefined : settings.language,
                    });
                }
            });
            whisperLiveClient.on('error', (error) => {
                console.error('WhisperLive error:', error);
                controlWindow?.webContents.send(types_1.IPC_CHANNELS.ERROR_OCCURRED, error.message || 'WhisperLive error');
            });
            whisperLiveClient.on('language-detected', (info) => {
                console.log('Language detected:', info);
            });
            try {
                await whisperLiveClient.connect();
                console.log('Connected to WhisperLive server');
            }
            catch (error) {
                console.error('Failed to connect to WhisperLive:', error);
                updateState('idle');
                return {
                    success: false,
                    error: 'Failed to connect to WhisperLive server. Make sure it\'s running on localhost:9090',
                };
            }
        }
        else {
            // Check for API key (only needed for OpenAI mode)
            if (!settings.openaiApiKey) {
                updateState('idle');
                return { success: false, error: 'Please set your OpenAI API key in settings' };
            }
            // Initialize OpenAI transcription service
            transcriptionService = new openai_transcription_1.OpenAITranscription(settings.openaiApiKey, settings.language);
        }
        // Show overlay
        overlayWindow?.show();
        updateState('active');
        return { success: true };
    }
    catch (error) {
        console.error('Failed to start transcription:', error);
        updateState('idle');
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
async function stopTranscription() {
    if (transcriptionState !== 'active') {
        return { success: false };
    }
    updateState('stopping');
    try {
        // Cleanup WhisperLive client
        if (whisperLiveClient) {
            whisperLiveClient.endStream();
            whisperLiveClient.disconnect();
            whisperLiveClient = null;
        }
        // Cleanup OpenAI transcription service
        transcriptionService = null;
        // Hide overlay
        overlayWindow?.hide();
        // Clear overlay
        overlayWindow?.webContents.send(types_1.IPC_CHANNELS.CLEAR_TRANSCRIPTION);
        updateState('idle');
        return { success: true };
    }
    catch (error) {
        console.error('Failed to stop transcription:', error);
        updateState('idle');
        return { success: false };
    }
}
function updateState(newState) {
    transcriptionState = newState;
    controlWindow?.webContents.send(types_1.IPC_CHANNELS.STATE_CHANGED, newState);
}
function sendTranscriptionToOverlay(result) {
    overlayWindow?.webContents.send(types_1.IPC_CHANNELS.TRANSCRIPTION_UPDATE, result);
}
// IPC Handlers
function setupIpcHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_TRANSCRIPTION, async () => {
        return startTranscription();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.STOP_TRANSCRIPTION, async () => {
        return stopTranscription();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_SETTINGS, () => {
        return getSettings();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.UPDATE_SETTINGS, (_, newSettings) => {
        const updated = updateSettings(newSettings);
        // Update overlay style if changed
        if (newSettings.overlayStyle) {
            overlayWindow?.webContents.send(types_1.IPC_CHANNELS.UPDATE_OVERLAY_STYLE, updated.overlayStyle);
        }
        return updated;
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_STATE, () => {
        return transcriptionState;
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_DESKTOP_SOURCES, async () => {
        const sources = await electron_1.desktopCapturer.getSources({
            types: ['screen', 'window'],
            fetchWindowIcons: false,
        });
        return sources;
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.TRANSCRIBE_AUDIO, async (_, audioData) => {
        console.log('Received audio for transcription, size:', audioData?.byteLength || 0);
        if (!transcriptionService || transcriptionState !== 'active') {
            console.log('Transcription service not ready or not active');
            return null;
        }
        try {
            const buffer = Buffer.from(audioData);
            console.log('Calling OpenAI Whisper API...');
            const result = await transcriptionService.transcribe(buffer);
            console.log('Transcription result:', result);
            if (result && result.text.trim()) {
                sendTranscriptionToOverlay(result);
                return { text: result.text };
            }
            return null;
        }
        catch (error) {
            console.error('Transcription error:', error);
            return null;
        }
    });
    // System audio capture handlers
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_SYSTEM_AUDIO, async () => {
        if (process.platform === 'darwin') {
            const success = startMacOSAudioCapture();
            return { success, platform: 'darwin' };
        }
        else if (process.platform === 'win32') {
            // Windows uses renderer-side capture via getDisplayMedia
            return { success: true, platform: 'win32' };
        }
        else {
            return { success: false, error: 'Platform not supported' };
        }
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.STOP_SYSTEM_AUDIO, async () => {
        if (process.platform === 'darwin') {
            stopMacOSAudioCapture();
        }
        return { success: true };
    });
    // Receive audio data from renderer (Windows) for transcription
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SEND_AUDIO_DATA, async (_, base64Data) => {
        if (!transcriptionService || transcriptionState !== 'active') {
            return null;
        }
        try {
            // Convert base64 to buffer
            const audioBuffer = Buffer.from(base64Data, 'base64');
            // The audio is 16-bit PCM at 24kHz - convert to WAV for Whisper
            const wavBuffer = createWavFromPcm(audioBuffer, CAPTURE_SAMPLE_RATE);
            const result = await transcriptionService.transcribe(wavBuffer);
            if (result && result.text.trim()) {
                sendTranscriptionToOverlay(result);
                return { text: result.text };
            }
            return null;
        }
        catch (error) {
            console.error('Transcription error:', error);
            return null;
        }
    });
}
function createWavFromPcm(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const buffer = Buffer.alloc(44 + dataSize);
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, 44);
    return buffer;
}
// App lifecycle
electron_1.app.whenReady().then(() => {
    setupWindowsLoopbackHandler();
    createControlWindow();
    createOverlayWindow();
    createTray();
    registerShortcuts();
    setupIpcHandlers();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createControlWindow();
            createOverlayWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
electron_1.app.on('before-quit', async () => {
    if (transcriptionState === 'active') {
        await stopTranscription();
    }
    stopMacOSAudioCapture();
});


/***/ },

/***/ "./src/main/openai-transcription.ts"
/*!******************************************!*\
  !*** ./src/main/openai-transcription.ts ***!
  \******************************************/
(__unused_webpack_module, exports, __webpack_require__) {


/**
 * OpenAI Whisper Transcription Service
 *
 * Handles audio transcription using OpenAI's Whisper API.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OpenAITranscription = void 0;
// Polyfill File for Node.js/Electron environments (required by OpenAI SDK)
const node_buffer_1 = __webpack_require__(/*! node:buffer */ "node:buffer");
if (typeof globalThis.File === 'undefined') {
    globalThis.File = node_buffer_1.File;
}
const openai_1 = __importDefault(__webpack_require__(/*! openai */ "./node_modules/openai/index.js"));
const fs = __importStar(__webpack_require__(/*! fs */ "fs"));
const path = __importStar(__webpack_require__(/*! path */ "path"));
const os = __importStar(__webpack_require__(/*! os */ "os"));
class OpenAITranscription {
    client = null;
    language;
    constructor(apiKey, language = 'auto') {
        if (apiKey) {
            this.client = new openai_1.default({ apiKey });
        }
        this.language = language;
    }
    setApiKey(apiKey) {
        if (apiKey) {
            this.client = new openai_1.default({ apiKey });
        }
        else {
            this.client = null;
        }
    }
    setLanguage(language) {
        this.language = language;
    }
    /**
     * Transcribe audio data using OpenAI Whisper API
     * @param audioBuffer - WAV audio data as Buffer
     * @returns Transcription result or null if failed
     */
    async transcribe(audioBuffer) {
        if (!this.client) {
            console.error('OpenAI client not initialized - missing API key');
            return null;
        }
        console.log('OpenAI transcribe called, buffer size:', audioBuffer.length);
        try {
            // Write audio to a temporary file (OpenAI API requires a file)
            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `whisper-${Date.now()}.wav`);
            fs.writeFileSync(tempFile, audioBuffer);
            console.log('Wrote temp file:', tempFile);
            try {
                console.log('Calling OpenAI API with language:', this.language);
                const response = await this.client.audio.transcriptions.create({
                    file: fs.createReadStream(tempFile),
                    model: 'whisper-1',
                    language: this.language === 'auto' ? undefined : this.language,
                    response_format: 'verbose_json', // Get detailed response with no_speech_prob
                });
                console.log('OpenAI response:', JSON.stringify(response, null, 2));
                // Clean up temp file
                fs.unlinkSync(tempFile);
                // Check if there's actual speech using Whisper's detection
                const segments = response.segments || [];
                if (segments.length > 0) {
                    // Filter segments with high no_speech_prob (likely hallucinations)
                    const validSegments = segments.filter((seg) => {
                        const noSpeechProb = seg.no_speech_prob || 0;
                        if (noSpeechProb > 0.5) {
                            console.log('Filtered low-confidence segment:', seg.text, 'no_speech_prob:', noSpeechProb);
                            return false;
                        }
                        return true;
                    });
                    const text = validSegments.map((seg) => seg.text).join(' ').trim();
                    if (text) {
                        return {
                            text: text,
                            timestamp: Date.now(),
                            confidence: 1.0 - (segments[0]?.no_speech_prob || 0),
                            language: response.language || (this.language === 'auto' ? undefined : this.language),
                        };
                    }
                }
                // Fallback to simple text check
                const text = response.text?.trim();
                if (text) {
                    return {
                        text: text,
                        timestamp: Date.now(),
                        confidence: 1.0,
                        language: this.language === 'auto' ? undefined : this.language,
                    };
                }
                console.log('No text in response');
                return null;
            }
            catch (error) {
                // Clean up temp file on error
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
                throw error;
            }
        }
        catch (error) {
            console.error('Transcription error:', error);
            return null;
        }
    }
}
exports.OpenAITranscription = OpenAITranscription;


/***/ },

/***/ "./src/main/whisper-live-client.ts"
/*!*****************************************!*\
  !*** ./src/main/whisper-live-client.ts ***!
  \*****************************************/
(__unused_webpack_module, exports, __webpack_require__) {


/**
 * WhisperLive WebSocket Client
 *
 * Connects to a WhisperLive server for real-time speech-to-text transcription.
 * Protocol: WebSocket with binary audio (Float32, 16kHz, mono) and JSON responses.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.WhisperLiveClient = void 0;
const events_1 = __webpack_require__(/*! events */ "events");
const ws_1 = __importDefault(__webpack_require__(/*! ws */ "./node_modules/ws/index.js"));
class WhisperLiveClient extends events_1.EventEmitter {
    ws = null;
    config;
    uid;
    isConnected = false;
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    reconnectDelay = 1000;
    constructor(config) {
        super();
        this.config = {
            useVad: true,
            model: 'small',
            task: 'transcribe',
            ...config,
        };
        this.uid = this.generateUid();
    }
    generateUid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    connect() {
        return new Promise((resolve, reject) => {
            const url = `ws://${this.config.host}:${this.config.port}`;
            console.log('Connecting to WhisperLive server:', url);
            try {
                this.ws = new ws_1.default(url);
                this.ws.binaryType = 'arraybuffer';
                this.ws.on('open', () => {
                    console.log('WebSocket connected, sending config...');
                    this.sendInitialConfig();
                });
                this.ws.on('message', (data) => {
                    this.handleMessage(data);
                });
                this.ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    this.emit('error', error);
                    reject(error);
                });
                this.ws.on('close', (code, reason) => {
                    console.log('WebSocket closed:', code, reason.toString());
                    this.isConnected = false;
                    this.emit('disconnected', { code, reason: reason.toString() });
                    this.handleReconnect();
                });
                // Set up ready handler
                this.once('ready', () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    resolve();
                });
                // Timeout for connection (longer timeout to allow model loading)
                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('Connection timeout - server may still be loading the model'));
                    }
                }, 120000);
            }
            catch (error) {
                reject(error);
            }
        });
    }
    sendInitialConfig() {
        const config = {
            uid: this.uid,
            language: this.config.language || null,
            task: this.config.task,
            model: this.config.model,
            use_vad: this.config.useVad,
        };
        console.log('Sending config:', config);
        this.ws?.send(JSON.stringify(config));
    }
    handleMessage(data) {
        try {
            console.log('WhisperLive raw message:', data.toString().substring(0, 200));
            const message = JSON.parse(data.toString());
            if (message.message === 'SERVER_READY') {
                console.log('Server ready:', message);
                this.emit('ready', message);
                return;
            }
            if (message.status === 'WAIT') {
                console.log('Server busy, wait time:', message.message);
                this.emit('waiting', message.message);
                return;
            }
            if (message.status === 'ERROR') {
                console.error('Server error:', message.message);
                this.emit('error', new Error(message.message));
                return;
            }
            if (message.segments && message.segments.length > 0) {
                this.emit('transcription', message.segments);
            }
            if (message.language) {
                this.emit('language-detected', {
                    language: message.language,
                    probability: message.language_prob,
                });
            }
        }
        catch (error) {
            console.error('Failed to parse message:', error);
        }
    }
    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('connection-failed');
            return;
        }
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
            await this.connect();
        }
        catch (error) {
            console.error('Reconnect failed:', error);
        }
    }
    /**
     * Send audio data to the server as Float32
     * @param audioData Float32Array of audio samples (16kHz, mono)
     */
    sendAudio(audioData) {
        if (this.ws?.readyState === ws_1.default.OPEN) {
            // Create proper Buffer from Float32Array with explicit binary flag
            const buffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
            this.ws.send(buffer, { binary: true });
        }
    }
    /**
     * Send audio data as Int16 PCM bytes (recommended for non-Python clients)
     * @param audioData Int16Array of audio samples (16kHz, mono)
     */
    sendAudioInt16(audioData) {
        if (this.ws?.readyState === ws_1.default.OPEN) {
            // Send raw Int16 bytes directly with explicit binary flag
            const buffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
            this.ws.send(buffer, { binary: true });
        }
    }
    /**
     * Signal end of audio stream
     */
    endStream() {
        if (this.ws?.readyState === ws_1.default.OPEN) {
            this.ws.send('END_OF_AUDIO');
        }
    }
    /**
     * Disconnect from the server
     */
    disconnect() {
        this.maxReconnectAttempts = 0; // Prevent reconnection
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
    /**
     * Check if connected to server
     */
    get connected() {
        return this.isConnected && this.ws?.readyState === ws_1.default.OPEN;
    }
}
exports.WhisperLiveClient = WhisperLiveClient;


/***/ },

/***/ "./src/shared/types.ts"
/*!*****************************!*\
  !*** ./src/shared/types.ts ***!
  \*****************************/
(__unused_webpack_module, exports) {


// Shared type definitions for the Language Agent application
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.IPC_CHANNELS = exports.MODEL_INFO = exports.LANGUAGE_NAMES = exports.DEFAULT_SETTINGS = exports.DEFAULT_OVERLAY_STYLE = void 0;
exports.DEFAULT_OVERLAY_STYLE = {
    position: 'bottom',
    fontFamily: 'system-ui, "Noto Sans CJK", sans-serif',
    fontSize: 24,
    fontWeight: 400,
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.7,
    textShadow: true,
    textOutline: false,
    maxLines: 2,
    displayDuration: 5,
};
exports.DEFAULT_SETTINGS = {
    openaiApiKey: '',
    whisperModel: 'base',
    language: 'auto',
    gpuAcceleration: true,
    chunkSize: 2,
    overlayStyle: exports.DEFAULT_OVERLAY_STYLE,
    toggleShortcut: 'CommandOrControl+Shift+S',
    showHideShortcut: 'CommandOrControl+Shift+H',
    autoStart: false,
    minimizeToTray: true,
};
exports.LANGUAGE_NAMES = {
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese (Mandarin)',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    en: 'English',
    auto: 'Auto-detect',
};
exports.MODEL_INFO = {
    tiny: { size: '~75MB', speed: 'Fastest', accuracy: 'Good' },
    base: { size: '~150MB', speed: 'Fast', accuracy: 'Better' },
    small: { size: '~500MB', speed: 'Moderate', accuracy: 'Best' },
};
// IPC Channel names
exports.IPC_CHANNELS = {
    // Control -> Main
    START_TRANSCRIPTION: 'start-transcription',
    STOP_TRANSCRIPTION: 'stop-transcription',
    GET_SETTINGS: 'get-settings',
    UPDATE_SETTINGS: 'update-settings',
    GET_STATE: 'get-state',
    TRANSCRIBE_AUDIO: 'transcribe-audio',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
    // Audio capture
    START_SYSTEM_AUDIO: 'start-system-audio',
    STOP_SYSTEM_AUDIO: 'stop-system-audio',
    SYSTEM_AUDIO_DATA: 'system-audio-data',
    SEND_AUDIO_DATA: 'send-audio-data',
    // Main -> Overlay
    TRANSCRIPTION_UPDATE: 'transcription-update',
    CLEAR_TRANSCRIPTION: 'clear-transcription',
    UPDATE_OVERLAY_STYLE: 'update-overlay-style',
    // Main -> Control
    STATE_CHANGED: 'state-changed',
    ERROR_OCCURRED: 'error-occurred',
};


/***/ },

/***/ "./node_modules/ws/index.js"
/*!**********************************!*\
  !*** ./node_modules/ws/index.js ***!
  \**********************************/
(module, __unused_webpack_exports, __webpack_require__) {



const WebSocket = __webpack_require__(/*! ./lib/websocket */ "./node_modules/ws/lib/websocket.js");

WebSocket.createWebSocketStream = __webpack_require__(/*! ./lib/stream */ "./node_modules/ws/lib/stream.js");
WebSocket.Server = __webpack_require__(/*! ./lib/websocket-server */ "./node_modules/ws/lib/websocket-server.js");
WebSocket.Receiver = __webpack_require__(/*! ./lib/receiver */ "./node_modules/ws/lib/receiver.js");
WebSocket.Sender = __webpack_require__(/*! ./lib/sender */ "./node_modules/ws/lib/sender.js");

WebSocket.WebSocket = WebSocket;
WebSocket.WebSocketServer = WebSocket.Server;

module.exports = WebSocket;


/***/ },

/***/ "./node_modules/ws/lib/buffer-util.js"
/*!********************************************!*\
  !*** ./node_modules/ws/lib/buffer-util.js ***!
  \********************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { EMPTY_BUFFER } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");

const FastBuffer = Buffer[Symbol.species];

/**
 * Merges an array of buffers into a new buffer.
 *
 * @param {Buffer[]} list The array of buffers to concat
 * @param {Number} totalLength The total length of buffers in the list
 * @return {Buffer} The resulting buffer
 * @public
 */
function concat(list, totalLength) {
  if (list.length === 0) return EMPTY_BUFFER;
  if (list.length === 1) return list[0];

  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  for (let i = 0; i < list.length; i++) {
    const buf = list[i];
    target.set(buf, offset);
    offset += buf.length;
  }

  if (offset < totalLength) {
    return new FastBuffer(target.buffer, target.byteOffset, offset);
  }

  return target;
}

/**
 * Masks a buffer using the given mask.
 *
 * @param {Buffer} source The buffer to mask
 * @param {Buffer} mask The mask to use
 * @param {Buffer} output The buffer where to store the result
 * @param {Number} offset The offset at which to start writing
 * @param {Number} length The number of bytes to mask.
 * @public
 */
function _mask(source, mask, output, offset, length) {
  for (let i = 0; i < length; i++) {
    output[offset + i] = source[i] ^ mask[i & 3];
  }
}

/**
 * Unmasks a buffer using the given mask.
 *
 * @param {Buffer} buffer The buffer to unmask
 * @param {Buffer} mask The mask to use
 * @public
 */
function _unmask(buffer, mask) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= mask[i & 3];
  }
}

/**
 * Converts a buffer to an `ArrayBuffer`.
 *
 * @param {Buffer} buf The buffer to convert
 * @return {ArrayBuffer} Converted buffer
 * @public
 */
function toArrayBuffer(buf) {
  if (buf.length === buf.buffer.byteLength) {
    return buf.buffer;
  }

  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

/**
 * Converts `data` to a `Buffer`.
 *
 * @param {*} data The data to convert
 * @return {Buffer} The buffer
 * @throws {TypeError}
 * @public
 */
function toBuffer(data) {
  toBuffer.readOnly = true;

  if (Buffer.isBuffer(data)) return data;

  let buf;

  if (data instanceof ArrayBuffer) {
    buf = new FastBuffer(data);
  } else if (ArrayBuffer.isView(data)) {
    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
  } else {
    buf = Buffer.from(data);
    toBuffer.readOnly = false;
  }

  return buf;
}

module.exports = {
  concat,
  mask: _mask,
  toArrayBuffer,
  toBuffer,
  unmask: _unmask
};

/* istanbul ignore else  */
if (!process.env.WS_NO_BUFFER_UTIL) {
  try {
    const bufferUtil = __webpack_require__(Object(function webpackMissingModule() { var e = new Error("Cannot find module 'bufferutil'"); e.code = 'MODULE_NOT_FOUND'; throw e; }()));

    module.exports.mask = function (source, mask, output, offset, length) {
      if (length < 48) _mask(source, mask, output, offset, length);
      else bufferUtil.mask(source, mask, output, offset, length);
    };

    module.exports.unmask = function (buffer, mask) {
      if (buffer.length < 32) _unmask(buffer, mask);
      else bufferUtil.unmask(buffer, mask);
    };
  } catch (e) {
    // Continue regardless of the error.
  }
}


/***/ },

/***/ "./node_modules/ws/lib/constants.js"
/*!******************************************!*\
  !*** ./node_modules/ws/lib/constants.js ***!
  \******************************************/
(module) {



const BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'];
const hasBlob = typeof Blob !== 'undefined';

if (hasBlob) BINARY_TYPES.push('blob');

module.exports = {
  BINARY_TYPES,
  CLOSE_TIMEOUT: 30000,
  EMPTY_BUFFER: Buffer.alloc(0),
  GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
  hasBlob,
  kForOnEventAttribute: Symbol('kIsForOnEventAttribute'),
  kListener: Symbol('kListener'),
  kStatusCode: Symbol('status-code'),
  kWebSocket: Symbol('websocket'),
  NOOP: () => {}
};


/***/ },

/***/ "./node_modules/ws/lib/event-target.js"
/*!*********************************************!*\
  !*** ./node_modules/ws/lib/event-target.js ***!
  \*********************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { kForOnEventAttribute, kListener } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");

const kCode = Symbol('kCode');
const kData = Symbol('kData');
const kError = Symbol('kError');
const kMessage = Symbol('kMessage');
const kReason = Symbol('kReason');
const kTarget = Symbol('kTarget');
const kType = Symbol('kType');
const kWasClean = Symbol('kWasClean');

/**
 * Class representing an event.
 */
class Event {
  /**
   * Create a new `Event`.
   *
   * @param {String} type The name of the event
   * @throws {TypeError} If the `type` argument is not specified
   */
  constructor(type) {
    this[kTarget] = null;
    this[kType] = type;
  }

  /**
   * @type {*}
   */
  get target() {
    return this[kTarget];
  }

  /**
   * @type {String}
   */
  get type() {
    return this[kType];
  }
}

Object.defineProperty(Event.prototype, 'target', { enumerable: true });
Object.defineProperty(Event.prototype, 'type', { enumerable: true });

/**
 * Class representing a close event.
 *
 * @extends Event
 */
class CloseEvent extends Event {
  /**
   * Create a new `CloseEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {Number} [options.code=0] The status code explaining why the
   *     connection was closed
   * @param {String} [options.reason=''] A human-readable string explaining why
   *     the connection was closed
   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
   *     connection was cleanly closed
   */
  constructor(type, options = {}) {
    super(type);

    this[kCode] = options.code === undefined ? 0 : options.code;
    this[kReason] = options.reason === undefined ? '' : options.reason;
    this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
  }

  /**
   * @type {Number}
   */
  get code() {
    return this[kCode];
  }

  /**
   * @type {String}
   */
  get reason() {
    return this[kReason];
  }

  /**
   * @type {Boolean}
   */
  get wasClean() {
    return this[kWasClean];
  }
}

Object.defineProperty(CloseEvent.prototype, 'code', { enumerable: true });
Object.defineProperty(CloseEvent.prototype, 'reason', { enumerable: true });
Object.defineProperty(CloseEvent.prototype, 'wasClean', { enumerable: true });

/**
 * Class representing an error event.
 *
 * @extends Event
 */
class ErrorEvent extends Event {
  /**
   * Create a new `ErrorEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.error=null] The error that generated this event
   * @param {String} [options.message=''] The error message
   */
  constructor(type, options = {}) {
    super(type);

    this[kError] = options.error === undefined ? null : options.error;
    this[kMessage] = options.message === undefined ? '' : options.message;
  }

  /**
   * @type {*}
   */
  get error() {
    return this[kError];
  }

  /**
   * @type {String}
   */
  get message() {
    return this[kMessage];
  }
}

Object.defineProperty(ErrorEvent.prototype, 'error', { enumerable: true });
Object.defineProperty(ErrorEvent.prototype, 'message', { enumerable: true });

/**
 * Class representing a message event.
 *
 * @extends Event
 */
class MessageEvent extends Event {
  /**
   * Create a new `MessageEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.data=null] The message content
   */
  constructor(type, options = {}) {
    super(type);

    this[kData] = options.data === undefined ? null : options.data;
  }

  /**
   * @type {*}
   */
  get data() {
    return this[kData];
  }
}

Object.defineProperty(MessageEvent.prototype, 'data', { enumerable: true });

/**
 * This provides methods for emulating the `EventTarget` interface. It's not
 * meant to be used directly.
 *
 * @mixin
 */
const EventTarget = {
  /**
   * Register an event listener.
   *
   * @param {String} type A string representing the event type to listen for
   * @param {(Function|Object)} handler The listener to add
   * @param {Object} [options] An options object specifies characteristics about
   *     the event listener
   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
   *     listener should be invoked at most once after being added. If `true`,
   *     the listener would be automatically removed when invoked.
   * @public
   */
  addEventListener(type, handler, options = {}) {
    for (const listener of this.listeners(type)) {
      if (
        !options[kForOnEventAttribute] &&
        listener[kListener] === handler &&
        !listener[kForOnEventAttribute]
      ) {
        return;
      }
    }

    let wrapper;

    if (type === 'message') {
      wrapper = function onMessage(data, isBinary) {
        const event = new MessageEvent('message', {
          data: isBinary ? data : data.toString()
        });

        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === 'close') {
      wrapper = function onClose(code, message) {
        const event = new CloseEvent('close', {
          code,
          reason: message.toString(),
          wasClean: this._closeFrameReceived && this._closeFrameSent
        });

        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === 'error') {
      wrapper = function onError(error) {
        const event = new ErrorEvent('error', {
          error,
          message: error.message
        });

        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === 'open') {
      wrapper = function onOpen() {
        const event = new Event('open');

        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else {
      return;
    }

    wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
    wrapper[kListener] = handler;

    if (options.once) {
      this.once(type, wrapper);
    } else {
      this.on(type, wrapper);
    }
  },

  /**
   * Remove an event listener.
   *
   * @param {String} type A string representing the event type to remove
   * @param {(Function|Object)} handler The listener to remove
   * @public
   */
  removeEventListener(type, handler) {
    for (const listener of this.listeners(type)) {
      if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
        this.removeListener(type, listener);
        break;
      }
    }
  }
};

module.exports = {
  CloseEvent,
  ErrorEvent,
  Event,
  EventTarget,
  MessageEvent
};

/**
 * Call an event listener
 *
 * @param {(Function|Object)} listener The listener to call
 * @param {*} thisArg The value to use as `this`` when calling the listener
 * @param {Event} event The event to pass to the listener
 * @private
 */
function callListener(listener, thisArg, event) {
  if (typeof listener === 'object' && listener.handleEvent) {
    listener.handleEvent.call(listener, event);
  } else {
    listener.call(thisArg, event);
  }
}


/***/ },

/***/ "./node_modules/ws/lib/extension.js"
/*!******************************************!*\
  !*** ./node_modules/ws/lib/extension.js ***!
  \******************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { tokenChars } = __webpack_require__(/*! ./validation */ "./node_modules/ws/lib/validation.js");

/**
 * Adds an offer to the map of extension offers or a parameter to the map of
 * parameters.
 *
 * @param {Object} dest The map of extension offers or parameters
 * @param {String} name The extension or parameter name
 * @param {(Object|Boolean|String)} elem The extension parameters or the
 *     parameter value
 * @private
 */
function push(dest, name, elem) {
  if (dest[name] === undefined) dest[name] = [elem];
  else dest[name].push(elem);
}

/**
 * Parses the `Sec-WebSocket-Extensions` header into an object.
 *
 * @param {String} header The field value of the header
 * @return {Object} The parsed object
 * @public
 */
function parse(header) {
  const offers = Object.create(null);
  let params = Object.create(null);
  let mustUnescape = false;
  let isEscaping = false;
  let inQuotes = false;
  let extensionName;
  let paramName;
  let start = -1;
  let code = -1;
  let end = -1;
  let i = 0;

  for (; i < header.length; i++) {
    code = header.charCodeAt(i);

    if (extensionName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (
        i !== 0 &&
        (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
      ) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        const name = header.slice(start, end);
        if (code === 0x2c) {
          push(offers, name, params);
          params = Object.create(null);
        } else {
          extensionName = name;
        }

        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else if (paramName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 0x20 || code === 0x09) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        push(params, header.slice(start, end), true);
        if (code === 0x2c) {
          push(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        start = end = -1;
      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
        paramName = header.slice(start, i);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else {
      //
      // The value of a quoted-string after unescaping must conform to the
      // token ABNF, so only token characters are valid.
      // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
      //
      if (isEscaping) {
        if (tokenChars[code] !== 1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (start === -1) start = i;
        else if (!mustUnescape) mustUnescape = true;
        isEscaping = false;
      } else if (inQuotes) {
        if (tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 0x22 /* '"' */ && start !== -1) {
          inQuotes = false;
          end = i;
        } else if (code === 0x5c /* '\' */) {
          isEscaping = true;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
        inQuotes = true;
      } else if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
        if (end === -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        let value = header.slice(start, end);
        if (mustUnescape) {
          value = value.replace(/\\/g, '');
          mustUnescape = false;
        }
        push(params, paramName, value);
        if (code === 0x2c) {
          push(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        paramName = undefined;
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
  }

  if (start === -1 || inQuotes || code === 0x20 || code === 0x09) {
    throw new SyntaxError('Unexpected end of input');
  }

  if (end === -1) end = i;
  const token = header.slice(start, end);
  if (extensionName === undefined) {
    push(offers, token, params);
  } else {
    if (paramName === undefined) {
      push(params, token, true);
    } else if (mustUnescape) {
      push(params, paramName, token.replace(/\\/g, ''));
    } else {
      push(params, paramName, token);
    }
    push(offers, extensionName, params);
  }

  return offers;
}

/**
 * Builds the `Sec-WebSocket-Extensions` header field value.
 *
 * @param {Object} extensions The map of extensions and parameters to format
 * @return {String} A string representing the given object
 * @public
 */
function format(extensions) {
  return Object.keys(extensions)
    .map((extension) => {
      let configurations = extensions[extension];
      if (!Array.isArray(configurations)) configurations = [configurations];
      return configurations
        .map((params) => {
          return [extension]
            .concat(
              Object.keys(params).map((k) => {
                let values = params[k];
                if (!Array.isArray(values)) values = [values];
                return values
                  .map((v) => (v === true ? k : `${k}=${v}`))
                  .join('; ');
              })
            )
            .join('; ');
        })
        .join(', ');
    })
    .join(', ');
}

module.exports = { format, parse };


/***/ },

/***/ "./node_modules/ws/lib/limiter.js"
/*!****************************************!*\
  !*** ./node_modules/ws/lib/limiter.js ***!
  \****************************************/
(module) {



const kDone = Symbol('kDone');
const kRun = Symbol('kRun');

/**
 * A very simple job queue with adjustable concurrency. Adapted from
 * https://github.com/STRML/async-limiter
 */
class Limiter {
  /**
   * Creates a new `Limiter`.
   *
   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
   *     to run concurrently
   */
  constructor(concurrency) {
    this[kDone] = () => {
      this.pending--;
      this[kRun]();
    };
    this.concurrency = concurrency || Infinity;
    this.jobs = [];
    this.pending = 0;
  }

  /**
   * Adds a job to the queue.
   *
   * @param {Function} job The job to run
   * @public
   */
  add(job) {
    this.jobs.push(job);
    this[kRun]();
  }

  /**
   * Removes a job from the queue and runs it if possible.
   *
   * @private
   */
  [kRun]() {
    if (this.pending === this.concurrency) return;

    if (this.jobs.length) {
      const job = this.jobs.shift();

      this.pending++;
      job(this[kDone]);
    }
  }
}

module.exports = Limiter;


/***/ },

/***/ "./node_modules/ws/lib/permessage-deflate.js"
/*!***************************************************!*\
  !*** ./node_modules/ws/lib/permessage-deflate.js ***!
  \***************************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const zlib = __webpack_require__(/*! zlib */ "zlib");

const bufferUtil = __webpack_require__(/*! ./buffer-util */ "./node_modules/ws/lib/buffer-util.js");
const Limiter = __webpack_require__(/*! ./limiter */ "./node_modules/ws/lib/limiter.js");
const { kStatusCode } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");

const FastBuffer = Buffer[Symbol.species];
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const kPerMessageDeflate = Symbol('permessage-deflate');
const kTotalLength = Symbol('total-length');
const kCallback = Symbol('callback');
const kBuffers = Symbol('buffers');
const kError = Symbol('error');

//
// We limit zlib concurrency, which prevents severe memory fragmentation
// as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
// and https://github.com/websockets/ws/issues/1202
//
// Intentionally global; it's the global thread pool that's an issue.
//
let zlibLimiter;

/**
 * permessage-deflate implementation.
 */
class PerMessageDeflate {
  /**
   * Creates a PerMessageDeflate instance.
   *
   * @param {Object} [options] Configuration options
   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
   *     for, or request, a custom client window size
   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
   *     acknowledge disabling of client context takeover
   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
   *     calls to zlib
   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
   *     use of a custom server window size
   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
   *     disabling of server context takeover
   * @param {Number} [options.threshold=1024] Size (in bytes) below which
   *     messages should not be compressed if context takeover is disabled
   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
   *     deflate
   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
   *     inflate
   * @param {Boolean} [isServer=false] Create the instance in either server or
   *     client mode
   * @param {Number} [maxPayload=0] The maximum allowed message length
   */
  constructor(options, isServer, maxPayload) {
    this._maxPayload = maxPayload | 0;
    this._options = options || {};
    this._threshold =
      this._options.threshold !== undefined ? this._options.threshold : 1024;
    this._isServer = !!isServer;
    this._deflate = null;
    this._inflate = null;

    this.params = null;

    if (!zlibLimiter) {
      const concurrency =
        this._options.concurrencyLimit !== undefined
          ? this._options.concurrencyLimit
          : 10;
      zlibLimiter = new Limiter(concurrency);
    }
  }

  /**
   * @type {String}
   */
  static get extensionName() {
    return 'permessage-deflate';
  }

  /**
   * Create an extension negotiation offer.
   *
   * @return {Object} Extension parameters
   * @public
   */
  offer() {
    const params = {};

    if (this._options.serverNoContextTakeover) {
      params.server_no_context_takeover = true;
    }
    if (this._options.clientNoContextTakeover) {
      params.client_no_context_takeover = true;
    }
    if (this._options.serverMaxWindowBits) {
      params.server_max_window_bits = this._options.serverMaxWindowBits;
    }
    if (this._options.clientMaxWindowBits) {
      params.client_max_window_bits = this._options.clientMaxWindowBits;
    } else if (this._options.clientMaxWindowBits == null) {
      params.client_max_window_bits = true;
    }

    return params;
  }

  /**
   * Accept an extension negotiation offer/response.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Object} Accepted configuration
   * @public
   */
  accept(configurations) {
    configurations = this.normalizeParams(configurations);

    this.params = this._isServer
      ? this.acceptAsServer(configurations)
      : this.acceptAsClient(configurations);

    return this.params;
  }

  /**
   * Releases all resources used by the extension.
   *
   * @public
   */
  cleanup() {
    if (this._inflate) {
      this._inflate.close();
      this._inflate = null;
    }

    if (this._deflate) {
      const callback = this._deflate[kCallback];

      this._deflate.close();
      this._deflate = null;

      if (callback) {
        callback(
          new Error(
            'The deflate stream was closed while data was being processed'
          )
        );
      }
    }
  }

  /**
   *  Accept an extension negotiation offer.
   *
   * @param {Array} offers The extension negotiation offers
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsServer(offers) {
    const opts = this._options;
    const accepted = offers.find((params) => {
      if (
        (opts.serverNoContextTakeover === false &&
          params.server_no_context_takeover) ||
        (params.server_max_window_bits &&
          (opts.serverMaxWindowBits === false ||
            (typeof opts.serverMaxWindowBits === 'number' &&
              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
        (typeof opts.clientMaxWindowBits === 'number' &&
          !params.client_max_window_bits)
      ) {
        return false;
      }

      return true;
    });

    if (!accepted) {
      throw new Error('None of the extension offers can be accepted');
    }

    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true;
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true;
    }
    if (typeof opts.serverMaxWindowBits === 'number') {
      accepted.server_max_window_bits = opts.serverMaxWindowBits;
    }
    if (typeof opts.clientMaxWindowBits === 'number') {
      accepted.client_max_window_bits = opts.clientMaxWindowBits;
    } else if (
      accepted.client_max_window_bits === true ||
      opts.clientMaxWindowBits === false
    ) {
      delete accepted.client_max_window_bits;
    }

    return accepted;
  }

  /**
   * Accept the extension negotiation response.
   *
   * @param {Array} response The extension negotiation response
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsClient(response) {
    const params = response[0];

    if (
      this._options.clientNoContextTakeover === false &&
      params.client_no_context_takeover
    ) {
      throw new Error('Unexpected parameter "client_no_context_takeover"');
    }

    if (!params.client_max_window_bits) {
      if (typeof this._options.clientMaxWindowBits === 'number') {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      }
    } else if (
      this._options.clientMaxWindowBits === false ||
      (typeof this._options.clientMaxWindowBits === 'number' &&
        params.client_max_window_bits > this._options.clientMaxWindowBits)
    ) {
      throw new Error(
        'Unexpected or invalid parameter "client_max_window_bits"'
      );
    }

    return params;
  }

  /**
   * Normalize parameters.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Array} The offers/response with normalized parameters
   * @private
   */
  normalizeParams(configurations) {
    configurations.forEach((params) => {
      Object.keys(params).forEach((key) => {
        let value = params[key];

        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`);
        }

        value = value[0];

        if (key === 'client_max_window_bits') {
          if (value !== true) {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
            value = num;
          } else if (!this._isServer) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else if (key === 'server_max_window_bits') {
          const num = +value;
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
          value = num;
        } else if (
          key === 'client_no_context_takeover' ||
          key === 'server_no_context_takeover'
        ) {
          if (value !== true) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`);
        }

        params[key] = value;
      });
    });

    return configurations;
  }

  /**
   * Decompress data. Concurrency limited.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  decompress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._decompress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }

  /**
   * Compress data. Concurrency limited.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  compress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._compress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }

  /**
   * Decompress data.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _decompress(data, fin, callback) {
    const endpoint = this._isServer ? 'client' : 'server';

    if (!this._inflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits =
        typeof this.params[key] !== 'number'
          ? zlib.Z_DEFAULT_WINDOWBITS
          : this.params[key];

      this._inflate = zlib.createInflateRaw({
        ...this._options.zlibInflateOptions,
        windowBits
      });
      this._inflate[kPerMessageDeflate] = this;
      this._inflate[kTotalLength] = 0;
      this._inflate[kBuffers] = [];
      this._inflate.on('error', inflateOnError);
      this._inflate.on('data', inflateOnData);
    }

    this._inflate[kCallback] = callback;

    this._inflate.write(data);
    if (fin) this._inflate.write(TRAILER);

    this._inflate.flush(() => {
      const err = this._inflate[kError];

      if (err) {
        this._inflate.close();
        this._inflate = null;
        callback(err);
        return;
      }

      const data = bufferUtil.concat(
        this._inflate[kBuffers],
        this._inflate[kTotalLength]
      );

      if (this._inflate._readableState.endEmitted) {
        this._inflate.close();
        this._inflate = null;
      } else {
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];

        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._inflate.reset();
        }
      }

      callback(null, data);
    });
  }

  /**
   * Compress data.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _compress(data, fin, callback) {
    const endpoint = this._isServer ? 'server' : 'client';

    if (!this._deflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits =
        typeof this.params[key] !== 'number'
          ? zlib.Z_DEFAULT_WINDOWBITS
          : this.params[key];

      this._deflate = zlib.createDeflateRaw({
        ...this._options.zlibDeflateOptions,
        windowBits
      });

      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];

      this._deflate.on('data', deflateOnData);
    }

    this._deflate[kCallback] = callback;

    this._deflate.write(data);
    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
      if (!this._deflate) {
        //
        // The deflate stream was closed while data was being processed.
        //
        return;
      }

      let data = bufferUtil.concat(
        this._deflate[kBuffers],
        this._deflate[kTotalLength]
      );

      if (fin) {
        data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
      }

      //
      // Ensure that the callback will not be called again in
      // `PerMessageDeflate#cleanup()`.
      //
      this._deflate[kCallback] = null;

      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];

      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
        this._deflate.reset();
      }

      callback(null, data);
    });
  }
}

module.exports = PerMessageDeflate;

/**
 * The listener of the `zlib.DeflateRaw` stream `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function deflateOnData(chunk) {
  this[kBuffers].push(chunk);
  this[kTotalLength] += chunk.length;
}

/**
 * The listener of the `zlib.InflateRaw` stream `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function inflateOnData(chunk) {
  this[kTotalLength] += chunk.length;

  if (
    this[kPerMessageDeflate]._maxPayload < 1 ||
    this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
  ) {
    this[kBuffers].push(chunk);
    return;
  }

  this[kError] = new RangeError('Max payload size exceeded');
  this[kError].code = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
  this[kError][kStatusCode] = 1009;
  this.removeListener('data', inflateOnData);

  //
  // The choice to employ `zlib.reset()` over `zlib.close()` is dictated by the
  // fact that in Node.js versions prior to 13.10.0, the callback for
  // `zlib.flush()` is not called if `zlib.close()` is used. Utilizing
  // `zlib.reset()` ensures that either the callback is invoked or an error is
  // emitted.
  //
  this.reset();
}

/**
 * The listener of the `zlib.InflateRaw` stream `'error'` event.
 *
 * @param {Error} err The emitted error
 * @private
 */
function inflateOnError(err) {
  //
  // There is no need to call `Zlib#close()` as the handle is automatically
  // closed when an error is emitted.
  //
  this[kPerMessageDeflate]._inflate = null;

  if (this[kError]) {
    this[kCallback](this[kError]);
    return;
  }

  err[kStatusCode] = 1007;
  this[kCallback](err);
}


/***/ },

/***/ "./node_modules/ws/lib/receiver.js"
/*!*****************************************!*\
  !*** ./node_modules/ws/lib/receiver.js ***!
  \*****************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { Writable } = __webpack_require__(/*! stream */ "stream");

const PerMessageDeflate = __webpack_require__(/*! ./permessage-deflate */ "./node_modules/ws/lib/permessage-deflate.js");
const {
  BINARY_TYPES,
  EMPTY_BUFFER,
  kStatusCode,
  kWebSocket
} = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");
const { concat, toArrayBuffer, unmask } = __webpack_require__(/*! ./buffer-util */ "./node_modules/ws/lib/buffer-util.js");
const { isValidStatusCode, isValidUTF8 } = __webpack_require__(/*! ./validation */ "./node_modules/ws/lib/validation.js");

const FastBuffer = Buffer[Symbol.species];

const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;
const INFLATING = 5;
const DEFER_EVENT = 6;

/**
 * HyBi Receiver implementation.
 *
 * @extends Writable
 */
class Receiver extends Writable {
  /**
   * Creates a Receiver instance.
   *
   * @param {Object} [options] Options object
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {String} [options.binaryType=nodebuffer] The type for binary data
   * @param {Object} [options.extensions] An object containing the negotiated
   *     extensions
   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
   *     client or server mode
   * @param {Number} [options.maxPayload=0] The maximum allowed message length
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   */
  constructor(options = {}) {
    super();

    this._allowSynchronousEvents =
      options.allowSynchronousEvents !== undefined
        ? options.allowSynchronousEvents
        : true;
    this._binaryType = options.binaryType || BINARY_TYPES[0];
    this._extensions = options.extensions || {};
    this._isServer = !!options.isServer;
    this._maxPayload = options.maxPayload | 0;
    this._skipUTF8Validation = !!options.skipUTF8Validation;
    this[kWebSocket] = undefined;

    this._bufferedBytes = 0;
    this._buffers = [];

    this._compressed = false;
    this._payloadLength = 0;
    this._mask = undefined;
    this._fragmented = 0;
    this._masked = false;
    this._fin = false;
    this._opcode = 0;

    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragments = [];

    this._errored = false;
    this._loop = false;
    this._state = GET_INFO;
  }

  /**
   * Implements `Writable.prototype._write()`.
   *
   * @param {Buffer} chunk The chunk of data to write
   * @param {String} encoding The character encoding of `chunk`
   * @param {Function} cb Callback
   * @private
   */
  _write(chunk, encoding, cb) {
    if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

    this._bufferedBytes += chunk.length;
    this._buffers.push(chunk);
    this.startLoop(cb);
  }

  /**
   * Consumes `n` bytes from the buffered data.
   *
   * @param {Number} n The number of bytes to consume
   * @return {Buffer} The consumed bytes
   * @private
   */
  consume(n) {
    this._bufferedBytes -= n;

    if (n === this._buffers[0].length) return this._buffers.shift();

    if (n < this._buffers[0].length) {
      const buf = this._buffers[0];
      this._buffers[0] = new FastBuffer(
        buf.buffer,
        buf.byteOffset + n,
        buf.length - n
      );

      return new FastBuffer(buf.buffer, buf.byteOffset, n);
    }

    const dst = Buffer.allocUnsafe(n);

    do {
      const buf = this._buffers[0];
      const offset = dst.length - n;

      if (n >= buf.length) {
        dst.set(this._buffers.shift(), offset);
      } else {
        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
        this._buffers[0] = new FastBuffer(
          buf.buffer,
          buf.byteOffset + n,
          buf.length - n
        );
      }

      n -= buf.length;
    } while (n > 0);

    return dst;
  }

  /**
   * Starts the parsing loop.
   *
   * @param {Function} cb Callback
   * @private
   */
  startLoop(cb) {
    this._loop = true;

    do {
      switch (this._state) {
        case GET_INFO:
          this.getInfo(cb);
          break;
        case GET_PAYLOAD_LENGTH_16:
          this.getPayloadLength16(cb);
          break;
        case GET_PAYLOAD_LENGTH_64:
          this.getPayloadLength64(cb);
          break;
        case GET_MASK:
          this.getMask();
          break;
        case GET_DATA:
          this.getData(cb);
          break;
        case INFLATING:
        case DEFER_EVENT:
          this._loop = false;
          return;
      }
    } while (this._loop);

    if (!this._errored) cb();
  }

  /**
   * Reads the first two bytes of a frame.
   *
   * @param {Function} cb Callback
   * @private
   */
  getInfo(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }

    const buf = this.consume(2);

    if ((buf[0] & 0x30) !== 0x00) {
      const error = this.createError(
        RangeError,
        'RSV2 and RSV3 must be clear',
        true,
        1002,
        'WS_ERR_UNEXPECTED_RSV_2_3'
      );

      cb(error);
      return;
    }

    const compressed = (buf[0] & 0x40) === 0x40;

    if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
      const error = this.createError(
        RangeError,
        'RSV1 must be clear',
        true,
        1002,
        'WS_ERR_UNEXPECTED_RSV_1'
      );

      cb(error);
      return;
    }

    this._fin = (buf[0] & 0x80) === 0x80;
    this._opcode = buf[0] & 0x0f;
    this._payloadLength = buf[1] & 0x7f;

    if (this._opcode === 0x00) {
      if (compressed) {
        const error = this.createError(
          RangeError,
          'RSV1 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_1'
        );

        cb(error);
        return;
      }

      if (!this._fragmented) {
        const error = this.createError(
          RangeError,
          'invalid opcode 0',
          true,
          1002,
          'WS_ERR_INVALID_OPCODE'
        );

        cb(error);
        return;
      }

      this._opcode = this._fragmented;
    } else if (this._opcode === 0x01 || this._opcode === 0x02) {
      if (this._fragmented) {
        const error = this.createError(
          RangeError,
          `invalid opcode ${this._opcode}`,
          true,
          1002,
          'WS_ERR_INVALID_OPCODE'
        );

        cb(error);
        return;
      }

      this._compressed = compressed;
    } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
      if (!this._fin) {
        const error = this.createError(
          RangeError,
          'FIN must be set',
          true,
          1002,
          'WS_ERR_EXPECTED_FIN'
        );

        cb(error);
        return;
      }

      if (compressed) {
        const error = this.createError(
          RangeError,
          'RSV1 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_1'
        );

        cb(error);
        return;
      }

      if (
        this._payloadLength > 0x7d ||
        (this._opcode === 0x08 && this._payloadLength === 1)
      ) {
        const error = this.createError(
          RangeError,
          `invalid payload length ${this._payloadLength}`,
          true,
          1002,
          'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH'
        );

        cb(error);
        return;
      }
    } else {
      const error = this.createError(
        RangeError,
        `invalid opcode ${this._opcode}`,
        true,
        1002,
        'WS_ERR_INVALID_OPCODE'
      );

      cb(error);
      return;
    }

    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
    this._masked = (buf[1] & 0x80) === 0x80;

    if (this._isServer) {
      if (!this._masked) {
        const error = this.createError(
          RangeError,
          'MASK must be set',
          true,
          1002,
          'WS_ERR_EXPECTED_MASK'
        );

        cb(error);
        return;
      }
    } else if (this._masked) {
      const error = this.createError(
        RangeError,
        'MASK must be clear',
        true,
        1002,
        'WS_ERR_UNEXPECTED_MASK'
      );

      cb(error);
      return;
    }

    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
    else this.haveLength(cb);
  }

  /**
   * Gets extended payload length (7+16).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength16(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }

    this._payloadLength = this.consume(2).readUInt16BE(0);
    this.haveLength(cb);
  }

  /**
   * Gets extended payload length (7+64).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength64(cb) {
    if (this._bufferedBytes < 8) {
      this._loop = false;
      return;
    }

    const buf = this.consume(8);
    const num = buf.readUInt32BE(0);

    //
    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
    // if payload length is greater than this number.
    //
    if (num > Math.pow(2, 53 - 32) - 1) {
      const error = this.createError(
        RangeError,
        'Unsupported WebSocket frame: payload length > 2^53 - 1',
        false,
        1009,
        'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH'
      );

      cb(error);
      return;
    }

    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
    this.haveLength(cb);
  }

  /**
   * Payload length has been read.
   *
   * @param {Function} cb Callback
   * @private
   */
  haveLength(cb) {
    if (this._payloadLength && this._opcode < 0x08) {
      this._totalPayloadLength += this._payloadLength;
      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
        const error = this.createError(
          RangeError,
          'Max payload size exceeded',
          false,
          1009,
          'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
        );

        cb(error);
        return;
      }
    }

    if (this._masked) this._state = GET_MASK;
    else this._state = GET_DATA;
  }

  /**
   * Reads mask bytes.
   *
   * @private
   */
  getMask() {
    if (this._bufferedBytes < 4) {
      this._loop = false;
      return;
    }

    this._mask = this.consume(4);
    this._state = GET_DATA;
  }

  /**
   * Reads data bytes.
   *
   * @param {Function} cb Callback
   * @private
   */
  getData(cb) {
    let data = EMPTY_BUFFER;

    if (this._payloadLength) {
      if (this._bufferedBytes < this._payloadLength) {
        this._loop = false;
        return;
      }

      data = this.consume(this._payloadLength);

      if (
        this._masked &&
        (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0
      ) {
        unmask(data, this._mask);
      }
    }

    if (this._opcode > 0x07) {
      this.controlMessage(data, cb);
      return;
    }

    if (this._compressed) {
      this._state = INFLATING;
      this.decompress(data, cb);
      return;
    }

    if (data.length) {
      //
      // This message is not compressed so its length is the sum of the payload
      // length of all fragments.
      //
      this._messageLength = this._totalPayloadLength;
      this._fragments.push(data);
    }

    this.dataMessage(cb);
  }

  /**
   * Decompresses data.
   *
   * @param {Buffer} data Compressed data
   * @param {Function} cb Callback
   * @private
   */
  decompress(data, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
      if (err) return cb(err);

      if (buf.length) {
        this._messageLength += buf.length;
        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
          const error = this.createError(
            RangeError,
            'Max payload size exceeded',
            false,
            1009,
            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
          );

          cb(error);
          return;
        }

        this._fragments.push(buf);
      }

      this.dataMessage(cb);
      if (this._state === GET_INFO) this.startLoop(cb);
    });
  }

  /**
   * Handles a data message.
   *
   * @param {Function} cb Callback
   * @private
   */
  dataMessage(cb) {
    if (!this._fin) {
      this._state = GET_INFO;
      return;
    }

    const messageLength = this._messageLength;
    const fragments = this._fragments;

    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragmented = 0;
    this._fragments = [];

    if (this._opcode === 2) {
      let data;

      if (this._binaryType === 'nodebuffer') {
        data = concat(fragments, messageLength);
      } else if (this._binaryType === 'arraybuffer') {
        data = toArrayBuffer(concat(fragments, messageLength));
      } else if (this._binaryType === 'blob') {
        data = new Blob(fragments);
      } else {
        data = fragments;
      }

      if (this._allowSynchronousEvents) {
        this.emit('message', data, true);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit('message', data, true);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    } else {
      const buf = concat(fragments, messageLength);

      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
        const error = this.createError(
          Error,
          'invalid UTF-8 sequence',
          true,
          1007,
          'WS_ERR_INVALID_UTF8'
        );

        cb(error);
        return;
      }

      if (this._state === INFLATING || this._allowSynchronousEvents) {
        this.emit('message', buf, false);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit('message', buf, false);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
  }

  /**
   * Handles a control message.
   *
   * @param {Buffer} data Data to handle
   * @return {(Error|RangeError|undefined)} A possible error
   * @private
   */
  controlMessage(data, cb) {
    if (this._opcode === 0x08) {
      if (data.length === 0) {
        this._loop = false;
        this.emit('conclude', 1005, EMPTY_BUFFER);
        this.end();
      } else {
        const code = data.readUInt16BE(0);

        if (!isValidStatusCode(code)) {
          const error = this.createError(
            RangeError,
            `invalid status code ${code}`,
            true,
            1002,
            'WS_ERR_INVALID_CLOSE_CODE'
          );

          cb(error);
          return;
        }

        const buf = new FastBuffer(
          data.buffer,
          data.byteOffset + 2,
          data.length - 2
        );

        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(
            Error,
            'invalid UTF-8 sequence',
            true,
            1007,
            'WS_ERR_INVALID_UTF8'
          );

          cb(error);
          return;
        }

        this._loop = false;
        this.emit('conclude', code, buf);
        this.end();
      }

      this._state = GET_INFO;
      return;
    }

    if (this._allowSynchronousEvents) {
      this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
      this._state = GET_INFO;
    } else {
      this._state = DEFER_EVENT;
      setImmediate(() => {
        this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
        this._state = GET_INFO;
        this.startLoop(cb);
      });
    }
  }

  /**
   * Builds an error object.
   *
   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
   * @param {String} message The error message
   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
   *     `message`
   * @param {Number} statusCode The status code
   * @param {String} errorCode The exposed error code
   * @return {(Error|RangeError)} The error
   * @private
   */
  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
    this._loop = false;
    this._errored = true;

    const err = new ErrorCtor(
      prefix ? `Invalid WebSocket frame: ${message}` : message
    );

    Error.captureStackTrace(err, this.createError);
    err.code = errorCode;
    err[kStatusCode] = statusCode;
    return err;
  }
}

module.exports = Receiver;


/***/ },

/***/ "./node_modules/ws/lib/sender.js"
/*!***************************************!*\
  !*** ./node_modules/ws/lib/sender.js ***!
  \***************************************/
(module, __unused_webpack_exports, __webpack_require__) {

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex" }] */



const { Duplex } = __webpack_require__(/*! stream */ "stream");
const { randomFillSync } = __webpack_require__(/*! crypto */ "crypto");

const PerMessageDeflate = __webpack_require__(/*! ./permessage-deflate */ "./node_modules/ws/lib/permessage-deflate.js");
const { EMPTY_BUFFER, kWebSocket, NOOP } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");
const { isBlob, isValidStatusCode } = __webpack_require__(/*! ./validation */ "./node_modules/ws/lib/validation.js");
const { mask: applyMask, toBuffer } = __webpack_require__(/*! ./buffer-util */ "./node_modules/ws/lib/buffer-util.js");

const kByteLength = Symbol('kByteLength');
const maskBuffer = Buffer.alloc(4);
const RANDOM_POOL_SIZE = 8 * 1024;
let randomPool;
let randomPoolPointer = RANDOM_POOL_SIZE;

const DEFAULT = 0;
const DEFLATING = 1;
const GET_BLOB_DATA = 2;

/**
 * HyBi Sender implementation.
 */
class Sender {
  /**
   * Creates a Sender instance.
   *
   * @param {Duplex} socket The connection socket
   * @param {Object} [extensions] An object containing the negotiated extensions
   * @param {Function} [generateMask] The function used to generate the masking
   *     key
   */
  constructor(socket, extensions, generateMask) {
    this._extensions = extensions || {};

    if (generateMask) {
      this._generateMask = generateMask;
      this._maskBuffer = Buffer.alloc(4);
    }

    this._socket = socket;

    this._firstFragment = true;
    this._compress = false;

    this._bufferedBytes = 0;
    this._queue = [];
    this._state = DEFAULT;
    this.onerror = NOOP;
    this[kWebSocket] = undefined;
  }

  /**
   * Frames a piece of data according to the HyBi WebSocket protocol.
   *
   * @param {(Buffer|String)} data The data to frame
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @return {(Buffer|String)[]} The framed data
   * @public
   */
  static frame(data, options) {
    let mask;
    let merge = false;
    let offset = 2;
    let skipMasking = false;

    if (options.mask) {
      mask = options.maskBuffer || maskBuffer;

      if (options.generateMask) {
        options.generateMask(mask);
      } else {
        if (randomPoolPointer === RANDOM_POOL_SIZE) {
          /* istanbul ignore else  */
          if (randomPool === undefined) {
            //
            // This is lazily initialized because server-sent frames must not
            // be masked so it may never be used.
            //
            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
          }

          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
          randomPoolPointer = 0;
        }

        mask[0] = randomPool[randomPoolPointer++];
        mask[1] = randomPool[randomPoolPointer++];
        mask[2] = randomPool[randomPoolPointer++];
        mask[3] = randomPool[randomPoolPointer++];
      }

      skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
      offset = 6;
    }

    let dataLength;

    if (typeof data === 'string') {
      if (
        (!options.mask || skipMasking) &&
        options[kByteLength] !== undefined
      ) {
        dataLength = options[kByteLength];
      } else {
        data = Buffer.from(data);
        dataLength = data.length;
      }
    } else {
      dataLength = data.length;
      merge = options.mask && options.readOnly && !skipMasking;
    }

    let payloadLength = dataLength;

    if (dataLength >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (dataLength > 125) {
      offset += 2;
      payloadLength = 126;
    }

    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);

    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
    if (options.rsv1) target[0] |= 0x40;

    target[1] = payloadLength;

    if (payloadLength === 126) {
      target.writeUInt16BE(dataLength, 2);
    } else if (payloadLength === 127) {
      target[2] = target[3] = 0;
      target.writeUIntBE(dataLength, 4, 6);
    }

    if (!options.mask) return [target, data];

    target[1] |= 0x80;
    target[offset - 4] = mask[0];
    target[offset - 3] = mask[1];
    target[offset - 2] = mask[2];
    target[offset - 1] = mask[3];

    if (skipMasking) return [target, data];

    if (merge) {
      applyMask(data, mask, target, offset, dataLength);
      return [target];
    }

    applyMask(data, mask, data, 0, dataLength);
    return [target, data];
  }

  /**
   * Sends a close message to the other peer.
   *
   * @param {Number} [code] The status code component of the body
   * @param {(String|Buffer)} [data] The message component of the body
   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
   * @param {Function} [cb] Callback
   * @public
   */
  close(code, data, mask, cb) {
    let buf;

    if (code === undefined) {
      buf = EMPTY_BUFFER;
    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
      throw new TypeError('First argument must be a valid error code number');
    } else if (data === undefined || !data.length) {
      buf = Buffer.allocUnsafe(2);
      buf.writeUInt16BE(code, 0);
    } else {
      const length = Buffer.byteLength(data);

      if (length > 123) {
        throw new RangeError('The message must not be greater than 123 bytes');
      }

      buf = Buffer.allocUnsafe(2 + length);
      buf.writeUInt16BE(code, 0);

      if (typeof data === 'string') {
        buf.write(data, 2);
      } else {
        buf.set(data, 2);
      }
    }

    const options = {
      [kByteLength]: buf.length,
      fin: true,
      generateMask: this._generateMask,
      mask,
      maskBuffer: this._maskBuffer,
      opcode: 0x08,
      readOnly: false,
      rsv1: false
    };

    if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, buf, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(buf, options), cb);
    }
  }

  /**
   * Sends a ping message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  ping(data, mask, cb) {
    let byteLength;
    let readOnly;

    if (typeof data === 'string') {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer(data);
      byteLength = data.length;
      readOnly = toBuffer.readOnly;
    }

    if (byteLength > 125) {
      throw new RangeError('The data size must not be greater than 125 bytes');
    }

    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask,
      maskBuffer: this._maskBuffer,
      opcode: 0x09,
      readOnly,
      rsv1: false
    };

    if (isBlob(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }

  /**
   * Sends a pong message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  pong(data, mask, cb) {
    let byteLength;
    let readOnly;

    if (typeof data === 'string') {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer(data);
      byteLength = data.length;
      readOnly = toBuffer.readOnly;
    }

    if (byteLength > 125) {
      throw new RangeError('The data size must not be greater than 125 bytes');
    }

    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask,
      maskBuffer: this._maskBuffer,
      opcode: 0x0a,
      readOnly,
      rsv1: false
    };

    if (isBlob(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }

  /**
   * Sends a data message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
   *     or text
   * @param {Boolean} [options.compress=false] Specifies whether or not to
   *     compress `data`
   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Function} [cb] Callback
   * @public
   */
  send(data, options, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
    let opcode = options.binary ? 2 : 1;
    let rsv1 = options.compress;

    let byteLength;
    let readOnly;

    if (typeof data === 'string') {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer(data);
      byteLength = data.length;
      readOnly = toBuffer.readOnly;
    }

    if (this._firstFragment) {
      this._firstFragment = false;
      if (
        rsv1 &&
        perMessageDeflate &&
        perMessageDeflate.params[
          perMessageDeflate._isServer
            ? 'server_no_context_takeover'
            : 'client_no_context_takeover'
        ]
      ) {
        rsv1 = byteLength >= perMessageDeflate._threshold;
      }
      this._compress = rsv1;
    } else {
      rsv1 = false;
      opcode = 0;
    }

    if (options.fin) this._firstFragment = true;

    const opts = {
      [kByteLength]: byteLength,
      fin: options.fin,
      generateMask: this._generateMask,
      mask: options.mask,
      maskBuffer: this._maskBuffer,
      opcode,
      readOnly,
      rsv1
    };

    if (isBlob(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
      } else {
        this.getBlobData(data, this._compress, opts, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
    } else {
      this.dispatch(data, this._compress, opts, cb);
    }
  }

  /**
   * Gets the contents of a blob as binary data.
   *
   * @param {Blob} blob The blob
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     the data
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  getBlobData(blob, compress, options, cb) {
    this._bufferedBytes += options[kByteLength];
    this._state = GET_BLOB_DATA;

    blob
      .arrayBuffer()
      .then((arrayBuffer) => {
        if (this._socket.destroyed) {
          const err = new Error(
            'The socket was closed while the blob was being read'
          );

          //
          // `callCallbacks` is called in the next tick to ensure that errors
          // that might be thrown in the callbacks behave like errors thrown
          // outside the promise chain.
          //
          process.nextTick(callCallbacks, this, err, cb);
          return;
        }

        this._bufferedBytes -= options[kByteLength];
        const data = toBuffer(arrayBuffer);

        if (!compress) {
          this._state = DEFAULT;
          this.sendFrame(Sender.frame(data, options), cb);
          this.dequeue();
        } else {
          this.dispatch(data, compress, options, cb);
        }
      })
      .catch((err) => {
        //
        // `onError` is called in the next tick for the same reason that
        // `callCallbacks` above is.
        //
        process.nextTick(onError, this, err, cb);
      });
  }

  /**
   * Dispatches a message.
   *
   * @param {(Buffer|String)} data The message to send
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     `data`
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  dispatch(data, compress, options, cb) {
    if (!compress) {
      this.sendFrame(Sender.frame(data, options), cb);
      return;
    }

    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

    this._bufferedBytes += options[kByteLength];
    this._state = DEFLATING;
    perMessageDeflate.compress(data, options.fin, (_, buf) => {
      if (this._socket.destroyed) {
        const err = new Error(
          'The socket was closed while data was being compressed'
        );

        callCallbacks(this, err, cb);
        return;
      }

      this._bufferedBytes -= options[kByteLength];
      this._state = DEFAULT;
      options.readOnly = false;
      this.sendFrame(Sender.frame(buf, options), cb);
      this.dequeue();
    });
  }

  /**
   * Executes queued send operations.
   *
   * @private
   */
  dequeue() {
    while (this._state === DEFAULT && this._queue.length) {
      const params = this._queue.shift();

      this._bufferedBytes -= params[3][kByteLength];
      Reflect.apply(params[0], this, params.slice(1));
    }
  }

  /**
   * Enqueues a send operation.
   *
   * @param {Array} params Send operation parameters.
   * @private
   */
  enqueue(params) {
    this._bufferedBytes += params[3][kByteLength];
    this._queue.push(params);
  }

  /**
   * Sends a frame.
   *
   * @param {(Buffer | String)[]} list The frame to send
   * @param {Function} [cb] Callback
   * @private
   */
  sendFrame(list, cb) {
    if (list.length === 2) {
      this._socket.cork();
      this._socket.write(list[0]);
      this._socket.write(list[1], cb);
      this._socket.uncork();
    } else {
      this._socket.write(list[0], cb);
    }
  }
}

module.exports = Sender;

/**
 * Calls queued callbacks with an error.
 *
 * @param {Sender} sender The `Sender` instance
 * @param {Error} err The error to call the callbacks with
 * @param {Function} [cb] The first callback
 * @private
 */
function callCallbacks(sender, err, cb) {
  if (typeof cb === 'function') cb(err);

  for (let i = 0; i < sender._queue.length; i++) {
    const params = sender._queue[i];
    const callback = params[params.length - 1];

    if (typeof callback === 'function') callback(err);
  }
}

/**
 * Handles a `Sender` error.
 *
 * @param {Sender} sender The `Sender` instance
 * @param {Error} err The error
 * @param {Function} [cb] The first pending callback
 * @private
 */
function onError(sender, err, cb) {
  callCallbacks(sender, err, cb);
  sender.onerror(err);
}


/***/ },

/***/ "./node_modules/ws/lib/stream.js"
/*!***************************************!*\
  !*** ./node_modules/ws/lib/stream.js ***!
  \***************************************/
(module, __unused_webpack_exports, __webpack_require__) {

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^WebSocket$" }] */


const WebSocket = __webpack_require__(/*! ./websocket */ "./node_modules/ws/lib/websocket.js");
const { Duplex } = __webpack_require__(/*! stream */ "stream");

/**
 * Emits the `'close'` event on a stream.
 *
 * @param {Duplex} stream The stream.
 * @private
 */
function emitClose(stream) {
  stream.emit('close');
}

/**
 * The listener of the `'end'` event.
 *
 * @private
 */
function duplexOnEnd() {
  if (!this.destroyed && this._writableState.finished) {
    this.destroy();
  }
}

/**
 * The listener of the `'error'` event.
 *
 * @param {Error} err The error
 * @private
 */
function duplexOnError(err) {
  this.removeListener('error', duplexOnError);
  this.destroy();
  if (this.listenerCount('error') === 0) {
    // Do not suppress the throwing behavior.
    this.emit('error', err);
  }
}

/**
 * Wraps a `WebSocket` in a duplex stream.
 *
 * @param {WebSocket} ws The `WebSocket` to wrap
 * @param {Object} [options] The options for the `Duplex` constructor
 * @return {Duplex} The duplex stream
 * @public
 */
function createWebSocketStream(ws, options) {
  let terminateOnDestroy = true;

  const duplex = new Duplex({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false
  });

  ws.on('message', function message(msg, isBinary) {
    const data =
      !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;

    if (!duplex.push(data)) ws.pause();
  });

  ws.once('error', function error(err) {
    if (duplex.destroyed) return;

    // Prevent `ws.terminate()` from being called by `duplex._destroy()`.
    //
    // - If the `'error'` event is emitted before the `'open'` event, then
    //   `ws.terminate()` is a noop as no socket is assigned.
    // - Otherwise, the error is re-emitted by the listener of the `'error'`
    //   event of the `Receiver` object. The listener already closes the
    //   connection by calling `ws.close()`. This allows a close frame to be
    //   sent to the other peer. If `ws.terminate()` is called right after this,
    //   then the close frame might not be sent.
    terminateOnDestroy = false;
    duplex.destroy(err);
  });

  ws.once('close', function close() {
    if (duplex.destroyed) return;

    duplex.push(null);
  });

  duplex._destroy = function (err, callback) {
    if (ws.readyState === ws.CLOSED) {
      callback(err);
      process.nextTick(emitClose, duplex);
      return;
    }

    let called = false;

    ws.once('error', function error(err) {
      called = true;
      callback(err);
    });

    ws.once('close', function close() {
      if (!called) callback(err);
      process.nextTick(emitClose, duplex);
    });

    if (terminateOnDestroy) ws.terminate();
  };

  duplex._final = function (callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', function open() {
        duplex._final(callback);
      });
      return;
    }

    // If the value of the `_socket` property is `null` it means that `ws` is a
    // client websocket and the handshake failed. In fact, when this happens, a
    // socket is never assigned to the websocket. Wait for the `'error'` event
    // that will be emitted by the websocket.
    if (ws._socket === null) return;

    if (ws._socket._writableState.finished) {
      callback();
      if (duplex._readableState.endEmitted) duplex.destroy();
    } else {
      ws._socket.once('finish', function finish() {
        // `duplex` is not destroyed here because the `'end'` event will be
        // emitted on `duplex` after this `'finish'` event. The EOF signaling
        // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
        callback();
      });
      ws.close();
    }
  };

  duplex._read = function () {
    if (ws.isPaused) ws.resume();
  };

  duplex._write = function (chunk, encoding, callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', function open() {
        duplex._write(chunk, encoding, callback);
      });
      return;
    }

    ws.send(chunk, callback);
  };

  duplex.on('end', duplexOnEnd);
  duplex.on('error', duplexOnError);
  return duplex;
}

module.exports = createWebSocketStream;


/***/ },

/***/ "./node_modules/ws/lib/subprotocol.js"
/*!********************************************!*\
  !*** ./node_modules/ws/lib/subprotocol.js ***!
  \********************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { tokenChars } = __webpack_require__(/*! ./validation */ "./node_modules/ws/lib/validation.js");

/**
 * Parses the `Sec-WebSocket-Protocol` header into a set of subprotocol names.
 *
 * @param {String} header The field value of the header
 * @return {Set} The subprotocol names
 * @public
 */
function parse(header) {
  const protocols = new Set();
  let start = -1;
  let end = -1;
  let i = 0;

  for (i; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (end === -1 && tokenChars[code] === 1) {
      if (start === -1) start = i;
    } else if (
      i !== 0 &&
      (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
    ) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 0x2c /* ',' */) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }

      if (end === -1) end = i;

      const protocol = header.slice(start, end);

      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }

      protocols.add(protocol);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }

  if (start === -1 || end !== -1) {
    throw new SyntaxError('Unexpected end of input');
  }

  const protocol = header.slice(start, i);

  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }

  protocols.add(protocol);
  return protocols;
}

module.exports = { parse };


/***/ },

/***/ "./node_modules/ws/lib/validation.js"
/*!*******************************************!*\
  !*** ./node_modules/ws/lib/validation.js ***!
  \*******************************************/
(module, __unused_webpack_exports, __webpack_require__) {



const { isUtf8 } = __webpack_require__(/*! buffer */ "buffer");

const { hasBlob } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");

//
// Allowed token characters:
//
// '!', '#', '$', '%', '&', ''', '*', '+', '-',
// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
//
// tokenChars[32] === 0 // ' '
// tokenChars[33] === 1 // '!'
// tokenChars[34] === 0 // '"'
// ...
//
// prettier-ignore
const tokenChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
];

/**
 * Checks if a status code is allowed in a close frame.
 *
 * @param {Number} code The status code
 * @return {Boolean} `true` if the status code is valid, else `false`
 * @public
 */
function isValidStatusCode(code) {
  return (
    (code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

/**
 * Checks if a given buffer contains only correct UTF-8.
 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
 * Markus Kuhn.
 *
 * @param {Buffer} buf The buffer to check
 * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
 * @public
 */
function _isValidUTF8(buf) {
  const len = buf.length;
  let i = 0;

  while (i < len) {
    if ((buf[i] & 0x80) === 0) {
      // 0xxxxxxx
      i++;
    } else if ((buf[i] & 0xe0) === 0xc0) {
      // 110xxxxx 10xxxxxx
      if (
        i + 1 === len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i] & 0xfe) === 0xc0 // Overlong
      ) {
        return false;
      }

      i += 2;
    } else if ((buf[i] & 0xf0) === 0xe0) {
      // 1110xxxx 10xxxxxx 10xxxxxx
      if (
        i + 2 >= len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i + 2] & 0xc0) !== 0x80 ||
        (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
        (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
      ) {
        return false;
      }

      i += 3;
    } else if ((buf[i] & 0xf8) === 0xf0) {
      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
      if (
        i + 3 >= len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i + 2] & 0xc0) !== 0x80 ||
        (buf[i + 3] & 0xc0) !== 0x80 ||
        (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
        (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
        buf[i] > 0xf4 // > U+10FFFF
      ) {
        return false;
      }

      i += 4;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Determines whether a value is a `Blob`.
 *
 * @param {*} value The value to be tested
 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
 * @private
 */
function isBlob(value) {
  return (
    hasBlob &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.type === 'string' &&
    typeof value.stream === 'function' &&
    (value[Symbol.toStringTag] === 'Blob' ||
      value[Symbol.toStringTag] === 'File')
  );
}

module.exports = {
  isBlob,
  isValidStatusCode,
  isValidUTF8: _isValidUTF8,
  tokenChars
};

if (isUtf8) {
  module.exports.isValidUTF8 = function (buf) {
    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
  };
} /* istanbul ignore else  */ else if (!process.env.WS_NO_UTF_8_VALIDATE) {
  try {
    const isValidUTF8 = __webpack_require__(Object(function webpackMissingModule() { var e = new Error("Cannot find module 'utf-8-validate'"); e.code = 'MODULE_NOT_FOUND'; throw e; }()));

    module.exports.isValidUTF8 = function (buf) {
      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
    };
  } catch (e) {
    // Continue regardless of the error.
  }
}


/***/ },

/***/ "./node_modules/ws/lib/websocket-server.js"
/*!*************************************************!*\
  !*** ./node_modules/ws/lib/websocket-server.js ***!
  \*************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex$", "caughtErrors": "none" }] */



const EventEmitter = __webpack_require__(/*! events */ "events");
const http = __webpack_require__(/*! http */ "http");
const { Duplex } = __webpack_require__(/*! stream */ "stream");
const { createHash } = __webpack_require__(/*! crypto */ "crypto");

const extension = __webpack_require__(/*! ./extension */ "./node_modules/ws/lib/extension.js");
const PerMessageDeflate = __webpack_require__(/*! ./permessage-deflate */ "./node_modules/ws/lib/permessage-deflate.js");
const subprotocol = __webpack_require__(/*! ./subprotocol */ "./node_modules/ws/lib/subprotocol.js");
const WebSocket = __webpack_require__(/*! ./websocket */ "./node_modules/ws/lib/websocket.js");
const { CLOSE_TIMEOUT, GUID, kWebSocket } = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");

const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

const RUNNING = 0;
const CLOSING = 1;
const CLOSED = 2;

/**
 * Class representing a WebSocket server.
 *
 * @extends EventEmitter
 */
class WebSocketServer extends EventEmitter {
  /**
   * Create a `WebSocketServer` instance.
   *
   * @param {Object} options Configuration options
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
   *     automatically send a pong in response to a ping
   * @param {Number} [options.backlog=511] The maximum length of the queue of
   *     pending connections
   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
   *     track clients
   * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
   *     wait for the closing handshake to finish after `websocket.close()` is
   *     called
   * @param {Function} [options.handleProtocols] A hook to handle protocols
   * @param {String} [options.host] The hostname where to bind the server
   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
   *     size
   * @param {Boolean} [options.noServer=false] Enable no server mode
   * @param {String} [options.path] Accept only connections matching this path
   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
   *     permessage-deflate
   * @param {Number} [options.port] The port where to bind the server
   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
   *     server to use
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @param {Function} [options.verifyClient] A hook to reject connections
   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
   *     class to use. It must be the `WebSocket` class or class that extends it
   * @param {Function} [callback] A listener for the `listening` event
   */
  constructor(options, callback) {
    super();

    options = {
      allowSynchronousEvents: true,
      autoPong: true,
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      closeTimeout: CLOSE_TIMEOUT,
      verifyClient: null,
      noServer: false,
      backlog: null, // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      WebSocket,
      ...options
    };

    if (
      (options.port == null && !options.server && !options.noServer) ||
      (options.port != null && (options.server || options.noServer)) ||
      (options.server && options.noServer)
    ) {
      throw new TypeError(
        'One and only one of the "port", "server", or "noServer" options ' +
          'must be specified'
      );
    }

    if (options.port != null) {
      this._server = http.createServer((req, res) => {
        const body = http.STATUS_CODES[426];

        res.writeHead(426, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain'
        });
        res.end(body);
      });
      this._server.listen(
        options.port,
        options.host,
        options.backlog,
        callback
      );
    } else if (options.server) {
      this._server = options.server;
    }

    if (this._server) {
      const emitConnection = this.emit.bind(this, 'connection');

      this._removeListeners = addListeners(this._server, {
        listening: this.emit.bind(this, 'listening'),
        error: this.emit.bind(this, 'error'),
        upgrade: (req, socket, head) => {
          this.handleUpgrade(req, socket, head, emitConnection);
        }
      });
    }

    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = new Set();
      this._shouldEmitClose = false;
    }

    this.options = options;
    this._state = RUNNING;
  }

  /**
   * Returns the bound address, the address family name, and port of the server
   * as reported by the operating system if listening on an IP socket.
   * If the server is listening on a pipe or UNIX domain socket, the name is
   * returned as a string.
   *
   * @return {(Object|String|null)} The address of the server
   * @public
   */
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }

    if (!this._server) return null;
    return this._server.address();
  }

  /**
   * Stop the server from accepting new connections and emit the `'close'` event
   * when all existing connections are closed.
   *
   * @param {Function} [cb] A one-time listener for the `'close'` event
   * @public
   */
  close(cb) {
    if (this._state === CLOSED) {
      if (cb) {
        this.once('close', () => {
          cb(new Error('The server is not running'));
        });
      }

      process.nextTick(emitClose, this);
      return;
    }

    if (cb) this.once('close', cb);

    if (this._state === CLOSING) return;
    this._state = CLOSING;

    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
      }

      if (this.clients) {
        if (!this.clients.size) {
          process.nextTick(emitClose, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick(emitClose, this);
      }
    } else {
      const server = this._server;

      this._removeListeners();
      this._removeListeners = this._server = null;

      //
      // The HTTP/S server was created internally. Close it, and rely on its
      // `'close'` event.
      //
      server.close(() => {
        emitClose(this);
      });
    }
  }

  /**
   * See if a given request should be handled by this server instance.
   *
   * @param {http.IncomingMessage} req Request object to inspect
   * @return {Boolean} `true` if the request is valid, else `false`
   * @public
   */
  shouldHandle(req) {
    if (this.options.path) {
      const index = req.url.indexOf('?');
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

      if (pathname !== this.options.path) return false;
    }

    return true;
  }

  /**
   * Handle a HTTP Upgrade request.
   *
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @public
   */
  handleUpgrade(req, socket, head, cb) {
    socket.on('error', socketOnError);

    const key = req.headers['sec-websocket-key'];
    const upgrade = req.headers.upgrade;
    const version = +req.headers['sec-websocket-version'];

    if (req.method !== 'GET') {
      const message = 'Invalid HTTP method';
      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
      return;
    }

    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
      const message = 'Invalid Upgrade header';
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }

    if (key === undefined || !keyRegex.test(key)) {
      const message = 'Missing or invalid Sec-WebSocket-Key header';
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }

    if (version !== 13 && version !== 8) {
      const message = 'Missing or invalid Sec-WebSocket-Version header';
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
        'Sec-WebSocket-Version': '13, 8'
      });
      return;
    }

    if (!this.shouldHandle(req)) {
      abortHandshake(socket, 400);
      return;
    }

    const secWebSocketProtocol = req.headers['sec-websocket-protocol'];
    let protocols = new Set();

    if (secWebSocketProtocol !== undefined) {
      try {
        protocols = subprotocol.parse(secWebSocketProtocol);
      } catch (err) {
        const message = 'Invalid Sec-WebSocket-Protocol header';
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }

    const secWebSocketExtensions = req.headers['sec-websocket-extensions'];
    const extensions = {};

    if (
      this.options.perMessageDeflate &&
      secWebSocketExtensions !== undefined
    ) {
      const perMessageDeflate = new PerMessageDeflate(
        this.options.perMessageDeflate,
        true,
        this.options.maxPayload
      );

      try {
        const offers = extension.parse(secWebSocketExtensions);

        if (offers[PerMessageDeflate.extensionName]) {
          perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
          extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
      } catch (err) {
        const message =
          'Invalid or unacceptable Sec-WebSocket-Extensions header';
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }

    //
    // Optionally call external client verification handler.
    //
    if (this.options.verifyClient) {
      const info = {
        origin:
          req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
        secure: !!(req.socket.authorized || req.socket.encrypted),
        req
      };

      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortHandshake(socket, code || 401, message, headers);
          }

          this.completeUpgrade(
            extensions,
            key,
            protocols,
            req,
            socket,
            head,
            cb
          );
        });
        return;
      }

      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
    }

    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
  }

  /**
   * Upgrade the connection to WebSocket.
   *
   * @param {Object} extensions The accepted extensions
   * @param {String} key The value of the `Sec-WebSocket-Key` header
   * @param {Set} protocols The subprotocols
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @throws {Error} If called more than once with the same socket
   * @private
   */
  completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
    //
    // Destroy the socket if the client has already sent a FIN packet.
    //
    if (!socket.readable || !socket.writable) return socket.destroy();

    if (socket[kWebSocket]) {
      throw new Error(
        'server.handleUpgrade() was called more than once with the same ' +
          'socket, possibly due to a misconfiguration'
      );
    }

    if (this._state > RUNNING) return abortHandshake(socket, 503);

    const digest = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${digest}`
    ];

    const ws = new this.options.WebSocket(null, undefined, this.options);

    if (protocols.size) {
      //
      // Optionally call external protocol selection handler.
      //
      const protocol = this.options.handleProtocols
        ? this.options.handleProtocols(protocols, req)
        : protocols.values().next().value;

      if (protocol) {
        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
        ws._protocol = protocol;
      }
    }

    if (extensions[PerMessageDeflate.extensionName]) {
      const params = extensions[PerMessageDeflate.extensionName].params;
      const value = extension.format({
        [PerMessageDeflate.extensionName]: [params]
      });
      headers.push(`Sec-WebSocket-Extensions: ${value}`);
      ws._extensions = extensions;
    }

    //
    // Allow external modification/inspection of handshake headers.
    //
    this.emit('headers', headers, req);

    socket.write(headers.concat('\r\n').join('\r\n'));
    socket.removeListener('error', socketOnError);

    ws.setSocket(socket, head, {
      allowSynchronousEvents: this.options.allowSynchronousEvents,
      maxPayload: this.options.maxPayload,
      skipUTF8Validation: this.options.skipUTF8Validation
    });

    if (this.clients) {
      this.clients.add(ws);
      ws.on('close', () => {
        this.clients.delete(ws);

        if (this._shouldEmitClose && !this.clients.size) {
          process.nextTick(emitClose, this);
        }
      });
    }

    cb(ws, req);
  }
}

module.exports = WebSocketServer;

/**
 * Add event listeners on an `EventEmitter` using a map of <event, listener>
 * pairs.
 *
 * @param {EventEmitter} server The event emitter
 * @param {Object.<String, Function>} map The listeners to add
 * @return {Function} A function that will remove the added listeners when
 *     called
 * @private
 */
function addListeners(server, map) {
  for (const event of Object.keys(map)) server.on(event, map[event]);

  return function removeListeners() {
    for (const event of Object.keys(map)) {
      server.removeListener(event, map[event]);
    }
  };
}

/**
 * Emit a `'close'` event on an `EventEmitter`.
 *
 * @param {EventEmitter} server The event emitter
 * @private
 */
function emitClose(server) {
  server._state = CLOSED;
  server.emit('close');
}

/**
 * Handle socket errors.
 *
 * @private
 */
function socketOnError() {
  this.destroy();
}

/**
 * Close the connection when preconditions are not fulfilled.
 *
 * @param {Duplex} socket The socket of the upgrade request
 * @param {Number} code The HTTP response status code
 * @param {String} [message] The HTTP response body
 * @param {Object} [headers] Additional HTTP response headers
 * @private
 */
function abortHandshake(socket, code, message, headers) {
  //
  // The socket is writable unless the user destroyed or ended it before calling
  // `server.handleUpgrade()` or in the `verifyClient` function, which is a user
  // error. Handling this does not make much sense as the worst that can happen
  // is that some of the data written by the user might be discarded due to the
  // call to `socket.end()` below, which triggers an `'error'` event that in
  // turn causes the socket to be destroyed.
  //
  message = message || http.STATUS_CODES[code];
  headers = {
    Connection: 'close',
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(message),
    ...headers
  };

  socket.once('finish', socket.destroy);

  socket.end(
    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\n` +
      Object.keys(headers)
        .map((h) => `${h}: ${headers[h]}`)
        .join('\r\n') +
      '\r\n\r\n' +
      message
  );
}

/**
 * Emit a `'wsClientError'` event on a `WebSocketServer` if there is at least
 * one listener for it, otherwise call `abortHandshake()`.
 *
 * @param {WebSocketServer} server The WebSocket server
 * @param {http.IncomingMessage} req The request object
 * @param {Duplex} socket The socket of the upgrade request
 * @param {Number} code The HTTP response status code
 * @param {String} message The HTTP response body
 * @param {Object} [headers] The HTTP response headers
 * @private
 */
function abortHandshakeOrEmitwsClientError(
  server,
  req,
  socket,
  code,
  message,
  headers
) {
  if (server.listenerCount('wsClientError')) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

    server.emit('wsClientError', err, socket, req);
  } else {
    abortHandshake(socket, code, message, headers);
  }
}


/***/ },

/***/ "./node_modules/ws/lib/websocket.js"
/*!******************************************!*\
  !*** ./node_modules/ws/lib/websocket.js ***!
  \******************************************/
(module, __unused_webpack_exports, __webpack_require__) {

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex|Readable$", "caughtErrors": "none" }] */



const EventEmitter = __webpack_require__(/*! events */ "events");
const https = __webpack_require__(/*! https */ "https");
const http = __webpack_require__(/*! http */ "http");
const net = __webpack_require__(/*! net */ "net");
const tls = __webpack_require__(/*! tls */ "tls");
const { randomBytes, createHash } = __webpack_require__(/*! crypto */ "crypto");
const { Duplex, Readable } = __webpack_require__(/*! stream */ "stream");
const { URL } = __webpack_require__(/*! url */ "url");

const PerMessageDeflate = __webpack_require__(/*! ./permessage-deflate */ "./node_modules/ws/lib/permessage-deflate.js");
const Receiver = __webpack_require__(/*! ./receiver */ "./node_modules/ws/lib/receiver.js");
const Sender = __webpack_require__(/*! ./sender */ "./node_modules/ws/lib/sender.js");
const { isBlob } = __webpack_require__(/*! ./validation */ "./node_modules/ws/lib/validation.js");

const {
  BINARY_TYPES,
  CLOSE_TIMEOUT,
  EMPTY_BUFFER,
  GUID,
  kForOnEventAttribute,
  kListener,
  kStatusCode,
  kWebSocket,
  NOOP
} = __webpack_require__(/*! ./constants */ "./node_modules/ws/lib/constants.js");
const {
  EventTarget: { addEventListener, removeEventListener }
} = __webpack_require__(/*! ./event-target */ "./node_modules/ws/lib/event-target.js");
const { format, parse } = __webpack_require__(/*! ./extension */ "./node_modules/ws/lib/extension.js");
const { toBuffer } = __webpack_require__(/*! ./buffer-util */ "./node_modules/ws/lib/buffer-util.js");

const kAborted = Symbol('kAborted');
const protocolVersions = [8, 13];
const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

/**
 * Class representing a WebSocket.
 *
 * @extends EventEmitter
 */
class WebSocket extends EventEmitter {
  /**
   * Create a new `WebSocket`.
   *
   * @param {(String|URL)} address The URL to which to connect
   * @param {(String|String[])} [protocols] The subprotocols
   * @param {Object} [options] Connection options
   */
  constructor(address, protocols, options) {
    super();

    this._binaryType = BINARY_TYPES[0];
    this._closeCode = 1006;
    this._closeFrameReceived = false;
    this._closeFrameSent = false;
    this._closeMessage = EMPTY_BUFFER;
    this._closeTimer = null;
    this._errorEmitted = false;
    this._extensions = {};
    this._paused = false;
    this._protocol = '';
    this._readyState = WebSocket.CONNECTING;
    this._receiver = null;
    this._sender = null;
    this._socket = null;

    if (address !== null) {
      this._bufferedAmount = 0;
      this._isServer = false;
      this._redirects = 0;

      if (protocols === undefined) {
        protocols = [];
      } else if (!Array.isArray(protocols)) {
        if (typeof protocols === 'object' && protocols !== null) {
          options = protocols;
          protocols = [];
        } else {
          protocols = [protocols];
        }
      }

      initAsClient(this, address, protocols, options);
    } else {
      this._autoPong = options.autoPong;
      this._closeTimeout = options.closeTimeout;
      this._isServer = true;
    }
  }

  /**
   * For historical reasons, the custom "nodebuffer" type is used by the default
   * instead of "blob".
   *
   * @type {String}
   */
  get binaryType() {
    return this._binaryType;
  }

  set binaryType(type) {
    if (!BINARY_TYPES.includes(type)) return;

    this._binaryType = type;

    //
    // Allow to change `binaryType` on the fly.
    //
    if (this._receiver) this._receiver._binaryType = type;
  }

  /**
   * @type {Number}
   */
  get bufferedAmount() {
    if (!this._socket) return this._bufferedAmount;

    return this._socket._writableState.length + this._sender._bufferedBytes;
  }

  /**
   * @type {String}
   */
  get extensions() {
    return Object.keys(this._extensions).join();
  }

  /**
   * @type {Boolean}
   */
  get isPaused() {
    return this._paused;
  }

  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onclose() {
    return null;
  }

  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onerror() {
    return null;
  }

  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onopen() {
    return null;
  }

  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onmessage() {
    return null;
  }

  /**
   * @type {String}
   */
  get protocol() {
    return this._protocol;
  }

  /**
   * @type {Number}
   */
  get readyState() {
    return this._readyState;
  }

  /**
   * @type {String}
   */
  get url() {
    return this._url;
  }

  /**
   * Set up the socket and the internal resources.
   *
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Object} options Options object
   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Number} [options.maxPayload=0] The maximum allowed message size
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @private
   */
  setSocket(socket, head, options) {
    const receiver = new Receiver({
      allowSynchronousEvents: options.allowSynchronousEvents,
      binaryType: this.binaryType,
      extensions: this._extensions,
      isServer: this._isServer,
      maxPayload: options.maxPayload,
      skipUTF8Validation: options.skipUTF8Validation
    });

    const sender = new Sender(socket, this._extensions, options.generateMask);

    this._receiver = receiver;
    this._sender = sender;
    this._socket = socket;

    receiver[kWebSocket] = this;
    sender[kWebSocket] = this;
    socket[kWebSocket] = this;

    receiver.on('conclude', receiverOnConclude);
    receiver.on('drain', receiverOnDrain);
    receiver.on('error', receiverOnError);
    receiver.on('message', receiverOnMessage);
    receiver.on('ping', receiverOnPing);
    receiver.on('pong', receiverOnPong);

    sender.onerror = senderOnError;

    //
    // These methods may not be available if `socket` is just a `Duplex`.
    //
    if (socket.setTimeout) socket.setTimeout(0);
    if (socket.setNoDelay) socket.setNoDelay();

    if (head.length > 0) socket.unshift(head);

    socket.on('close', socketOnClose);
    socket.on('data', socketOnData);
    socket.on('end', socketOnEnd);
    socket.on('error', socketOnError);

    this._readyState = WebSocket.OPEN;
    this.emit('open');
  }

  /**
   * Emit the `'close'` event.
   *
   * @private
   */
  emitClose() {
    if (!this._socket) {
      this._readyState = WebSocket.CLOSED;
      this.emit('close', this._closeCode, this._closeMessage);
      return;
    }

    if (this._extensions[PerMessageDeflate.extensionName]) {
      this._extensions[PerMessageDeflate.extensionName].cleanup();
    }

    this._receiver.removeAllListeners();
    this._readyState = WebSocket.CLOSED;
    this.emit('close', this._closeCode, this._closeMessage);
  }

  /**
   * Start a closing handshake.
   *
   *          +----------+   +-----------+   +----------+
   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
   *    |     +----------+   +-----------+   +----------+     |
   *          +----------+   +-----------+         |
   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
   *          +----------+   +-----------+   |
   *    |           |                        |   +---+        |
   *                +------------------------+-->|fin| - - - -
   *    |         +---+                      |   +---+
   *     - - - - -|fin|<---------------------+
   *              +---+
   *
   * @param {Number} [code] Status code explaining why the connection is closing
   * @param {(String|Buffer)} [data] The reason why the connection is
   *     closing
   * @public
   */
  close(code, data) {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = 'WebSocket was closed before the connection was established';
      abortHandshake(this, this._req, msg);
      return;
    }

    if (this.readyState === WebSocket.CLOSING) {
      if (
        this._closeFrameSent &&
        (this._closeFrameReceived || this._receiver._writableState.errorEmitted)
      ) {
        this._socket.end();
      }

      return;
    }

    this._readyState = WebSocket.CLOSING;
    this._sender.close(code, data, !this._isServer, (err) => {
      //
      // This error is handled by the `'error'` listener on the socket. We only
      // want to know if the close frame has been sent here.
      //
      if (err) return;

      this._closeFrameSent = true;

      if (
        this._closeFrameReceived ||
        this._receiver._writableState.errorEmitted
      ) {
        this._socket.end();
      }
    });

    setCloseTimer(this);
  }

  /**
   * Pause the socket.
   *
   * @public
   */
  pause() {
    if (
      this.readyState === WebSocket.CONNECTING ||
      this.readyState === WebSocket.CLOSED
    ) {
      return;
    }

    this._paused = true;
    this._socket.pause();
  }

  /**
   * Send a ping.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the ping is sent
   * @public
   */
  ping(data, mask, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof data === 'function') {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === 'function') {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    if (mask === undefined) mask = !this._isServer;
    this._sender.ping(data || EMPTY_BUFFER, mask, cb);
  }

  /**
   * Send a pong.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the pong is sent
   * @public
   */
  pong(data, mask, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof data === 'function') {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === 'function') {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    if (mask === undefined) mask = !this._isServer;
    this._sender.pong(data || EMPTY_BUFFER, mask, cb);
  }

  /**
   * Resume the socket.
   *
   * @public
   */
  resume() {
    if (
      this.readyState === WebSocket.CONNECTING ||
      this.readyState === WebSocket.CLOSED
    ) {
      return;
    }

    this._paused = false;
    if (!this._receiver._writableState.needDrain) this._socket.resume();
  }

  /**
   * Send a data message.
   *
   * @param {*} data The message to send
   * @param {Object} [options] Options object
   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
   *     text
   * @param {Boolean} [options.compress] Specifies whether or not to compress
   *     `data`
   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when data is written out
   * @public
   */
  send(data, options, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof options === 'function') {
      cb = options;
      options = {};
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    const opts = {
      binary: typeof data !== 'string',
      mask: !this._isServer,
      compress: true,
      fin: true,
      ...options
    };

    if (!this._extensions[PerMessageDeflate.extensionName]) {
      opts.compress = false;
    }

    this._sender.send(data || EMPTY_BUFFER, opts, cb);
  }

  /**
   * Forcibly close the connection.
   *
   * @public
   */
  terminate() {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = 'WebSocket was closed before the connection was established';
      abortHandshake(this, this._req, msg);
      return;
    }

    if (this._socket) {
      this._readyState = WebSocket.CLOSING;
      this._socket.destroy();
    }
  }
}

/**
 * @constant {Number} CONNECTING
 * @memberof WebSocket
 */
Object.defineProperty(WebSocket, 'CONNECTING', {
  enumerable: true,
  value: readyStates.indexOf('CONNECTING')
});

/**
 * @constant {Number} CONNECTING
 * @memberof WebSocket.prototype
 */
Object.defineProperty(WebSocket.prototype, 'CONNECTING', {
  enumerable: true,
  value: readyStates.indexOf('CONNECTING')
});

/**
 * @constant {Number} OPEN
 * @memberof WebSocket
 */
Object.defineProperty(WebSocket, 'OPEN', {
  enumerable: true,
  value: readyStates.indexOf('OPEN')
});

/**
 * @constant {Number} OPEN
 * @memberof WebSocket.prototype
 */
Object.defineProperty(WebSocket.prototype, 'OPEN', {
  enumerable: true,
  value: readyStates.indexOf('OPEN')
});

/**
 * @constant {Number} CLOSING
 * @memberof WebSocket
 */
Object.defineProperty(WebSocket, 'CLOSING', {
  enumerable: true,
  value: readyStates.indexOf('CLOSING')
});

/**
 * @constant {Number} CLOSING
 * @memberof WebSocket.prototype
 */
Object.defineProperty(WebSocket.prototype, 'CLOSING', {
  enumerable: true,
  value: readyStates.indexOf('CLOSING')
});

/**
 * @constant {Number} CLOSED
 * @memberof WebSocket
 */
Object.defineProperty(WebSocket, 'CLOSED', {
  enumerable: true,
  value: readyStates.indexOf('CLOSED')
});

/**
 * @constant {Number} CLOSED
 * @memberof WebSocket.prototype
 */
Object.defineProperty(WebSocket.prototype, 'CLOSED', {
  enumerable: true,
  value: readyStates.indexOf('CLOSED')
});

[
  'binaryType',
  'bufferedAmount',
  'extensions',
  'isPaused',
  'protocol',
  'readyState',
  'url'
].forEach((property) => {
  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
});

//
// Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
// See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
//
['open', 'error', 'close', 'message'].forEach((method) => {
  Object.defineProperty(WebSocket.prototype, `on${method}`, {
    enumerable: true,
    get() {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) return listener[kListener];
      }

      return null;
    },
    set(handler) {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) {
          this.removeListener(method, listener);
          break;
        }
      }

      if (typeof handler !== 'function') return;

      this.addEventListener(method, handler, {
        [kForOnEventAttribute]: true
      });
    }
  });
});

WebSocket.prototype.addEventListener = addEventListener;
WebSocket.prototype.removeEventListener = removeEventListener;

module.exports = WebSocket;

/**
 * Initialize a WebSocket client.
 *
 * @param {WebSocket} websocket The client to initialize
 * @param {(String|URL)} address The URL to which to connect
 * @param {Array} protocols The subprotocols
 * @param {Object} [options] Connection options
 * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether any
 *     of the `'message'`, `'ping'`, and `'pong'` events can be emitted multiple
 *     times in the same tick
 * @param {Boolean} [options.autoPong=true] Specifies whether or not to
 *     automatically send a pong in response to a ping
 * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to wait
 *     for the closing handshake to finish after `websocket.close()` is called
 * @param {Function} [options.finishRequest] A function which can be used to
 *     customize the headers of each http request before it is sent
 * @param {Boolean} [options.followRedirects=false] Whether or not to follow
 *     redirects
 * @param {Function} [options.generateMask] The function used to generate the
 *     masking key
 * @param {Number} [options.handshakeTimeout] Timeout in milliseconds for the
 *     handshake request
 * @param {Number} [options.maxPayload=104857600] The maximum allowed message
 *     size
 * @param {Number} [options.maxRedirects=10] The maximum number of redirects
 *     allowed
 * @param {String} [options.origin] Value of the `Origin` or
 *     `Sec-WebSocket-Origin` header
 * @param {(Boolean|Object)} [options.perMessageDeflate=true] Enable/disable
 *     permessage-deflate
 * @param {Number} [options.protocolVersion=13] Value of the
 *     `Sec-WebSocket-Version` header
 * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
 *     not to skip UTF-8 validation for text and close messages
 * @private
 */
function initAsClient(websocket, address, protocols, options) {
  const opts = {
    allowSynchronousEvents: true,
    autoPong: true,
    closeTimeout: CLOSE_TIMEOUT,
    protocolVersion: protocolVersions[1],
    maxPayload: 100 * 1024 * 1024,
    skipUTF8Validation: false,
    perMessageDeflate: true,
    followRedirects: false,
    maxRedirects: 10,
    ...options,
    socketPath: undefined,
    hostname: undefined,
    protocol: undefined,
    timeout: undefined,
    method: 'GET',
    host: undefined,
    path: undefined,
    port: undefined
  };

  websocket._autoPong = opts.autoPong;
  websocket._closeTimeout = opts.closeTimeout;

  if (!protocolVersions.includes(opts.protocolVersion)) {
    throw new RangeError(
      `Unsupported protocol version: ${opts.protocolVersion} ` +
        `(supported versions: ${protocolVersions.join(', ')})`
    );
  }

  let parsedUrl;

  if (address instanceof URL) {
    parsedUrl = address;
  } else {
    try {
      parsedUrl = new URL(address);
    } catch (e) {
      throw new SyntaxError(`Invalid URL: ${address}`);
    }
  }

  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'ws:';
  } else if (parsedUrl.protocol === 'https:') {
    parsedUrl.protocol = 'wss:';
  }

  websocket._url = parsedUrl.href;

  const isSecure = parsedUrl.protocol === 'wss:';
  const isIpcUrl = parsedUrl.protocol === 'ws+unix:';
  let invalidUrlMessage;

  if (parsedUrl.protocol !== 'ws:' && !isSecure && !isIpcUrl) {
    invalidUrlMessage =
      'The URL\'s protocol must be one of "ws:", "wss:", ' +
      '"http:", "https:", or "ws+unix:"';
  } else if (isIpcUrl && !parsedUrl.pathname) {
    invalidUrlMessage = "The URL's pathname is empty";
  } else if (parsedUrl.hash) {
    invalidUrlMessage = 'The URL contains a fragment identifier';
  }

  if (invalidUrlMessage) {
    const err = new SyntaxError(invalidUrlMessage);

    if (websocket._redirects === 0) {
      throw err;
    } else {
      emitErrorAndClose(websocket, err);
      return;
    }
  }

  const defaultPort = isSecure ? 443 : 80;
  const key = randomBytes(16).toString('base64');
  const request = isSecure ? https.request : http.request;
  const protocolSet = new Set();
  let perMessageDeflate;

  opts.createConnection =
    opts.createConnection || (isSecure ? tlsConnect : netConnect);
  opts.defaultPort = opts.defaultPort || defaultPort;
  opts.port = parsedUrl.port || defaultPort;
  opts.host = parsedUrl.hostname.startsWith('[')
    ? parsedUrl.hostname.slice(1, -1)
    : parsedUrl.hostname;
  opts.headers = {
    ...opts.headers,
    'Sec-WebSocket-Version': opts.protocolVersion,
    'Sec-WebSocket-Key': key,
    Connection: 'Upgrade',
    Upgrade: 'websocket'
  };
  opts.path = parsedUrl.pathname + parsedUrl.search;
  opts.timeout = opts.handshakeTimeout;

  if (opts.perMessageDeflate) {
    perMessageDeflate = new PerMessageDeflate(
      opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
      false,
      opts.maxPayload
    );
    opts.headers['Sec-WebSocket-Extensions'] = format({
      [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
    });
  }
  if (protocols.length) {
    for (const protocol of protocols) {
      if (
        typeof protocol !== 'string' ||
        !subprotocolRegex.test(protocol) ||
        protocolSet.has(protocol)
      ) {
        throw new SyntaxError(
          'An invalid or duplicated subprotocol was specified'
        );
      }

      protocolSet.add(protocol);
    }

    opts.headers['Sec-WebSocket-Protocol'] = protocols.join(',');
  }
  if (opts.origin) {
    if (opts.protocolVersion < 13) {
      opts.headers['Sec-WebSocket-Origin'] = opts.origin;
    } else {
      opts.headers.Origin = opts.origin;
    }
  }
  if (parsedUrl.username || parsedUrl.password) {
    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
  }

  if (isIpcUrl) {
    const parts = opts.path.split(':');

    opts.socketPath = parts[0];
    opts.path = parts[1];
  }

  let req;

  if (opts.followRedirects) {
    if (websocket._redirects === 0) {
      websocket._originalIpc = isIpcUrl;
      websocket._originalSecure = isSecure;
      websocket._originalHostOrSocketPath = isIpcUrl
        ? opts.socketPath
        : parsedUrl.host;

      const headers = options && options.headers;

      //
      // Shallow copy the user provided options so that headers can be changed
      // without mutating the original object.
      //
      options = { ...options, headers: {} };

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          options.headers[key.toLowerCase()] = value;
        }
      }
    } else if (websocket.listenerCount('redirect') === 0) {
      const isSameHost = isIpcUrl
        ? websocket._originalIpc
          ? opts.socketPath === websocket._originalHostOrSocketPath
          : false
        : websocket._originalIpc
          ? false
          : parsedUrl.host === websocket._originalHostOrSocketPath;

      if (!isSameHost || (websocket._originalSecure && !isSecure)) {
        //
        // Match curl 7.77.0 behavior and drop the following headers. These
        // headers are also dropped when following a redirect to a subdomain.
        //
        delete opts.headers.authorization;
        delete opts.headers.cookie;

        if (!isSameHost) delete opts.headers.host;

        opts.auth = undefined;
      }
    }

    //
    // Match curl 7.77.0 behavior and make the first `Authorization` header win.
    // If the `Authorization` header is set, then there is nothing to do as it
    // will take precedence.
    //
    if (opts.auth && !options.headers.authorization) {
      options.headers.authorization =
        'Basic ' + Buffer.from(opts.auth).toString('base64');
    }

    req = websocket._req = request(opts);

    if (websocket._redirects) {
      //
      // Unlike what is done for the `'upgrade'` event, no early exit is
      // triggered here if the user calls `websocket.close()` or
      // `websocket.terminate()` from a listener of the `'redirect'` event. This
      // is because the user can also call `request.destroy()` with an error
      // before calling `websocket.close()` or `websocket.terminate()` and this
      // would result in an error being emitted on the `request` object with no
      // `'error'` event listeners attached.
      //
      websocket.emit('redirect', websocket.url, req);
    }
  } else {
    req = websocket._req = request(opts);
  }

  if (opts.timeout) {
    req.on('timeout', () => {
      abortHandshake(websocket, req, 'Opening handshake has timed out');
    });
  }

  req.on('error', (err) => {
    if (req === null || req[kAborted]) return;

    req = websocket._req = null;
    emitErrorAndClose(websocket, err);
  });

  req.on('response', (res) => {
    const location = res.headers.location;
    const statusCode = res.statusCode;

    if (
      location &&
      opts.followRedirects &&
      statusCode >= 300 &&
      statusCode < 400
    ) {
      if (++websocket._redirects > opts.maxRedirects) {
        abortHandshake(websocket, req, 'Maximum redirects exceeded');
        return;
      }

      req.abort();

      let addr;

      try {
        addr = new URL(location, address);
      } catch (e) {
        const err = new SyntaxError(`Invalid URL: ${location}`);
        emitErrorAndClose(websocket, err);
        return;
      }

      initAsClient(websocket, addr, protocols, options);
    } else if (!websocket.emit('unexpected-response', req, res)) {
      abortHandshake(
        websocket,
        req,
        `Unexpected server response: ${res.statusCode}`
      );
    }
  });

  req.on('upgrade', (res, socket, head) => {
    websocket.emit('upgrade', res);

    //
    // The user may have closed the connection from a listener of the
    // `'upgrade'` event.
    //
    if (websocket.readyState !== WebSocket.CONNECTING) return;

    req = websocket._req = null;

    const upgrade = res.headers.upgrade;

    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
      abortHandshake(websocket, socket, 'Invalid Upgrade header');
      return;
    }

    const digest = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    if (res.headers['sec-websocket-accept'] !== digest) {
      abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
      return;
    }

    const serverProt = res.headers['sec-websocket-protocol'];
    let protError;

    if (serverProt !== undefined) {
      if (!protocolSet.size) {
        protError = 'Server sent a subprotocol but none was requested';
      } else if (!protocolSet.has(serverProt)) {
        protError = 'Server sent an invalid subprotocol';
      }
    } else if (protocolSet.size) {
      protError = 'Server sent no subprotocol';
    }

    if (protError) {
      abortHandshake(websocket, socket, protError);
      return;
    }

    if (serverProt) websocket._protocol = serverProt;

    const secWebSocketExtensions = res.headers['sec-websocket-extensions'];

    if (secWebSocketExtensions !== undefined) {
      if (!perMessageDeflate) {
        const message =
          'Server sent a Sec-WebSocket-Extensions header but no extension ' +
          'was requested';
        abortHandshake(websocket, socket, message);
        return;
      }

      let extensions;

      try {
        extensions = parse(secWebSocketExtensions);
      } catch (err) {
        const message = 'Invalid Sec-WebSocket-Extensions header';
        abortHandshake(websocket, socket, message);
        return;
      }

      const extensionNames = Object.keys(extensions);

      if (
        extensionNames.length !== 1 ||
        extensionNames[0] !== PerMessageDeflate.extensionName
      ) {
        const message = 'Server indicated an extension that was not requested';
        abortHandshake(websocket, socket, message);
        return;
      }

      try {
        perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
      } catch (err) {
        const message = 'Invalid Sec-WebSocket-Extensions header';
        abortHandshake(websocket, socket, message);
        return;
      }

      websocket._extensions[PerMessageDeflate.extensionName] =
        perMessageDeflate;
    }

    websocket.setSocket(socket, head, {
      allowSynchronousEvents: opts.allowSynchronousEvents,
      generateMask: opts.generateMask,
      maxPayload: opts.maxPayload,
      skipUTF8Validation: opts.skipUTF8Validation
    });
  });

  if (opts.finishRequest) {
    opts.finishRequest(req, websocket);
  } else {
    req.end();
  }
}

/**
 * Emit the `'error'` and `'close'` events.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @param {Error} The error to emit
 * @private
 */
function emitErrorAndClose(websocket, err) {
  websocket._readyState = WebSocket.CLOSING;
  //
  // The following assignment is practically useless and is done only for
  // consistency.
  //
  websocket._errorEmitted = true;
  websocket.emit('error', err);
  websocket.emitClose();
}

/**
 * Create a `net.Socket` and initiate a connection.
 *
 * @param {Object} options Connection options
 * @return {net.Socket} The newly created socket used to start the connection
 * @private
 */
function netConnect(options) {
  options.path = options.socketPath;
  return net.connect(options);
}

/**
 * Create a `tls.TLSSocket` and initiate a connection.
 *
 * @param {Object} options Connection options
 * @return {tls.TLSSocket} The newly created socket used to start the connection
 * @private
 */
function tlsConnect(options) {
  options.path = undefined;

  if (!options.servername && options.servername !== '') {
    options.servername = net.isIP(options.host) ? '' : options.host;
  }

  return tls.connect(options);
}

/**
 * Abort the handshake and emit an error.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @param {(http.ClientRequest|net.Socket|tls.Socket)} stream The request to
 *     abort or the socket to destroy
 * @param {String} message The error message
 * @private
 */
function abortHandshake(websocket, stream, message) {
  websocket._readyState = WebSocket.CLOSING;

  const err = new Error(message);
  Error.captureStackTrace(err, abortHandshake);

  if (stream.setHeader) {
    stream[kAborted] = true;
    stream.abort();

    if (stream.socket && !stream.socket.destroyed) {
      //
      // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if
      // called after the request completed. See
      // https://github.com/websockets/ws/issues/1869.
      //
      stream.socket.destroy();
    }

    process.nextTick(emitErrorAndClose, websocket, err);
  } else {
    stream.destroy(err);
    stream.once('error', websocket.emit.bind(websocket, 'error'));
    stream.once('close', websocket.emitClose.bind(websocket));
  }
}

/**
 * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
 * when the `readyState` attribute is `CLOSING` or `CLOSED`.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @param {*} [data] The data to send
 * @param {Function} [cb] Callback
 * @private
 */
function sendAfterClose(websocket, data, cb) {
  if (data) {
    const length = isBlob(data) ? data.size : toBuffer(data).length;

    //
    // The `_bufferedAmount` property is used only when the peer is a client and
    // the opening handshake fails. Under these circumstances, in fact, the
    // `setSocket()` method is not called, so the `_socket` and `_sender`
    // properties are set to `null`.
    //
    if (websocket._socket) websocket._sender._bufferedBytes += length;
    else websocket._bufferedAmount += length;
  }

  if (cb) {
    const err = new Error(
      `WebSocket is not open: readyState ${websocket.readyState} ` +
        `(${readyStates[websocket.readyState]})`
    );
    process.nextTick(cb, err);
  }
}

/**
 * The listener of the `Receiver` `'conclude'` event.
 *
 * @param {Number} code The status code
 * @param {Buffer} reason The reason for closing
 * @private
 */
function receiverOnConclude(code, reason) {
  const websocket = this[kWebSocket];

  websocket._closeFrameReceived = true;
  websocket._closeMessage = reason;
  websocket._closeCode = code;

  if (websocket._socket[kWebSocket] === undefined) return;

  websocket._socket.removeListener('data', socketOnData);
  process.nextTick(resume, websocket._socket);

  if (code === 1005) websocket.close();
  else websocket.close(code, reason);
}

/**
 * The listener of the `Receiver` `'drain'` event.
 *
 * @private
 */
function receiverOnDrain() {
  const websocket = this[kWebSocket];

  if (!websocket.isPaused) websocket._socket.resume();
}

/**
 * The listener of the `Receiver` `'error'` event.
 *
 * @param {(RangeError|Error)} err The emitted error
 * @private
 */
function receiverOnError(err) {
  const websocket = this[kWebSocket];

  if (websocket._socket[kWebSocket] !== undefined) {
    websocket._socket.removeListener('data', socketOnData);

    //
    // On Node.js < 14.0.0 the `'error'` event is emitted synchronously. See
    // https://github.com/websockets/ws/issues/1940.
    //
    process.nextTick(resume, websocket._socket);

    websocket.close(err[kStatusCode]);
  }

  if (!websocket._errorEmitted) {
    websocket._errorEmitted = true;
    websocket.emit('error', err);
  }
}

/**
 * The listener of the `Receiver` `'finish'` event.
 *
 * @private
 */
function receiverOnFinish() {
  this[kWebSocket].emitClose();
}

/**
 * The listener of the `Receiver` `'message'` event.
 *
 * @param {Buffer|ArrayBuffer|Buffer[])} data The message
 * @param {Boolean} isBinary Specifies whether the message is binary or not
 * @private
 */
function receiverOnMessage(data, isBinary) {
  this[kWebSocket].emit('message', data, isBinary);
}

/**
 * The listener of the `Receiver` `'ping'` event.
 *
 * @param {Buffer} data The data included in the ping frame
 * @private
 */
function receiverOnPing(data) {
  const websocket = this[kWebSocket];

  if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
  websocket.emit('ping', data);
}

/**
 * The listener of the `Receiver` `'pong'` event.
 *
 * @param {Buffer} data The data included in the pong frame
 * @private
 */
function receiverOnPong(data) {
  this[kWebSocket].emit('pong', data);
}

/**
 * Resume a readable stream
 *
 * @param {Readable} stream The readable stream
 * @private
 */
function resume(stream) {
  stream.resume();
}

/**
 * The `Sender` error event handler.
 *
 * @param {Error} The error
 * @private
 */
function senderOnError(err) {
  const websocket = this[kWebSocket];

  if (websocket.readyState === WebSocket.CLOSED) return;
  if (websocket.readyState === WebSocket.OPEN) {
    websocket._readyState = WebSocket.CLOSING;
    setCloseTimer(websocket);
  }

  //
  // `socket.end()` is used instead of `socket.destroy()` to allow the other
  // peer to finish sending queued data. There is no need to set a timer here
  // because `CLOSING` means that it is already set or not needed.
  //
  this._socket.end();

  if (!websocket._errorEmitted) {
    websocket._errorEmitted = true;
    websocket.emit('error', err);
  }
}

/**
 * Set a timer to destroy the underlying raw socket of a WebSocket.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @private
 */
function setCloseTimer(websocket) {
  websocket._closeTimer = setTimeout(
    websocket._socket.destroy.bind(websocket._socket),
    websocket._closeTimeout
  );
}

/**
 * The listener of the socket `'close'` event.
 *
 * @private
 */
function socketOnClose() {
  const websocket = this[kWebSocket];

  this.removeListener('close', socketOnClose);
  this.removeListener('data', socketOnData);
  this.removeListener('end', socketOnEnd);

  websocket._readyState = WebSocket.CLOSING;

  //
  // The close frame might not have been received or the `'end'` event emitted,
  // for example, if the socket was destroyed due to an error. Ensure that the
  // `receiver` stream is closed after writing any remaining buffered data to
  // it. If the readable side of the socket is in flowing mode then there is no
  // buffered data as everything has been already written. If instead, the
  // socket is paused, any possible buffered data will be read as a single
  // chunk.
  //
  if (
    !this._readableState.endEmitted &&
    !websocket._closeFrameReceived &&
    !websocket._receiver._writableState.errorEmitted &&
    this._readableState.length !== 0
  ) {
    const chunk = this.read(this._readableState.length);

    websocket._receiver.write(chunk);
  }

  websocket._receiver.end();

  this[kWebSocket] = undefined;

  clearTimeout(websocket._closeTimer);

  if (
    websocket._receiver._writableState.finished ||
    websocket._receiver._writableState.errorEmitted
  ) {
    websocket.emitClose();
  } else {
    websocket._receiver.on('error', receiverOnFinish);
    websocket._receiver.on('finish', receiverOnFinish);
  }
}

/**
 * The listener of the socket `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function socketOnData(chunk) {
  if (!this[kWebSocket]._receiver.write(chunk)) {
    this.pause();
  }
}

/**
 * The listener of the socket `'end'` event.
 *
 * @private
 */
function socketOnEnd() {
  const websocket = this[kWebSocket];

  websocket._readyState = WebSocket.CLOSING;
  websocket._receiver.end();
  this.end();
}

/**
 * The listener of the socket `'error'` event.
 *
 * @private
 */
function socketOnError() {
  const websocket = this[kWebSocket];

  this.removeListener('error', socketOnError);
  this.on('error', NOOP);

  if (websocket) {
    websocket._readyState = WebSocket.CLOSING;
    this.destroy();
  }
}


/***/ },

/***/ "electron-store"
/*!*********************************!*\
  !*** external "electron-store" ***!
  \*********************************/
(module) {

module.exports = require("electron-store");

/***/ },

/***/ "buffer"
/*!*************************!*\
  !*** external "buffer" ***!
  \*************************/
(module) {

module.exports = require("buffer");

/***/ },

/***/ "child_process"
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
(module) {

module.exports = require("child_process");

/***/ },

/***/ "crypto"
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
(module) {

module.exports = require("crypto");

/***/ },

/***/ "electron"
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
(module) {

module.exports = require("electron");

/***/ },

/***/ "events"
/*!*************************!*\
  !*** external "events" ***!
  \*************************/
(module) {

module.exports = require("events");

/***/ },

/***/ "fs"
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
(module) {

module.exports = require("fs");

/***/ },

/***/ "http"
/*!***********************!*\
  !*** external "http" ***!
  \***********************/
(module) {

module.exports = require("http");

/***/ },

/***/ "https"
/*!************************!*\
  !*** external "https" ***!
  \************************/
(module) {

module.exports = require("https");

/***/ },

/***/ "net"
/*!**********************!*\
  !*** external "net" ***!
  \**********************/
(module) {

module.exports = require("net");

/***/ },

/***/ "node:buffer"
/*!******************************!*\
  !*** external "node:buffer" ***!
  \******************************/
(module) {

module.exports = require("node:buffer");

/***/ },

/***/ "os"
/*!*********************!*\
  !*** external "os" ***!
  \*********************/
(module) {

module.exports = require("os");

/***/ },

/***/ "path"
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
(module) {

module.exports = require("path");

/***/ },

/***/ "stream"
/*!*************************!*\
  !*** external "stream" ***!
  \*************************/
(module) {

module.exports = require("stream");

/***/ },

/***/ "tls"
/*!**********************!*\
  !*** external "tls" ***!
  \**********************/
(module) {

module.exports = require("tls");

/***/ },

/***/ "url"
/*!**********************!*\
  !*** external "url" ***!
  \**********************/
(module) {

module.exports = require("url");

/***/ },

/***/ "zlib"
/*!***********************!*\
  !*** external "zlib" ***!
  \***********************/
(module) {

module.exports = require("zlib");

/***/ },

/***/ "./node_modules/openai/_vendor/partial-json-parser/parser.js"
/*!*******************************************************************!*\
  !*** ./node_modules/openai/_vendor/partial-json-parser/parser.js ***!
  \*******************************************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MalformedJSON = exports.PartialJSON = exports.partialParse = void 0;
const STR = 0b000000001;
const NUM = 0b000000010;
const ARR = 0b000000100;
const OBJ = 0b000001000;
const NULL = 0b000010000;
const BOOL = 0b000100000;
const NAN = 0b001000000;
const INFINITY = 0b010000000;
const MINUS_INFINITY = 0b100000000;
const INF = INFINITY | MINUS_INFINITY;
const SPECIAL = NULL | BOOL | INF | NAN;
const ATOM = STR | NUM | SPECIAL;
const COLLECTION = ARR | OBJ;
const ALL = ATOM | COLLECTION;
const Allow = {
    STR,
    NUM,
    ARR,
    OBJ,
    NULL,
    BOOL,
    NAN,
    INFINITY,
    MINUS_INFINITY,
    INF,
    SPECIAL,
    ATOM,
    COLLECTION,
    ALL,
};
// The JSON string segment was unable to be parsed completely
class PartialJSON extends Error {
}
exports.PartialJSON = PartialJSON;
class MalformedJSON extends Error {
}
exports.MalformedJSON = MalformedJSON;
/**
 * Parse incomplete JSON
 * @param {string} jsonString Partial JSON to be parsed
 * @param {number} allowPartial Specify what types are allowed to be partial, see {@link Allow} for details
 * @returns The parsed JSON
 * @throws {PartialJSON} If the JSON is incomplete (related to the `allow` parameter)
 * @throws {MalformedJSON} If the JSON is malformed
 */
function parseJSON(jsonString, allowPartial = Allow.ALL) {
    if (typeof jsonString !== 'string') {
        throw new TypeError(`expecting str, got ${typeof jsonString}`);
    }
    if (!jsonString.trim()) {
        throw new Error(`${jsonString} is empty`);
    }
    return _parseJSON(jsonString.trim(), allowPartial);
}
const _parseJSON = (jsonString, allow) => {
    const length = jsonString.length;
    let index = 0;
    const markPartialJSON = (msg) => {
        throw new PartialJSON(`${msg} at position ${index}`);
    };
    const throwMalformedError = (msg) => {
        throw new MalformedJSON(`${msg} at position ${index}`);
    };
    const parseAny = () => {
        skipBlank();
        if (index >= length)
            markPartialJSON('Unexpected end of input');
        if (jsonString[index] === '"')
            return parseStr();
        if (jsonString[index] === '{')
            return parseObj();
        if (jsonString[index] === '[')
            return parseArr();
        if (jsonString.substring(index, index + 4) === 'null' ||
            (Allow.NULL & allow && length - index < 4 && 'null'.startsWith(jsonString.substring(index)))) {
            index += 4;
            return null;
        }
        if (jsonString.substring(index, index + 4) === 'true' ||
            (Allow.BOOL & allow && length - index < 4 && 'true'.startsWith(jsonString.substring(index)))) {
            index += 4;
            return true;
        }
        if (jsonString.substring(index, index + 5) === 'false' ||
            (Allow.BOOL & allow && length - index < 5 && 'false'.startsWith(jsonString.substring(index)))) {
            index += 5;
            return false;
        }
        if (jsonString.substring(index, index + 8) === 'Infinity' ||
            (Allow.INFINITY & allow && length - index < 8 && 'Infinity'.startsWith(jsonString.substring(index)))) {
            index += 8;
            return Infinity;
        }
        if (jsonString.substring(index, index + 9) === '-Infinity' ||
            (Allow.MINUS_INFINITY & allow &&
                1 < length - index &&
                length - index < 9 &&
                '-Infinity'.startsWith(jsonString.substring(index)))) {
            index += 9;
            return -Infinity;
        }
        if (jsonString.substring(index, index + 3) === 'NaN' ||
            (Allow.NAN & allow && length - index < 3 && 'NaN'.startsWith(jsonString.substring(index)))) {
            index += 3;
            return NaN;
        }
        return parseNum();
    };
    const parseStr = () => {
        const start = index;
        let escape = false;
        index++; // skip initial quote
        while (index < length && (jsonString[index] !== '"' || (escape && jsonString[index - 1] === '\\'))) {
            escape = jsonString[index] === '\\' ? !escape : false;
            index++;
        }
        if (jsonString.charAt(index) == '"') {
            try {
                return JSON.parse(jsonString.substring(start, ++index - Number(escape)));
            }
            catch (e) {
                throwMalformedError(String(e));
            }
        }
        else if (Allow.STR & allow) {
            try {
                return JSON.parse(jsonString.substring(start, index - Number(escape)) + '"');
            }
            catch (e) {
                // SyntaxError: Invalid escape sequence
                return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf('\\')) + '"');
            }
        }
        markPartialJSON('Unterminated string literal');
    };
    const parseObj = () => {
        index++; // skip initial brace
        skipBlank();
        const obj = {};
        try {
            while (jsonString[index] !== '}') {
                skipBlank();
                if (index >= length && Allow.OBJ & allow)
                    return obj;
                const key = parseStr();
                skipBlank();
                index++; // skip colon
                try {
                    const value = parseAny();
                    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
                }
                catch (e) {
                    if (Allow.OBJ & allow)
                        return obj;
                    else
                        throw e;
                }
                skipBlank();
                if (jsonString[index] === ',')
                    index++; // skip comma
            }
        }
        catch (e) {
            if (Allow.OBJ & allow)
                return obj;
            else
                markPartialJSON("Expected '}' at end of object");
        }
        index++; // skip final brace
        return obj;
    };
    const parseArr = () => {
        index++; // skip initial bracket
        const arr = [];
        try {
            while (jsonString[index] !== ']') {
                arr.push(parseAny());
                skipBlank();
                if (jsonString[index] === ',') {
                    index++; // skip comma
                }
            }
        }
        catch (e) {
            if (Allow.ARR & allow) {
                return arr;
            }
            markPartialJSON("Expected ']' at end of array");
        }
        index++; // skip final bracket
        return arr;
    };
    const parseNum = () => {
        if (index === 0) {
            if (jsonString === '-' && Allow.NUM & allow)
                markPartialJSON("Not sure what '-' is");
            try {
                return JSON.parse(jsonString);
            }
            catch (e) {
                if (Allow.NUM & allow) {
                    try {
                        if ('.' === jsonString[jsonString.length - 1])
                            return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf('.')));
                        return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf('e')));
                    }
                    catch (e) { }
                }
                throwMalformedError(String(e));
            }
        }
        const start = index;
        if (jsonString[index] === '-')
            index++;
        while (jsonString[index] && !',]}'.includes(jsonString[index]))
            index++;
        if (index == length && !(Allow.NUM & allow))
            markPartialJSON('Unterminated number literal');
        try {
            return JSON.parse(jsonString.substring(start, index));
        }
        catch (e) {
            if (jsonString.substring(start, index) === '-' && Allow.NUM & allow)
                markPartialJSON("Not sure what '-' is");
            try {
                return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf('e')));
            }
            catch (e) {
                throwMalformedError(String(e));
            }
        }
    };
    const skipBlank = () => {
        while (index < length && ' \n\r\t'.includes(jsonString[index])) {
            index++;
        }
    };
    return parseAny();
};
// using this function with malformed JSON is undefined behavior
const partialParse = (input) => parseJSON(input, Allow.ALL ^ Allow.NUM);
exports.partialParse = partialParse;
//# sourceMappingURL=parser.js.map

/***/ },

/***/ "./node_modules/openai/azure.js"
/*!**************************************!*\
  !*** ./node_modules/openai/azure.js ***!
  \**************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AzureOpenAI = void 0;
const tslib_1 = __webpack_require__(/*! ./internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const headers_1 = __webpack_require__(/*! ./internal/headers.js */ "./node_modules/openai/internal/headers.js");
const Errors = tslib_1.__importStar(__webpack_require__(/*! ./error.js */ "./node_modules/openai/error.js"));
const utils_1 = __webpack_require__(/*! ./internal/utils.js */ "./node_modules/openai/internal/utils.js");
const client_1 = __webpack_require__(/*! ./client.js */ "./node_modules/openai/client.js");
/** API Client for interfacing with the Azure OpenAI API. */
class AzureOpenAI extends client_1.OpenAI {
    /**
     * API Client for interfacing with the Azure OpenAI API.
     *
     * @param {string | undefined} [opts.apiVersion=process.env['OPENAI_API_VERSION'] ?? undefined]
     * @param {string | undefined} [opts.endpoint=process.env['AZURE_OPENAI_ENDPOINT'] ?? undefined] - Your Azure endpoint, including the resource, e.g. `https://example-resource.azure.openai.com/`
     * @param {string | undefined} [opts.apiKey=process.env['AZURE_OPENAI_API_KEY'] ?? undefined]
     * @param {string | undefined} opts.deployment - A model deployment, if given, sets the base client URL to include `/deployments/{deployment}`.
     * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
     * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL']] - Sets the base URL for the API, e.g. `https://example-resource.azure.openai.com/openai/`.
     * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
     * @param {number} [opts.httpAgent] - An HTTP agent used to manage HTTP(s) connections.
     * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
     * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
     * @param {Headers} opts.defaultHeaders - Default headers to include with every request to the API.
     * @param {DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
     * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
     */
    constructor({ baseURL = (0, utils_1.readEnv)('OPENAI_BASE_URL'), apiKey = (0, utils_1.readEnv)('AZURE_OPENAI_API_KEY'), apiVersion = (0, utils_1.readEnv)('OPENAI_API_VERSION'), endpoint, deployment, azureADTokenProvider, dangerouslyAllowBrowser, ...opts } = {}) {
        if (!apiVersion) {
            throw new Errors.OpenAIError("The OPENAI_API_VERSION environment variable is missing or empty; either provide it, or instantiate the AzureOpenAI client with an apiVersion option, like new AzureOpenAI({ apiVersion: 'My API Version' }).");
        }
        if (typeof azureADTokenProvider === 'function') {
            dangerouslyAllowBrowser = true;
        }
        if (!azureADTokenProvider && !apiKey) {
            throw new Errors.OpenAIError('Missing credentials. Please pass one of `apiKey` and `azureADTokenProvider`, or set the `AZURE_OPENAI_API_KEY` environment variable.');
        }
        if (azureADTokenProvider && apiKey) {
            throw new Errors.OpenAIError('The `apiKey` and `azureADTokenProvider` arguments are mutually exclusive; only one can be passed at a time.');
        }
        opts.defaultQuery = { ...opts.defaultQuery, 'api-version': apiVersion };
        if (!baseURL) {
            if (!endpoint) {
                endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
            }
            if (!endpoint) {
                throw new Errors.OpenAIError('Must provide one of the `baseURL` or `endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable');
            }
            baseURL = `${endpoint}/openai`;
        }
        else {
            if (endpoint) {
                throw new Errors.OpenAIError('baseURL and endpoint are mutually exclusive');
            }
        }
        super({
            apiKey: azureADTokenProvider ?? apiKey,
            baseURL,
            ...opts,
            ...(dangerouslyAllowBrowser !== undefined ? { dangerouslyAllowBrowser } : {}),
        });
        this.apiVersion = '';
        this.apiVersion = apiVersion;
        this.deploymentName = deployment;
    }
    async buildRequest(options, props = {}) {
        if (_deployments_endpoints.has(options.path) && options.method === 'post' && options.body !== undefined) {
            if (!(0, utils_1.isObj)(options.body)) {
                throw new Error('Expected request body to be an object');
            }
            const model = this.deploymentName || options.body['model'] || options.__metadata?.['model'];
            if (model !== undefined && !this.baseURL.includes('/deployments')) {
                options.path = `/deployments/${model}${options.path}`;
            }
        }
        return super.buildRequest(options, props);
    }
    async authHeaders(opts) {
        if (typeof this._options.apiKey === 'string') {
            return (0, headers_1.buildHeaders)([{ 'api-key': this.apiKey }]);
        }
        return super.authHeaders(opts);
    }
}
exports.AzureOpenAI = AzureOpenAI;
const _deployments_endpoints = new Set([
    '/completions',
    '/chat/completions',
    '/embeddings',
    '/audio/transcriptions',
    '/audio/translations',
    '/audio/speech',
    '/images/generations',
    '/batches',
    '/images/edits',
]);
//# sourceMappingURL=azure.js.map

/***/ },

/***/ "./node_modules/openai/client.js"
/*!***************************************!*\
  !*** ./node_modules/openai/client.js ***!
  \***************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
var _OpenAI_instances, _a, _OpenAI_encoder, _OpenAI_baseURLOverridden;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OpenAI = void 0;
const tslib_1 = __webpack_require__(/*! ./internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const uuid_1 = __webpack_require__(/*! ./internal/utils/uuid.js */ "./node_modules/openai/internal/utils/uuid.js");
const values_1 = __webpack_require__(/*! ./internal/utils/values.js */ "./node_modules/openai/internal/utils/values.js");
const sleep_1 = __webpack_require__(/*! ./internal/utils/sleep.js */ "./node_modules/openai/internal/utils/sleep.js");
const errors_1 = __webpack_require__(/*! ./internal/errors.js */ "./node_modules/openai/internal/errors.js");
const detect_platform_1 = __webpack_require__(/*! ./internal/detect-platform.js */ "./node_modules/openai/internal/detect-platform.js");
const Shims = tslib_1.__importStar(__webpack_require__(/*! ./internal/shims.js */ "./node_modules/openai/internal/shims.js"));
const Opts = tslib_1.__importStar(__webpack_require__(/*! ./internal/request-options.js */ "./node_modules/openai/internal/request-options.js"));
const qs = tslib_1.__importStar(__webpack_require__(/*! ./internal/qs/index.js */ "./node_modules/openai/internal/qs/index.js"));
const version_1 = __webpack_require__(/*! ./version.js */ "./node_modules/openai/version.js");
const Errors = tslib_1.__importStar(__webpack_require__(/*! ./core/error.js */ "./node_modules/openai/core/error.js"));
const Pagination = tslib_1.__importStar(__webpack_require__(/*! ./core/pagination.js */ "./node_modules/openai/core/pagination.js"));
const Uploads = tslib_1.__importStar(__webpack_require__(/*! ./core/uploads.js */ "./node_modules/openai/core/uploads.js"));
const API = tslib_1.__importStar(__webpack_require__(/*! ./resources/index.js */ "./node_modules/openai/resources/index.js"));
const api_promise_1 = __webpack_require__(/*! ./core/api-promise.js */ "./node_modules/openai/core/api-promise.js");
const batches_1 = __webpack_require__(/*! ./resources/batches.js */ "./node_modules/openai/resources/batches.js");
const completions_1 = __webpack_require__(/*! ./resources/completions.js */ "./node_modules/openai/resources/completions.js");
const embeddings_1 = __webpack_require__(/*! ./resources/embeddings.js */ "./node_modules/openai/resources/embeddings.js");
const files_1 = __webpack_require__(/*! ./resources/files.js */ "./node_modules/openai/resources/files.js");
const images_1 = __webpack_require__(/*! ./resources/images.js */ "./node_modules/openai/resources/images.js");
const models_1 = __webpack_require__(/*! ./resources/models.js */ "./node_modules/openai/resources/models.js");
const moderations_1 = __webpack_require__(/*! ./resources/moderations.js */ "./node_modules/openai/resources/moderations.js");
const videos_1 = __webpack_require__(/*! ./resources/videos.js */ "./node_modules/openai/resources/videos.js");
const webhooks_1 = __webpack_require__(/*! ./resources/webhooks.js */ "./node_modules/openai/resources/webhooks.js");
const audio_1 = __webpack_require__(/*! ./resources/audio/audio.js */ "./node_modules/openai/resources/audio/audio.js");
const beta_1 = __webpack_require__(/*! ./resources/beta/beta.js */ "./node_modules/openai/resources/beta/beta.js");
const chat_1 = __webpack_require__(/*! ./resources/chat/chat.js */ "./node_modules/openai/resources/chat/chat.js");
const containers_1 = __webpack_require__(/*! ./resources/containers/containers.js */ "./node_modules/openai/resources/containers/containers.js");
const conversations_1 = __webpack_require__(/*! ./resources/conversations/conversations.js */ "./node_modules/openai/resources/conversations/conversations.js");
const evals_1 = __webpack_require__(/*! ./resources/evals/evals.js */ "./node_modules/openai/resources/evals/evals.js");
const fine_tuning_1 = __webpack_require__(/*! ./resources/fine-tuning/fine-tuning.js */ "./node_modules/openai/resources/fine-tuning/fine-tuning.js");
const graders_1 = __webpack_require__(/*! ./resources/graders/graders.js */ "./node_modules/openai/resources/graders/graders.js");
const realtime_1 = __webpack_require__(/*! ./resources/realtime/realtime.js */ "./node_modules/openai/resources/realtime/realtime.js");
const responses_1 = __webpack_require__(/*! ./resources/responses/responses.js */ "./node_modules/openai/resources/responses/responses.js");
const skills_1 = __webpack_require__(/*! ./resources/skills/skills.js */ "./node_modules/openai/resources/skills/skills.js");
const uploads_1 = __webpack_require__(/*! ./resources/uploads/uploads.js */ "./node_modules/openai/resources/uploads/uploads.js");
const vector_stores_1 = __webpack_require__(/*! ./resources/vector-stores/vector-stores.js */ "./node_modules/openai/resources/vector-stores/vector-stores.js");
const detect_platform_2 = __webpack_require__(/*! ./internal/detect-platform.js */ "./node_modules/openai/internal/detect-platform.js");
const headers_1 = __webpack_require__(/*! ./internal/headers.js */ "./node_modules/openai/internal/headers.js");
const env_1 = __webpack_require__(/*! ./internal/utils/env.js */ "./node_modules/openai/internal/utils/env.js");
const log_1 = __webpack_require__(/*! ./internal/utils/log.js */ "./node_modules/openai/internal/utils/log.js");
const values_2 = __webpack_require__(/*! ./internal/utils/values.js */ "./node_modules/openai/internal/utils/values.js");
/**
 * API Client for interfacing with the OpenAI API.
 */
class OpenAI {
    /**
     * API Client for interfacing with the OpenAI API.
     *
     * @param {string | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? undefined]
     * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
     * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
     * @param {string | null | undefined} [opts.webhookSecret=process.env['OPENAI_WEBHOOK_SECRET'] ?? null]
     * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
     * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
     * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
     * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
     * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
     * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
     * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
     * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
     */
    constructor({ baseURL = (0, env_1.readEnv)('OPENAI_BASE_URL'), apiKey = (0, env_1.readEnv)('OPENAI_API_KEY'), organization = (0, env_1.readEnv)('OPENAI_ORG_ID') ?? null, project = (0, env_1.readEnv)('OPENAI_PROJECT_ID') ?? null, webhookSecret = (0, env_1.readEnv)('OPENAI_WEBHOOK_SECRET') ?? null, ...opts } = {}) {
        _OpenAI_instances.add(this);
        _OpenAI_encoder.set(this, void 0);
        this.completions = new API.Completions(this);
        this.chat = new API.Chat(this);
        this.embeddings = new API.Embeddings(this);
        this.files = new API.Files(this);
        this.images = new API.Images(this);
        this.audio = new API.Audio(this);
        this.moderations = new API.Moderations(this);
        this.models = new API.Models(this);
        this.fineTuning = new API.FineTuning(this);
        this.graders = new API.Graders(this);
        this.vectorStores = new API.VectorStores(this);
        this.webhooks = new API.Webhooks(this);
        this.beta = new API.Beta(this);
        this.batches = new API.Batches(this);
        this.uploads = new API.Uploads(this);
        this.responses = new API.Responses(this);
        this.realtime = new API.Realtime(this);
        this.conversations = new API.Conversations(this);
        this.evals = new API.Evals(this);
        this.containers = new API.Containers(this);
        this.skills = new API.Skills(this);
        this.videos = new API.Videos(this);
        if (apiKey === undefined) {
            throw new Errors.OpenAIError('Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.');
        }
        const options = {
            apiKey,
            organization,
            project,
            webhookSecret,
            ...opts,
            baseURL: baseURL || `https://api.openai.com/v1`,
        };
        if (!options.dangerouslyAllowBrowser && (0, detect_platform_2.isRunningInBrowser)()) {
            throw new Errors.OpenAIError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
        }
        this.baseURL = options.baseURL;
        this.timeout = options.timeout ?? _a.DEFAULT_TIMEOUT /* 10 minutes */;
        this.logger = options.logger ?? console;
        const defaultLogLevel = 'warn';
        // Set default logLevel early so that we can log a warning in parseLogLevel.
        this.logLevel = defaultLogLevel;
        this.logLevel =
            (0, log_1.parseLogLevel)(options.logLevel, 'ClientOptions.logLevel', this) ??
                (0, log_1.parseLogLevel)((0, env_1.readEnv)('OPENAI_LOG'), "process.env['OPENAI_LOG']", this) ??
                defaultLogLevel;
        this.fetchOptions = options.fetchOptions;
        this.maxRetries = options.maxRetries ?? 2;
        this.fetch = options.fetch ?? Shims.getDefaultFetch();
        tslib_1.__classPrivateFieldSet(this, _OpenAI_encoder, Opts.FallbackEncoder, "f");
        this._options = options;
        this.apiKey = typeof apiKey === 'string' ? apiKey : 'Missing Key';
        this.organization = organization;
        this.project = project;
        this.webhookSecret = webhookSecret;
    }
    /**
     * Create a new client instance re-using the same options given to the current client with optional overriding.
     */
    withOptions(options) {
        const client = new this.constructor({
            ...this._options,
            baseURL: this.baseURL,
            maxRetries: this.maxRetries,
            timeout: this.timeout,
            logger: this.logger,
            logLevel: this.logLevel,
            fetch: this.fetch,
            fetchOptions: this.fetchOptions,
            apiKey: this.apiKey,
            organization: this.organization,
            project: this.project,
            webhookSecret: this.webhookSecret,
            ...options,
        });
        return client;
    }
    defaultQuery() {
        return this._options.defaultQuery;
    }
    validateHeaders({ values, nulls }) {
        return;
    }
    async authHeaders(opts) {
        return (0, headers_1.buildHeaders)([{ Authorization: `Bearer ${this.apiKey}` }]);
    }
    stringifyQuery(query) {
        return qs.stringify(query, { arrayFormat: 'brackets' });
    }
    getUserAgent() {
        return `${this.constructor.name}/JS ${version_1.VERSION}`;
    }
    defaultIdempotencyKey() {
        return `stainless-node-retry-${(0, uuid_1.uuid4)()}`;
    }
    makeStatusError(status, error, message, headers) {
        return Errors.APIError.generate(status, error, message, headers);
    }
    async _callApiKey() {
        const apiKey = this._options.apiKey;
        if (typeof apiKey !== 'function')
            return false;
        let token;
        try {
            token = await apiKey();
        }
        catch (err) {
            if (err instanceof Errors.OpenAIError)
                throw err;
            throw new Errors.OpenAIError(`Failed to get token from 'apiKey' function: ${err.message}`, 
            // @ts-ignore
            { cause: err });
        }
        if (typeof token !== 'string' || !token) {
            throw new Errors.OpenAIError(`Expected 'apiKey' function argument to return a string but it returned ${token}`);
        }
        this.apiKey = token;
        return true;
    }
    buildURL(path, query, defaultBaseURL) {
        const baseURL = (!tslib_1.__classPrivateFieldGet(this, _OpenAI_instances, "m", _OpenAI_baseURLOverridden).call(this) && defaultBaseURL) || this.baseURL;
        const url = (0, values_1.isAbsoluteURL)(path) ?
            new URL(path)
            : new URL(baseURL + (baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));
        const defaultQuery = this.defaultQuery();
        if (!(0, values_2.isEmptyObj)(defaultQuery)) {
            query = { ...defaultQuery, ...query };
        }
        if (typeof query === 'object' && query && !Array.isArray(query)) {
            url.search = this.stringifyQuery(query);
        }
        return url.toString();
    }
    /**
     * Used as a callback for mutating the given `FinalRequestOptions` object.
     */
    async prepareOptions(options) {
        await this._callApiKey();
    }
    /**
     * Used as a callback for mutating the given `RequestInit` object.
     *
     * This is useful for cases where you want to add certain headers based off of
     * the request properties, e.g. `method` or `url`.
     */
    async prepareRequest(request, { url, options }) { }
    get(path, opts) {
        return this.methodRequest('get', path, opts);
    }
    post(path, opts) {
        return this.methodRequest('post', path, opts);
    }
    patch(path, opts) {
        return this.methodRequest('patch', path, opts);
    }
    put(path, opts) {
        return this.methodRequest('put', path, opts);
    }
    delete(path, opts) {
        return this.methodRequest('delete', path, opts);
    }
    methodRequest(method, path, opts) {
        return this.request(Promise.resolve(opts).then((opts) => {
            return { method, path, ...opts };
        }));
    }
    request(options, remainingRetries = null) {
        return new api_promise_1.APIPromise(this, this.makeRequest(options, remainingRetries, undefined));
    }
    async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
        const options = await optionsInput;
        const maxRetries = options.maxRetries ?? this.maxRetries;
        if (retriesRemaining == null) {
            retriesRemaining = maxRetries;
        }
        await this.prepareOptions(options);
        const { req, url, timeout } = await this.buildRequest(options, {
            retryCount: maxRetries - retriesRemaining,
        });
        await this.prepareRequest(req, { url, options });
        /** Not an API request ID, just for correlating local log entries. */
        const requestLogID = 'log_' + ((Math.random() * (1 << 24)) | 0).toString(16).padStart(6, '0');
        const retryLogStr = retryOfRequestLogID === undefined ? '' : `, retryOf: ${retryOfRequestLogID}`;
        const startTime = Date.now();
        (0, log_1.loggerFor)(this).debug(`[${requestLogID}] sending request`, (0, log_1.formatRequestDetails)({
            retryOfRequestLogID,
            method: options.method,
            url,
            options,
            headers: req.headers,
        }));
        if (options.signal?.aborted) {
            throw new Errors.APIUserAbortError();
        }
        const controller = new AbortController();
        const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(errors_1.castToError);
        const headersTime = Date.now();
        if (response instanceof globalThis.Error) {
            const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
            if (options.signal?.aborted) {
                throw new Errors.APIUserAbortError();
            }
            // detect native connection timeout errors
            // deno throws "TypeError: error sending request for url (https://example/): client error (Connect): tcp connect error: Operation timed out (os error 60): Operation timed out (os error 60)"
            // undici throws "TypeError: fetch failed" with cause "ConnectTimeoutError: Connect Timeout Error (attempted address: example:443, timeout: 1ms)"
            // others do not provide enough information to distinguish timeouts from other connection errors
            const isTimeout = (0, errors_1.isAbortError)(response) ||
                /timed? ?out/i.test(String(response) + ('cause' in response ? String(response.cause) : ''));
            if (retriesRemaining) {
                (0, log_1.loggerFor)(this).info(`[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} - ${retryMessage}`);
                (0, log_1.loggerFor)(this).debug(`[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} (${retryMessage})`, (0, log_1.formatRequestDetails)({
                    retryOfRequestLogID,
                    url,
                    durationMs: headersTime - startTime,
                    message: response.message,
                }));
                return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
            }
            (0, log_1.loggerFor)(this).info(`[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} - error; no more retries left`);
            (0, log_1.loggerFor)(this).debug(`[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} (error; no more retries left)`, (0, log_1.formatRequestDetails)({
                retryOfRequestLogID,
                url,
                durationMs: headersTime - startTime,
                message: response.message,
            }));
            if (isTimeout) {
                throw new Errors.APIConnectionTimeoutError();
            }
            throw new Errors.APIConnectionError({ cause: response });
        }
        const specialHeaders = [...response.headers.entries()]
            .filter(([name]) => name === 'x-request-id')
            .map(([name, value]) => ', ' + name + ': ' + JSON.stringify(value))
            .join('');
        const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? 'succeeded' : 'failed'} with status ${response.status} in ${headersTime - startTime}ms`;
        if (!response.ok) {
            const shouldRetry = await this.shouldRetry(response);
            if (retriesRemaining && shouldRetry) {
                const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
                // We don't need the body of this response.
                await Shims.CancelReadableStream(response.body);
                (0, log_1.loggerFor)(this).info(`${responseInfo} - ${retryMessage}`);
                (0, log_1.loggerFor)(this).debug(`[${requestLogID}] response error (${retryMessage})`, (0, log_1.formatRequestDetails)({
                    retryOfRequestLogID,
                    url: response.url,
                    status: response.status,
                    headers: response.headers,
                    durationMs: headersTime - startTime,
                }));
                return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
            }
            const retryMessage = shouldRetry ? `error; no more retries left` : `error; not retryable`;
            (0, log_1.loggerFor)(this).info(`${responseInfo} - ${retryMessage}`);
            const errText = await response.text().catch((err) => (0, errors_1.castToError)(err).message);
            const errJSON = (0, values_1.safeJSON)(errText);
            const errMessage = errJSON ? undefined : errText;
            (0, log_1.loggerFor)(this).debug(`[${requestLogID}] response error (${retryMessage})`, (0, log_1.formatRequestDetails)({
                retryOfRequestLogID,
                url: response.url,
                status: response.status,
                headers: response.headers,
                message: errMessage,
                durationMs: Date.now() - startTime,
            }));
            const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
            throw err;
        }
        (0, log_1.loggerFor)(this).info(responseInfo);
        (0, log_1.loggerFor)(this).debug(`[${requestLogID}] response start`, (0, log_1.formatRequestDetails)({
            retryOfRequestLogID,
            url: response.url,
            status: response.status,
            headers: response.headers,
            durationMs: headersTime - startTime,
        }));
        return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
    }
    getAPIList(path, Page, opts) {
        return this.requestAPIList(Page, opts && 'then' in opts ?
            opts.then((opts) => ({ method: 'get', path, ...opts }))
            : { method: 'get', path, ...opts });
    }
    requestAPIList(Page, options) {
        const request = this.makeRequest(options, null, undefined);
        return new Pagination.PagePromise(this, request, Page);
    }
    async fetchWithTimeout(url, init, ms, controller) {
        const { signal, method, ...options } = init || {};
        const abort = this._makeAbort(controller);
        if (signal)
            signal.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, ms);
        const isReadableBody = (globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream) ||
            (typeof options.body === 'object' && options.body !== null && Symbol.asyncIterator in options.body);
        const fetchOptions = {
            signal: controller.signal,
            ...(isReadableBody ? { duplex: 'half' } : {}),
            method: 'GET',
            ...options,
        };
        if (method) {
            // Custom methods like 'patch' need to be uppercased
            // See https://github.com/nodejs/undici/issues/2294
            fetchOptions.method = method.toUpperCase();
        }
        try {
            // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
            return await this.fetch.call(undefined, url, fetchOptions);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async shouldRetry(response) {
        // Note this is not a standard header.
        const shouldRetryHeader = response.headers.get('x-should-retry');
        // If the server explicitly says whether or not to retry, obey.
        if (shouldRetryHeader === 'true')
            return true;
        if (shouldRetryHeader === 'false')
            return false;
        // Retry on request timeouts.
        if (response.status === 408)
            return true;
        // Retry on lock timeouts.
        if (response.status === 409)
            return true;
        // Retry on rate limits.
        if (response.status === 429)
            return true;
        // Retry internal errors.
        if (response.status >= 500)
            return true;
        return false;
    }
    async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
        let timeoutMillis;
        // Note the `retry-after-ms` header may not be standard, but is a good idea and we'd like proactive support for it.
        const retryAfterMillisHeader = responseHeaders?.get('retry-after-ms');
        if (retryAfterMillisHeader) {
            const timeoutMs = parseFloat(retryAfterMillisHeader);
            if (!Number.isNaN(timeoutMs)) {
                timeoutMillis = timeoutMs;
            }
        }
        // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
        const retryAfterHeader = responseHeaders?.get('retry-after');
        if (retryAfterHeader && !timeoutMillis) {
            const timeoutSeconds = parseFloat(retryAfterHeader);
            if (!Number.isNaN(timeoutSeconds)) {
                timeoutMillis = timeoutSeconds * 1000;
            }
            else {
                timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
            }
        }
        // If the API asks us to wait a certain amount of time (and it's a reasonable amount),
        // just do what it says, but otherwise calculate a default
        if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1000)) {
            const maxRetries = options.maxRetries ?? this.maxRetries;
            timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
        }
        await (0, sleep_1.sleep)(timeoutMillis);
        return this.makeRequest(options, retriesRemaining - 1, requestLogID);
    }
    calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
        const initialRetryDelay = 0.5;
        const maxRetryDelay = 8.0;
        const numRetries = maxRetries - retriesRemaining;
        // Apply exponential backoff, but not more than the max.
        const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
        // Apply some jitter, take up to at most 25 percent of the retry time.
        const jitter = 1 - Math.random() * 0.25;
        return sleepSeconds * jitter * 1000;
    }
    async buildRequest(inputOptions, { retryCount = 0 } = {}) {
        const options = { ...inputOptions };
        const { method, path, query, defaultBaseURL } = options;
        const url = this.buildURL(path, query, defaultBaseURL);
        if ('timeout' in options)
            (0, values_1.validatePositiveInteger)('timeout', options.timeout);
        options.timeout = options.timeout ?? this.timeout;
        const { bodyHeaders, body } = this.buildBody({ options });
        const reqHeaders = await this.buildHeaders({ options: inputOptions, method, bodyHeaders, retryCount });
        const req = {
            method,
            headers: reqHeaders,
            ...(options.signal && { signal: options.signal }),
            ...(globalThis.ReadableStream &&
                body instanceof globalThis.ReadableStream && { duplex: 'half' }),
            ...(body && { body }),
            ...(this.fetchOptions ?? {}),
            ...(options.fetchOptions ?? {}),
        };
        return { req, url, timeout: options.timeout };
    }
    async buildHeaders({ options, method, bodyHeaders, retryCount, }) {
        let idempotencyHeaders = {};
        if (this.idempotencyHeader && method !== 'get') {
            if (!options.idempotencyKey)
                options.idempotencyKey = this.defaultIdempotencyKey();
            idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
        }
        const headers = (0, headers_1.buildHeaders)([
            idempotencyHeaders,
            {
                Accept: 'application/json',
                'User-Agent': this.getUserAgent(),
                'X-Stainless-Retry-Count': String(retryCount),
                ...(options.timeout ? { 'X-Stainless-Timeout': String(Math.trunc(options.timeout / 1000)) } : {}),
                ...(0, detect_platform_1.getPlatformHeaders)(),
                'OpenAI-Organization': this.organization,
                'OpenAI-Project': this.project,
            },
            await this.authHeaders(options),
            this._options.defaultHeaders,
            bodyHeaders,
            options.headers,
        ]);
        this.validateHeaders(headers);
        return headers.values;
    }
    _makeAbort(controller) {
        // note: we can't just inline this method inside `fetchWithTimeout()` because then the closure
        //       would capture all request options, and cause a memory leak.
        return () => controller.abort();
    }
    buildBody({ options: { body, headers: rawHeaders } }) {
        if (!body) {
            return { bodyHeaders: undefined, body: undefined };
        }
        const headers = (0, headers_1.buildHeaders)([rawHeaders]);
        if (
        // Pass raw type verbatim
        ArrayBuffer.isView(body) ||
            body instanceof ArrayBuffer ||
            body instanceof DataView ||
            (typeof body === 'string' &&
                // Preserve legacy string encoding behavior for now
                headers.values.has('content-type')) ||
            // `Blob` is superset of `File`
            (globalThis.Blob && body instanceof globalThis.Blob) ||
            // `FormData` -> `multipart/form-data`
            body instanceof FormData ||
            // `URLSearchParams` -> `application/x-www-form-urlencoded`
            body instanceof URLSearchParams ||
            // Send chunked stream (each chunk has own `length`)
            (globalThis.ReadableStream && body instanceof globalThis.ReadableStream)) {
            return { bodyHeaders: undefined, body: body };
        }
        else if (typeof body === 'object' &&
            (Symbol.asyncIterator in body ||
                (Symbol.iterator in body && 'next' in body && typeof body.next === 'function'))) {
            return { bodyHeaders: undefined, body: Shims.ReadableStreamFrom(body) };
        }
        else {
            return tslib_1.__classPrivateFieldGet(this, _OpenAI_encoder, "f").call(this, { body, headers });
        }
    }
}
exports.OpenAI = OpenAI;
_a = OpenAI, _OpenAI_encoder = new WeakMap(), _OpenAI_instances = new WeakSet(), _OpenAI_baseURLOverridden = function _OpenAI_baseURLOverridden() {
    return this.baseURL !== 'https://api.openai.com/v1';
};
OpenAI.OpenAI = _a;
OpenAI.DEFAULT_TIMEOUT = 600000; // 10 minutes
OpenAI.OpenAIError = Errors.OpenAIError;
OpenAI.APIError = Errors.APIError;
OpenAI.APIConnectionError = Errors.APIConnectionError;
OpenAI.APIConnectionTimeoutError = Errors.APIConnectionTimeoutError;
OpenAI.APIUserAbortError = Errors.APIUserAbortError;
OpenAI.NotFoundError = Errors.NotFoundError;
OpenAI.ConflictError = Errors.ConflictError;
OpenAI.RateLimitError = Errors.RateLimitError;
OpenAI.BadRequestError = Errors.BadRequestError;
OpenAI.AuthenticationError = Errors.AuthenticationError;
OpenAI.InternalServerError = Errors.InternalServerError;
OpenAI.PermissionDeniedError = Errors.PermissionDeniedError;
OpenAI.UnprocessableEntityError = Errors.UnprocessableEntityError;
OpenAI.InvalidWebhookSignatureError = Errors.InvalidWebhookSignatureError;
OpenAI.toFile = Uploads.toFile;
OpenAI.Completions = completions_1.Completions;
OpenAI.Chat = chat_1.Chat;
OpenAI.Embeddings = embeddings_1.Embeddings;
OpenAI.Files = files_1.Files;
OpenAI.Images = images_1.Images;
OpenAI.Audio = audio_1.Audio;
OpenAI.Moderations = moderations_1.Moderations;
OpenAI.Models = models_1.Models;
OpenAI.FineTuning = fine_tuning_1.FineTuning;
OpenAI.Graders = graders_1.Graders;
OpenAI.VectorStores = vector_stores_1.VectorStores;
OpenAI.Webhooks = webhooks_1.Webhooks;
OpenAI.Beta = beta_1.Beta;
OpenAI.Batches = batches_1.Batches;
OpenAI.Uploads = uploads_1.Uploads;
OpenAI.Responses = responses_1.Responses;
OpenAI.Realtime = realtime_1.Realtime;
OpenAI.Conversations = conversations_1.Conversations;
OpenAI.Evals = evals_1.Evals;
OpenAI.Containers = containers_1.Containers;
OpenAI.Skills = skills_1.Skills;
OpenAI.Videos = videos_1.Videos;
//# sourceMappingURL=client.js.map

/***/ },

/***/ "./node_modules/openai/core/api-promise.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/core/api-promise.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
var _APIPromise_client;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.APIPromise = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const parse_1 = __webpack_require__(/*! ../internal/parse.js */ "./node_modules/openai/internal/parse.js");
/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
class APIPromise extends Promise {
    constructor(client, responsePromise, parseResponse = parse_1.defaultParseResponse) {
        super((resolve) => {
            // this is maybe a bit weird but this has to be a no-op to not implicitly
            // parse the response body; instead .then, .catch, .finally are overridden
            // to parse the response
            resolve(null);
        });
        this.responsePromise = responsePromise;
        this.parseResponse = parseResponse;
        _APIPromise_client.set(this, void 0);
        tslib_1.__classPrivateFieldSet(this, _APIPromise_client, client, "f");
    }
    _thenUnwrap(transform) {
        return new APIPromise(tslib_1.__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => (0, parse_1.addRequestID)(transform(await this.parseResponse(client, props), props), props.response));
    }
    /**
     * Gets the raw `Response` instance instead of parsing the response
     * data.
     *
     * If you want to parse the response body but still get the `Response`
     * instance, you can use {@link withResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    asResponse() {
        return this.responsePromise.then((p) => p.response);
    }
    /**
     * Gets the parsed response data, the raw `Response` instance and the ID of the request,
     * returned via the X-Request-ID header which is useful for debugging requests and reporting
     * issues to OpenAI.
     *
     * If you just want to get the raw `Response` instance without parsing it,
     * you can use {@link asResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    async withResponse() {
        const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
        return { data, response, request_id: response.headers.get('x-request-id') };
    }
    parse() {
        if (!this.parsedPromise) {
            this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(tslib_1.__classPrivateFieldGet(this, _APIPromise_client, "f"), data));
        }
        return this.parsedPromise;
    }
    then(onfulfilled, onrejected) {
        return this.parse().then(onfulfilled, onrejected);
    }
    catch(onrejected) {
        return this.parse().catch(onrejected);
    }
    finally(onfinally) {
        return this.parse().finally(onfinally);
    }
}
exports.APIPromise = APIPromise;
_APIPromise_client = new WeakMap();
//# sourceMappingURL=api-promise.js.map

/***/ },

/***/ "./node_modules/openai/core/error.js"
/*!*******************************************!*\
  !*** ./node_modules/openai/core/error.js ***!
  \*******************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.InvalidWebhookSignatureError = exports.ContentFilterFinishReasonError = exports.LengthFinishReasonError = exports.InternalServerError = exports.RateLimitError = exports.UnprocessableEntityError = exports.ConflictError = exports.NotFoundError = exports.PermissionDeniedError = exports.AuthenticationError = exports.BadRequestError = exports.APIConnectionTimeoutError = exports.APIConnectionError = exports.APIUserAbortError = exports.APIError = exports.OpenAIError = void 0;
const errors_1 = __webpack_require__(/*! ../internal/errors.js */ "./node_modules/openai/internal/errors.js");
class OpenAIError extends Error {
}
exports.OpenAIError = OpenAIError;
class APIError extends OpenAIError {
    constructor(status, error, message, headers) {
        super(`${APIError.makeMessage(status, error, message)}`);
        this.status = status;
        this.headers = headers;
        this.requestID = headers?.get('x-request-id');
        this.error = error;
        const data = error;
        this.code = data?.['code'];
        this.param = data?.['param'];
        this.type = data?.['type'];
    }
    static makeMessage(status, error, message) {
        const msg = error?.message ?
            typeof error.message === 'string' ?
                error.message
                : JSON.stringify(error.message)
            : error ? JSON.stringify(error)
                : message;
        if (status && msg) {
            return `${status} ${msg}`;
        }
        if (status) {
            return `${status} status code (no body)`;
        }
        if (msg) {
            return msg;
        }
        return '(no status code or body)';
    }
    static generate(status, errorResponse, message, headers) {
        if (!status || !headers) {
            return new APIConnectionError({ message, cause: (0, errors_1.castToError)(errorResponse) });
        }
        const error = errorResponse?.['error'];
        if (status === 400) {
            return new BadRequestError(status, error, message, headers);
        }
        if (status === 401) {
            return new AuthenticationError(status, error, message, headers);
        }
        if (status === 403) {
            return new PermissionDeniedError(status, error, message, headers);
        }
        if (status === 404) {
            return new NotFoundError(status, error, message, headers);
        }
        if (status === 409) {
            return new ConflictError(status, error, message, headers);
        }
        if (status === 422) {
            return new UnprocessableEntityError(status, error, message, headers);
        }
        if (status === 429) {
            return new RateLimitError(status, error, message, headers);
        }
        if (status >= 500) {
            return new InternalServerError(status, error, message, headers);
        }
        return new APIError(status, error, message, headers);
    }
}
exports.APIError = APIError;
class APIUserAbortError extends APIError {
    constructor({ message } = {}) {
        super(undefined, undefined, message || 'Request was aborted.', undefined);
    }
}
exports.APIUserAbortError = APIUserAbortError;
class APIConnectionError extends APIError {
    constructor({ message, cause }) {
        super(undefined, undefined, message || 'Connection error.', undefined);
        // in some environments the 'cause' property is already declared
        // @ts-ignore
        if (cause)
            this.cause = cause;
    }
}
exports.APIConnectionError = APIConnectionError;
class APIConnectionTimeoutError extends APIConnectionError {
    constructor({ message } = {}) {
        super({ message: message ?? 'Request timed out.' });
    }
}
exports.APIConnectionTimeoutError = APIConnectionTimeoutError;
class BadRequestError extends APIError {
}
exports.BadRequestError = BadRequestError;
class AuthenticationError extends APIError {
}
exports.AuthenticationError = AuthenticationError;
class PermissionDeniedError extends APIError {
}
exports.PermissionDeniedError = PermissionDeniedError;
class NotFoundError extends APIError {
}
exports.NotFoundError = NotFoundError;
class ConflictError extends APIError {
}
exports.ConflictError = ConflictError;
class UnprocessableEntityError extends APIError {
}
exports.UnprocessableEntityError = UnprocessableEntityError;
class RateLimitError extends APIError {
}
exports.RateLimitError = RateLimitError;
class InternalServerError extends APIError {
}
exports.InternalServerError = InternalServerError;
class LengthFinishReasonError extends OpenAIError {
    constructor() {
        super(`Could not parse response content as the length limit was reached`);
    }
}
exports.LengthFinishReasonError = LengthFinishReasonError;
class ContentFilterFinishReasonError extends OpenAIError {
    constructor() {
        super(`Could not parse response content as the request was rejected by the content filter`);
    }
}
exports.ContentFilterFinishReasonError = ContentFilterFinishReasonError;
class InvalidWebhookSignatureError extends Error {
    constructor(message) {
        super(message);
    }
}
exports.InvalidWebhookSignatureError = InvalidWebhookSignatureError;
//# sourceMappingURL=error.js.map

/***/ },

/***/ "./node_modules/openai/core/pagination.js"
/*!************************************************!*\
  !*** ./node_modules/openai/core/pagination.js ***!
  \************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
var _AbstractPage_client;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ConversationCursorPage = exports.CursorPage = exports.Page = exports.PagePromise = exports.AbstractPage = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ./error.js */ "./node_modules/openai/core/error.js");
const parse_1 = __webpack_require__(/*! ../internal/parse.js */ "./node_modules/openai/internal/parse.js");
const api_promise_1 = __webpack_require__(/*! ./api-promise.js */ "./node_modules/openai/core/api-promise.js");
const values_1 = __webpack_require__(/*! ../internal/utils/values.js */ "./node_modules/openai/internal/utils/values.js");
class AbstractPage {
    constructor(client, response, body, options) {
        _AbstractPage_client.set(this, void 0);
        tslib_1.__classPrivateFieldSet(this, _AbstractPage_client, client, "f");
        this.options = options;
        this.response = response;
        this.body = body;
    }
    hasNextPage() {
        const items = this.getPaginatedItems();
        if (!items.length)
            return false;
        return this.nextPageRequestOptions() != null;
    }
    async getNextPage() {
        const nextOptions = this.nextPageRequestOptions();
        if (!nextOptions) {
            throw new error_1.OpenAIError('No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.');
        }
        return await tslib_1.__classPrivateFieldGet(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
    }
    async *iterPages() {
        let page = this;
        yield page;
        while (page.hasNextPage()) {
            page = await page.getNextPage();
            yield page;
        }
    }
    async *[(_AbstractPage_client = new WeakMap(), Symbol.asyncIterator)]() {
        for await (const page of this.iterPages()) {
            for (const item of page.getPaginatedItems()) {
                yield item;
            }
        }
    }
}
exports.AbstractPage = AbstractPage;
/**
 * This subclass of Promise will resolve to an instantiated Page once the request completes.
 *
 * It also implements AsyncIterable to allow auto-paginating iteration on an unawaited list call, eg:
 *
 *    for await (const item of client.items.list()) {
 *      console.log(item)
 *    }
 */
class PagePromise extends api_promise_1.APIPromise {
    constructor(client, request, Page) {
        super(client, request, async (client, props) => new Page(client, props.response, await (0, parse_1.defaultParseResponse)(client, props), props.options));
    }
    /**
     * Allow auto-paginating iteration on an unawaited list call, eg:
     *
     *    for await (const item of client.items.list()) {
     *      console.log(item)
     *    }
     */
    async *[Symbol.asyncIterator]() {
        const page = await this;
        for await (const item of page) {
            yield item;
        }
    }
}
exports.PagePromise = PagePromise;
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class Page extends AbstractPage {
    constructor(client, response, body, options) {
        super(client, response, body, options);
        this.data = body.data || [];
        this.object = body.object;
    }
    getPaginatedItems() {
        return this.data ?? [];
    }
    nextPageRequestOptions() {
        return null;
    }
}
exports.Page = Page;
class CursorPage extends AbstractPage {
    constructor(client, response, body, options) {
        super(client, response, body, options);
        this.data = body.data || [];
        this.has_more = body.has_more || false;
    }
    getPaginatedItems() {
        return this.data ?? [];
    }
    hasNextPage() {
        if (this.has_more === false) {
            return false;
        }
        return super.hasNextPage();
    }
    nextPageRequestOptions() {
        const data = this.getPaginatedItems();
        const id = data[data.length - 1]?.id;
        if (!id) {
            return null;
        }
        return {
            ...this.options,
            query: {
                ...(0, values_1.maybeObj)(this.options.query),
                after: id,
            },
        };
    }
}
exports.CursorPage = CursorPage;
class ConversationCursorPage extends AbstractPage {
    constructor(client, response, body, options) {
        super(client, response, body, options);
        this.data = body.data || [];
        this.has_more = body.has_more || false;
        this.last_id = body.last_id || '';
    }
    getPaginatedItems() {
        return this.data ?? [];
    }
    hasNextPage() {
        if (this.has_more === false) {
            return false;
        }
        return super.hasNextPage();
    }
    nextPageRequestOptions() {
        const cursor = this.last_id;
        if (!cursor) {
            return null;
        }
        return {
            ...this.options,
            query: {
                ...(0, values_1.maybeObj)(this.options.query),
                after: cursor,
            },
        };
    }
}
exports.ConversationCursorPage = ConversationCursorPage;
//# sourceMappingURL=pagination.js.map

/***/ },

/***/ "./node_modules/openai/core/resource.js"
/*!**********************************************!*\
  !*** ./node_modules/openai/core/resource.js ***!
  \**********************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.APIResource = void 0;
class APIResource {
    constructor(client) {
        this._client = client;
    }
}
exports.APIResource = APIResource;
//# sourceMappingURL=resource.js.map

/***/ },

/***/ "./node_modules/openai/core/streaming.js"
/*!***********************************************!*\
  !*** ./node_modules/openai/core/streaming.js ***!
  \***********************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _Stream_client;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Stream = void 0;
exports._iterSSEMessages = _iterSSEMessages;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ./error.js */ "./node_modules/openai/core/error.js");
const shims_1 = __webpack_require__(/*! ../internal/shims.js */ "./node_modules/openai/internal/shims.js");
const line_1 = __webpack_require__(/*! ../internal/decoders/line.js */ "./node_modules/openai/internal/decoders/line.js");
const shims_2 = __webpack_require__(/*! ../internal/shims.js */ "./node_modules/openai/internal/shims.js");
const errors_1 = __webpack_require__(/*! ../internal/errors.js */ "./node_modules/openai/internal/errors.js");
const bytes_1 = __webpack_require__(/*! ../internal/utils/bytes.js */ "./node_modules/openai/internal/utils/bytes.js");
const log_1 = __webpack_require__(/*! ../internal/utils/log.js */ "./node_modules/openai/internal/utils/log.js");
const error_2 = __webpack_require__(/*! ./error.js */ "./node_modules/openai/core/error.js");
class Stream {
    constructor(iterator, controller, client) {
        this.iterator = iterator;
        _Stream_client.set(this, void 0);
        this.controller = controller;
        tslib_1.__classPrivateFieldSet(this, _Stream_client, client, "f");
    }
    static fromSSEResponse(response, controller, client) {
        let consumed = false;
        const logger = client ? (0, log_1.loggerFor)(client) : console;
        async function* iterator() {
            if (consumed) {
                throw new error_1.OpenAIError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const sse of _iterSSEMessages(response, controller)) {
                    if (done)
                        continue;
                    if (sse.data.startsWith('[DONE]')) {
                        done = true;
                        continue;
                    }
                    if (sse.event === null || !sse.event.startsWith('thread.')) {
                        let data;
                        try {
                            data = JSON.parse(sse.data);
                        }
                        catch (e) {
                            logger.error(`Could not parse message into JSON:`, sse.data);
                            logger.error(`From chunk:`, sse.raw);
                            throw e;
                        }
                        if (data && data.error) {
                            throw new error_2.APIError(undefined, data.error, undefined, response.headers);
                        }
                        yield data;
                    }
                    else {
                        let data;
                        try {
                            data = JSON.parse(sse.data);
                        }
                        catch (e) {
                            console.error(`Could not parse message into JSON:`, sse.data);
                            console.error(`From chunk:`, sse.raw);
                            throw e;
                        }
                        // TODO: Is this where the error should be thrown?
                        if (sse.event == 'error') {
                            throw new error_2.APIError(undefined, data.error, data.message, undefined);
                        }
                        yield { event: sse.event, data: data };
                    }
                }
                done = true;
            }
            catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if ((0, errors_1.isAbortError)(e))
                    return;
                throw e;
            }
            finally {
                // If the user `break`s, abort the ongoing request.
                if (!done)
                    controller.abort();
            }
        }
        return new Stream(iterator, controller, client);
    }
    /**
     * Generates a Stream from a newline-separated ReadableStream
     * where each item is a JSON value.
     */
    static fromReadableStream(readableStream, controller, client) {
        let consumed = false;
        async function* iterLines() {
            const lineDecoder = new line_1.LineDecoder();
            const iter = (0, shims_2.ReadableStreamToAsyncIterable)(readableStream);
            for await (const chunk of iter) {
                for (const line of lineDecoder.decode(chunk)) {
                    yield line;
                }
            }
            for (const line of lineDecoder.flush()) {
                yield line;
            }
        }
        async function* iterator() {
            if (consumed) {
                throw new error_1.OpenAIError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const line of iterLines()) {
                    if (done)
                        continue;
                    if (line)
                        yield JSON.parse(line);
                }
                done = true;
            }
            catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if ((0, errors_1.isAbortError)(e))
                    return;
                throw e;
            }
            finally {
                // If the user `break`s, abort the ongoing request.
                if (!done)
                    controller.abort();
            }
        }
        return new Stream(iterator, controller, client);
    }
    [(_Stream_client = new WeakMap(), Symbol.asyncIterator)]() {
        return this.iterator();
    }
    /**
     * Splits the stream into two streams which can be
     * independently read from at different speeds.
     */
    tee() {
        const left = [];
        const right = [];
        const iterator = this.iterator();
        const teeIterator = (queue) => {
            return {
                next: () => {
                    if (queue.length === 0) {
                        const result = iterator.next();
                        left.push(result);
                        right.push(result);
                    }
                    return queue.shift();
                },
            };
        };
        return [
            new Stream(() => teeIterator(left), this.controller, tslib_1.__classPrivateFieldGet(this, _Stream_client, "f")),
            new Stream(() => teeIterator(right), this.controller, tslib_1.__classPrivateFieldGet(this, _Stream_client, "f")),
        ];
    }
    /**
     * Converts this stream to a newline-separated ReadableStream of
     * JSON stringified values in the stream
     * which can be turned back into a Stream with `Stream.fromReadableStream()`.
     */
    toReadableStream() {
        const self = this;
        let iter;
        return (0, shims_1.makeReadableStream)({
            async start() {
                iter = self[Symbol.asyncIterator]();
            },
            async pull(ctrl) {
                try {
                    const { value, done } = await iter.next();
                    if (done)
                        return ctrl.close();
                    const bytes = (0, bytes_1.encodeUTF8)(JSON.stringify(value) + '\n');
                    ctrl.enqueue(bytes);
                }
                catch (err) {
                    ctrl.error(err);
                }
            },
            async cancel() {
                await iter.return?.();
            },
        });
    }
}
exports.Stream = Stream;
async function* _iterSSEMessages(response, controller) {
    if (!response.body) {
        controller.abort();
        if (typeof globalThis.navigator !== 'undefined' &&
            globalThis.navigator.product === 'ReactNative') {
            throw new error_1.OpenAIError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
        }
        throw new error_1.OpenAIError(`Attempted to iterate over a response with no body`);
    }
    const sseDecoder = new SSEDecoder();
    const lineDecoder = new line_1.LineDecoder();
    const iter = (0, shims_2.ReadableStreamToAsyncIterable)(response.body);
    for await (const sseChunk of iterSSEChunks(iter)) {
        for (const line of lineDecoder.decode(sseChunk)) {
            const sse = sseDecoder.decode(line);
            if (sse)
                yield sse;
        }
    }
    for (const line of lineDecoder.flush()) {
        const sse = sseDecoder.decode(line);
        if (sse)
            yield sse;
    }
}
/**
 * Given an async iterable iterator, iterates over it and yields full
 * SSE chunks, i.e. yields when a double new-line is encountered.
 */
async function* iterSSEChunks(iterator) {
    let data = new Uint8Array();
    for await (const chunk of iterator) {
        if (chunk == null) {
            continue;
        }
        const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? (0, bytes_1.encodeUTF8)(chunk)
                : chunk;
        let newData = new Uint8Array(data.length + binaryChunk.length);
        newData.set(data);
        newData.set(binaryChunk, data.length);
        data = newData;
        let patternIndex;
        while ((patternIndex = (0, line_1.findDoubleNewlineIndex)(data)) !== -1) {
            yield data.slice(0, patternIndex);
            data = data.slice(patternIndex);
        }
    }
    if (data.length > 0) {
        yield data;
    }
}
class SSEDecoder {
    constructor() {
        this.event = null;
        this.data = [];
        this.chunks = [];
    }
    decode(line) {
        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }
        if (!line) {
            // empty line and we didn't previously encounter any messages
            if (!this.event && !this.data.length)
                return null;
            const sse = {
                event: this.event,
                data: this.data.join('\n'),
                raw: this.chunks,
            };
            this.event = null;
            this.data = [];
            this.chunks = [];
            return sse;
        }
        this.chunks.push(line);
        if (line.startsWith(':')) {
            return null;
        }
        let [fieldname, _, value] = partition(line, ':');
        if (value.startsWith(' ')) {
            value = value.substring(1);
        }
        if (fieldname === 'event') {
            this.event = value;
        }
        else if (fieldname === 'data') {
            this.data.push(value);
        }
        return null;
    }
}
function partition(str, delimiter) {
    const index = str.indexOf(delimiter);
    if (index !== -1) {
        return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
    }
    return [str, '', ''];
}
//# sourceMappingURL=streaming.js.map

/***/ },

/***/ "./node_modules/openai/core/uploads.js"
/*!*********************************************!*\
  !*** ./node_modules/openai/core/uploads.js ***!
  \*********************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.toFile = void 0;
var to_file_1 = __webpack_require__(/*! ../internal/to-file.js */ "./node_modules/openai/internal/to-file.js");
Object.defineProperty(exports, "toFile", ({ enumerable: true, get: function () { return to_file_1.toFile; } }));
//# sourceMappingURL=uploads.js.map

/***/ },

/***/ "./node_modules/openai/error.js"
/*!**************************************!*\
  !*** ./node_modules/openai/error.js ***!
  \**************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const tslib_1 = __webpack_require__(/*! ./internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
/** @deprecated Import from ./core/error instead */
tslib_1.__exportStar(__webpack_require__(/*! ./core/error.js */ "./node_modules/openai/core/error.js"), exports);
//# sourceMappingURL=error.js.map

/***/ },

/***/ "./node_modules/openai/index.js"
/*!**************************************!*\
  !*** ./node_modules/openai/index.js ***!
  \**************************************/
(module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
exports = module.exports = function (...args) {
  return new exports.default(...args)
}
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AzureOpenAI = exports.InvalidWebhookSignatureError = exports.UnprocessableEntityError = exports.PermissionDeniedError = exports.InternalServerError = exports.AuthenticationError = exports.BadRequestError = exports.RateLimitError = exports.ConflictError = exports.NotFoundError = exports.APIUserAbortError = exports.APIConnectionTimeoutError = exports.APIConnectionError = exports.APIError = exports.OpenAIError = exports.PagePromise = exports.OpenAI = exports.APIPromise = exports.toFile = exports["default"] = void 0;
var client_1 = __webpack_require__(/*! ./client.js */ "./node_modules/openai/client.js");
Object.defineProperty(exports, "default", ({ enumerable: true, get: function () { return client_1.OpenAI; } }));
var uploads_1 = __webpack_require__(/*! ./core/uploads.js */ "./node_modules/openai/core/uploads.js");
Object.defineProperty(exports, "toFile", ({ enumerable: true, get: function () { return uploads_1.toFile; } }));
var api_promise_1 = __webpack_require__(/*! ./core/api-promise.js */ "./node_modules/openai/core/api-promise.js");
Object.defineProperty(exports, "APIPromise", ({ enumerable: true, get: function () { return api_promise_1.APIPromise; } }));
var client_2 = __webpack_require__(/*! ./client.js */ "./node_modules/openai/client.js");
Object.defineProperty(exports, "OpenAI", ({ enumerable: true, get: function () { return client_2.OpenAI; } }));
var pagination_1 = __webpack_require__(/*! ./core/pagination.js */ "./node_modules/openai/core/pagination.js");
Object.defineProperty(exports, "PagePromise", ({ enumerable: true, get: function () { return pagination_1.PagePromise; } }));
var error_1 = __webpack_require__(/*! ./core/error.js */ "./node_modules/openai/core/error.js");
Object.defineProperty(exports, "OpenAIError", ({ enumerable: true, get: function () { return error_1.OpenAIError; } }));
Object.defineProperty(exports, "APIError", ({ enumerable: true, get: function () { return error_1.APIError; } }));
Object.defineProperty(exports, "APIConnectionError", ({ enumerable: true, get: function () { return error_1.APIConnectionError; } }));
Object.defineProperty(exports, "APIConnectionTimeoutError", ({ enumerable: true, get: function () { return error_1.APIConnectionTimeoutError; } }));
Object.defineProperty(exports, "APIUserAbortError", ({ enumerable: true, get: function () { return error_1.APIUserAbortError; } }));
Object.defineProperty(exports, "NotFoundError", ({ enumerable: true, get: function () { return error_1.NotFoundError; } }));
Object.defineProperty(exports, "ConflictError", ({ enumerable: true, get: function () { return error_1.ConflictError; } }));
Object.defineProperty(exports, "RateLimitError", ({ enumerable: true, get: function () { return error_1.RateLimitError; } }));
Object.defineProperty(exports, "BadRequestError", ({ enumerable: true, get: function () { return error_1.BadRequestError; } }));
Object.defineProperty(exports, "AuthenticationError", ({ enumerable: true, get: function () { return error_1.AuthenticationError; } }));
Object.defineProperty(exports, "InternalServerError", ({ enumerable: true, get: function () { return error_1.InternalServerError; } }));
Object.defineProperty(exports, "PermissionDeniedError", ({ enumerable: true, get: function () { return error_1.PermissionDeniedError; } }));
Object.defineProperty(exports, "UnprocessableEntityError", ({ enumerable: true, get: function () { return error_1.UnprocessableEntityError; } }));
Object.defineProperty(exports, "InvalidWebhookSignatureError", ({ enumerable: true, get: function () { return error_1.InvalidWebhookSignatureError; } }));
var azure_1 = __webpack_require__(/*! ./azure.js */ "./node_modules/openai/azure.js");
Object.defineProperty(exports, "AzureOpenAI", ({ enumerable: true, get: function () { return azure_1.AzureOpenAI; } }));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/openai/internal/decoders/line.js"
/*!*******************************************************!*\
  !*** ./node_modules/openai/internal/decoders/line.js ***!
  \*******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _LineDecoder_buffer, _LineDecoder_carriageReturnIndex;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LineDecoder = void 0;
exports.findDoubleNewlineIndex = findDoubleNewlineIndex;
const tslib_1 = __webpack_require__(/*! ../tslib.js */ "./node_modules/openai/internal/tslib.js");
const bytes_1 = __webpack_require__(/*! ../utils/bytes.js */ "./node_modules/openai/internal/utils/bytes.js");
/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
class LineDecoder {
    constructor() {
        _LineDecoder_buffer.set(this, void 0);
        _LineDecoder_carriageReturnIndex.set(this, void 0);
        tslib_1.__classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
        tslib_1.__classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    decode(chunk) {
        if (chunk == null) {
            return [];
        }
        const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? (0, bytes_1.encodeUTF8)(chunk)
                : chunk;
        tslib_1.__classPrivateFieldSet(this, _LineDecoder_buffer, (0, bytes_1.concatBytes)([tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), binaryChunk]), "f");
        const lines = [];
        let patternIndex;
        while ((patternIndex = findNewlineIndex(tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
            if (patternIndex.carriage && tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") == null) {
                // skip until we either get a corresponding `\n`, a new `\r` or nothing
                tslib_1.__classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
                continue;
            }
            // we got double \r or \rtext\n
            if (tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") != null &&
                (patternIndex.index !== tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
                lines.push((0, bytes_1.decodeUTF8)(tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
                tslib_1.__classPrivateFieldSet(this, _LineDecoder_buffer, tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")), "f");
                tslib_1.__classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
                continue;
            }
            const endIndex = tslib_1.__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
            const line = (0, bytes_1.decodeUTF8)(tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
            lines.push(line);
            tslib_1.__classPrivateFieldSet(this, _LineDecoder_buffer, tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(patternIndex.index), "f");
            tslib_1.__classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
        }
        return lines;
    }
    flush() {
        if (!tslib_1.__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
            return [];
        }
        return this.decode('\n');
    }
}
exports.LineDecoder = LineDecoder;
_LineDecoder_buffer = new WeakMap(), _LineDecoder_carriageReturnIndex = new WeakMap();
// prettier-ignore
LineDecoder.NEWLINE_CHARS = new Set(['\n', '\r']);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
/**
 * This function searches the buffer for the end patterns, (\r or \n)
 * and returns an object with the index preceding the matched newline and the
 * index after the newline char. `null` is returned if no new line is found.
 *
 * ```ts
 * findNewLineIndex('abc\ndef') -> { preceding: 2, index: 3 }
 * ```
 */
function findNewlineIndex(buffer, startIndex) {
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = startIndex ?? 0; i < buffer.length; i++) {
        if (buffer[i] === newline) {
            return { preceding: i, index: i + 1, carriage: false };
        }
        if (buffer[i] === carriage) {
            return { preceding: i, index: i + 1, carriage: true };
        }
    }
    return null;
}
function findDoubleNewlineIndex(buffer) {
    // This function searches the buffer for the end patterns (\r\r, \n\n, \r\n\r\n)
    // and returns the index right after the first occurrence of any pattern,
    // or -1 if none of the patterns are found.
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === newline && buffer[i + 1] === newline) {
            // \n\n
            return i + 2;
        }
        if (buffer[i] === carriage && buffer[i + 1] === carriage) {
            // \r\r
            return i + 2;
        }
        if (buffer[i] === carriage &&
            buffer[i + 1] === newline &&
            i + 3 < buffer.length &&
            buffer[i + 2] === carriage &&
            buffer[i + 3] === newline) {
            // \r\n\r\n
            return i + 4;
        }
    }
    return -1;
}
//# sourceMappingURL=line.js.map

/***/ },

/***/ "./node_modules/openai/internal/detect-platform.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/internal/detect-platform.js ***!
  \*********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getPlatformHeaders = exports.isRunningInBrowser = void 0;
const version_1 = __webpack_require__(/*! ../version.js */ "./node_modules/openai/version.js");
const isRunningInBrowser = () => {
    return (
    // @ts-ignore
    typeof window !== 'undefined' &&
        // @ts-ignore
        typeof window.document !== 'undefined' &&
        // @ts-ignore
        typeof navigator !== 'undefined');
};
exports.isRunningInBrowser = isRunningInBrowser;
/**
 * Note this does not detect 'browser'; for that, use getBrowserInfo().
 */
function getDetectedPlatform() {
    if (typeof Deno !== 'undefined' && Deno.build != null) {
        return 'deno';
    }
    if (typeof EdgeRuntime !== 'undefined') {
        return 'edge';
    }
    if (Object.prototype.toString.call(typeof globalThis.process !== 'undefined' ? globalThis.process : 0) === '[object process]') {
        return 'node';
    }
    return 'unknown';
}
const getPlatformProperties = () => {
    const detectedPlatform = getDetectedPlatform();
    if (detectedPlatform === 'deno') {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': version_1.VERSION,
            'X-Stainless-OS': normalizePlatform(Deno.build.os),
            'X-Stainless-Arch': normalizeArch(Deno.build.arch),
            'X-Stainless-Runtime': 'deno',
            'X-Stainless-Runtime-Version': typeof Deno.version === 'string' ? Deno.version : Deno.version?.deno ?? 'unknown',
        };
    }
    if (typeof EdgeRuntime !== 'undefined') {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': version_1.VERSION,
            'X-Stainless-OS': 'Unknown',
            'X-Stainless-Arch': `other:${EdgeRuntime}`,
            'X-Stainless-Runtime': 'edge',
            'X-Stainless-Runtime-Version': globalThis.process.version,
        };
    }
    // Check if Node.js
    if (detectedPlatform === 'node') {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': version_1.VERSION,
            'X-Stainless-OS': normalizePlatform(globalThis.process.platform ?? 'unknown'),
            'X-Stainless-Arch': normalizeArch(globalThis.process.arch ?? 'unknown'),
            'X-Stainless-Runtime': 'node',
            'X-Stainless-Runtime-Version': globalThis.process.version ?? 'unknown',
        };
    }
    const browserInfo = getBrowserInfo();
    if (browserInfo) {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': version_1.VERSION,
            'X-Stainless-OS': 'Unknown',
            'X-Stainless-Arch': 'unknown',
            'X-Stainless-Runtime': `browser:${browserInfo.browser}`,
            'X-Stainless-Runtime-Version': browserInfo.version,
        };
    }
    // TODO add support for Cloudflare workers, etc.
    return {
        'X-Stainless-Lang': 'js',
        'X-Stainless-Package-Version': version_1.VERSION,
        'X-Stainless-OS': 'Unknown',
        'X-Stainless-Arch': 'unknown',
        'X-Stainless-Runtime': 'unknown',
        'X-Stainless-Runtime-Version': 'unknown',
    };
};
// Note: modified from https://github.com/JS-DevTools/host-environment/blob/b1ab79ecde37db5d6e163c050e54fe7d287d7c92/src/isomorphic.browser.ts
function getBrowserInfo() {
    if (typeof navigator === 'undefined' || !navigator) {
        return null;
    }
    // NOTE: The order matters here!
    const browserPatterns = [
        { key: 'edge', pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'ie', pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'ie', pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'chrome', pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'firefox', pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'safari', pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ },
    ];
    // Find the FIRST matching browser
    for (const { key, pattern } of browserPatterns) {
        const match = pattern.exec(navigator.userAgent);
        if (match) {
            const major = match[1] || 0;
            const minor = match[2] || 0;
            const patch = match[3] || 0;
            return { browser: key, version: `${major}.${minor}.${patch}` };
        }
    }
    return null;
}
const normalizeArch = (arch) => {
    // Node docs:
    // - https://nodejs.org/api/process.html#processarch
    // Deno docs:
    // - https://doc.deno.land/deno/stable/~/Deno.build
    if (arch === 'x32')
        return 'x32';
    if (arch === 'x86_64' || arch === 'x64')
        return 'x64';
    if (arch === 'arm')
        return 'arm';
    if (arch === 'aarch64' || arch === 'arm64')
        return 'arm64';
    if (arch)
        return `other:${arch}`;
    return 'unknown';
};
const normalizePlatform = (platform) => {
    // Node platforms:
    // - https://nodejs.org/api/process.html#processplatform
    // Deno platforms:
    // - https://doc.deno.land/deno/stable/~/Deno.build
    // - https://github.com/denoland/deno/issues/14799
    platform = platform.toLowerCase();
    // NOTE: this iOS check is untested and may not work
    // Node does not work natively on IOS, there is a fork at
    // https://github.com/nodejs-mobile/nodejs-mobile
    // however it is unknown at the time of writing how to detect if it is running
    if (platform.includes('ios'))
        return 'iOS';
    if (platform === 'android')
        return 'Android';
    if (platform === 'darwin')
        return 'MacOS';
    if (platform === 'win32')
        return 'Windows';
    if (platform === 'freebsd')
        return 'FreeBSD';
    if (platform === 'openbsd')
        return 'OpenBSD';
    if (platform === 'linux')
        return 'Linux';
    if (platform)
        return `Other:${platform}`;
    return 'Unknown';
};
let _platformHeaders;
const getPlatformHeaders = () => {
    return (_platformHeaders ?? (_platformHeaders = getPlatformProperties()));
};
exports.getPlatformHeaders = getPlatformHeaders;
//# sourceMappingURL=detect-platform.js.map

/***/ },

/***/ "./node_modules/openai/internal/errors.js"
/*!************************************************!*\
  !*** ./node_modules/openai/internal/errors.js ***!
  \************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.castToError = void 0;
exports.isAbortError = isAbortError;
function isAbortError(err) {
    return (typeof err === 'object' &&
        err !== null &&
        // Spec-compliant fetch implementations
        (('name' in err && err.name === 'AbortError') ||
            // Expo fetch
            ('message' in err && String(err.message).includes('FetchRequestCanceledException'))));
}
const castToError = (err) => {
    if (err instanceof Error)
        return err;
    if (typeof err === 'object' && err !== null) {
        try {
            if (Object.prototype.toString.call(err) === '[object Error]') {
                // @ts-ignore - not all envs have native support for cause yet
                const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
                if (err.stack)
                    error.stack = err.stack;
                // @ts-ignore - not all envs have native support for cause yet
                if (err.cause && !error.cause)
                    error.cause = err.cause;
                if (err.name)
                    error.name = err.name;
                return error;
            }
        }
        catch { }
        try {
            return new Error(JSON.stringify(err));
        }
        catch { }
    }
    return new Error(err);
};
exports.castToError = castToError;
//# sourceMappingURL=errors.js.map

/***/ },

/***/ "./node_modules/openai/internal/headers.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/internal/headers.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.isEmptyHeaders = exports.buildHeaders = void 0;
const values_1 = __webpack_require__(/*! ./utils/values.js */ "./node_modules/openai/internal/utils/values.js");
const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');
function* iterateHeaders(headers) {
    if (!headers)
        return;
    if (brand_privateNullableHeaders in headers) {
        const { values, nulls } = headers;
        yield* values.entries();
        for (const name of nulls) {
            yield [name, null];
        }
        return;
    }
    let shouldClear = false;
    let iter;
    if (headers instanceof Headers) {
        iter = headers.entries();
    }
    else if ((0, values_1.isReadonlyArray)(headers)) {
        iter = headers;
    }
    else {
        shouldClear = true;
        iter = Object.entries(headers ?? {});
    }
    for (let row of iter) {
        const name = row[0];
        if (typeof name !== 'string')
            throw new TypeError('expected header name to be a string');
        const values = (0, values_1.isReadonlyArray)(row[1]) ? row[1] : [row[1]];
        let didClear = false;
        for (const value of values) {
            if (value === undefined)
                continue;
            // Objects keys always overwrite older headers, they never append.
            // Yield a null to clear the header before adding the new values.
            if (shouldClear && !didClear) {
                didClear = true;
                yield [name, null];
            }
            yield [name, value];
        }
    }
}
const buildHeaders = (newHeaders) => {
    const targetHeaders = new Headers();
    const nullHeaders = new Set();
    for (const headers of newHeaders) {
        const seenHeaders = new Set();
        for (const [name, value] of iterateHeaders(headers)) {
            const lowerName = name.toLowerCase();
            if (!seenHeaders.has(lowerName)) {
                targetHeaders.delete(name);
                seenHeaders.add(lowerName);
            }
            if (value === null) {
                targetHeaders.delete(name);
                nullHeaders.add(lowerName);
            }
            else {
                targetHeaders.append(name, value);
                nullHeaders.delete(lowerName);
            }
        }
    }
    return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};
exports.buildHeaders = buildHeaders;
const isEmptyHeaders = (headers) => {
    for (const _ of iterateHeaders(headers))
        return false;
    return true;
};
exports.isEmptyHeaders = isEmptyHeaders;
//# sourceMappingURL=headers.js.map

/***/ },

/***/ "./node_modules/openai/internal/parse.js"
/*!***********************************************!*\
  !*** ./node_modules/openai/internal/parse.js ***!
  \***********************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.defaultParseResponse = defaultParseResponse;
exports.addRequestID = addRequestID;
const streaming_1 = __webpack_require__(/*! ../core/streaming.js */ "./node_modules/openai/core/streaming.js");
const log_1 = __webpack_require__(/*! ./utils/log.js */ "./node_modules/openai/internal/utils/log.js");
async function defaultParseResponse(client, props) {
    const { response, requestLogID, retryOfRequestLogID, startTime } = props;
    const body = await (async () => {
        if (props.options.stream) {
            (0, log_1.loggerFor)(client).debug('response', response.status, response.url, response.headers, response.body);
            // Note: there is an invariant here that isn't represented in the type system
            // that if you set `stream: true` the response type must also be `Stream<T>`
            if (props.options.__streamClass) {
                return props.options.__streamClass.fromSSEResponse(response, props.controller, client);
            }
            return streaming_1.Stream.fromSSEResponse(response, props.controller, client);
        }
        // fetch refuses to read the body when the status code is 204.
        if (response.status === 204) {
            return null;
        }
        if (props.options.__binaryResponse) {
            return response;
        }
        const contentType = response.headers.get('content-type');
        const mediaType = contentType?.split(';')[0]?.trim();
        const isJSON = mediaType?.includes('application/json') || mediaType?.endsWith('+json');
        if (isJSON) {
            const contentLength = response.headers.get('content-length');
            if (contentLength === '0') {
                // if there is no content we can't do anything
                return undefined;
            }
            const json = await response.json();
            return addRequestID(json, response);
        }
        const text = await response.text();
        return text;
    })();
    (0, log_1.loggerFor)(client).debug(`[${requestLogID}] response parsed`, (0, log_1.formatRequestDetails)({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        body,
        durationMs: Date.now() - startTime,
    }));
    return body;
}
function addRequestID(value, response) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    return Object.defineProperty(value, '_request_id', {
        value: response.headers.get('x-request-id'),
        enumerable: false,
    });
}
//# sourceMappingURL=parse.js.map

/***/ },

/***/ "./node_modules/openai/internal/qs/formats.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/internal/qs/formats.js ***!
  \****************************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RFC3986 = exports.RFC1738 = exports.formatters = exports.default_formatter = exports.default_format = void 0;
exports.default_format = 'RFC3986';
const default_formatter = (v) => String(v);
exports.default_formatter = default_formatter;
exports.formatters = {
    RFC1738: (v) => String(v).replace(/%20/g, '+'),
    RFC3986: exports.default_formatter,
};
exports.RFC1738 = 'RFC1738';
exports.RFC3986 = 'RFC3986';
//# sourceMappingURL=formats.js.map

/***/ },

/***/ "./node_modules/openai/internal/qs/index.js"
/*!**************************************************!*\
  !*** ./node_modules/openai/internal/qs/index.js ***!
  \**************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.formats = exports.stringify = void 0;
const formats_1 = __webpack_require__(/*! ./formats.js */ "./node_modules/openai/internal/qs/formats.js");
const formats = {
    formatters: formats_1.formatters,
    RFC1738: formats_1.RFC1738,
    RFC3986: formats_1.RFC3986,
    default: formats_1.default_format,
};
exports.formats = formats;
var stringify_1 = __webpack_require__(/*! ./stringify.js */ "./node_modules/openai/internal/qs/stringify.js");
Object.defineProperty(exports, "stringify", ({ enumerable: true, get: function () { return stringify_1.stringify; } }));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/openai/internal/qs/stringify.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/internal/qs/stringify.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.stringify = stringify;
const utils_1 = __webpack_require__(/*! ./utils.js */ "./node_modules/openai/internal/qs/utils.js");
const formats_1 = __webpack_require__(/*! ./formats.js */ "./node_modules/openai/internal/qs/formats.js");
const values_1 = __webpack_require__(/*! ../utils/values.js */ "./node_modules/openai/internal/utils/values.js");
const array_prefix_generators = {
    brackets(prefix) {
        return String(prefix) + '[]';
    },
    comma: 'comma',
    indices(prefix, key) {
        return String(prefix) + '[' + key + ']';
    },
    repeat(prefix) {
        return String(prefix);
    },
};
const push_to_array = function (arr, value_or_array) {
    Array.prototype.push.apply(arr, (0, values_1.isArray)(value_or_array) ? value_or_array : [value_or_array]);
};
let toISOString;
const defaults = {
    addQueryPrefix: false,
    allowDots: false,
    allowEmptyArrays: false,
    arrayFormat: 'indices',
    charset: 'utf-8',
    charsetSentinel: false,
    delimiter: '&',
    encode: true,
    encodeDotInKeys: false,
    encoder: utils_1.encode,
    encodeValuesOnly: false,
    format: formats_1.default_format,
    formatter: formats_1.default_formatter,
    /** @deprecated */
    indices: false,
    serializeDate(date) {
        return (toISOString ?? (toISOString = Function.prototype.call.bind(Date.prototype.toISOString)))(date);
    },
    skipNulls: false,
    strictNullHandling: false,
};
function is_non_nullish_primitive(v) {
    return (typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'symbol' ||
        typeof v === 'bigint');
}
const sentinel = {};
function inner_stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
    let obj = object;
    let tmp_sc = sideChannel;
    let step = 0;
    let find_flag = false;
    while ((tmp_sc = tmp_sc.get(sentinel)) !== void undefined && !find_flag) {
        // Where object last appeared in the ref tree
        const pos = tmp_sc.get(object);
        step += 1;
        if (typeof pos !== 'undefined') {
            if (pos === step) {
                throw new RangeError('Cyclic object value');
            }
            else {
                find_flag = true; // Break while
            }
        }
        if (typeof tmp_sc.get(sentinel) === 'undefined') {
            step = 0;
        }
    }
    if (typeof filter === 'function') {
        obj = filter(prefix, obj);
    }
    else if (obj instanceof Date) {
        obj = serializeDate?.(obj);
    }
    else if (generateArrayPrefix === 'comma' && (0, values_1.isArray)(obj)) {
        obj = (0, utils_1.maybe_map)(obj, function (value) {
            if (value instanceof Date) {
                return serializeDate?.(value);
            }
            return value;
        });
    }
    if (obj === null) {
        if (strictNullHandling) {
            return encoder && !encodeValuesOnly ?
                // @ts-expect-error
                encoder(prefix, defaults.encoder, charset, 'key', format)
                : prefix;
        }
        obj = '';
    }
    if (is_non_nullish_primitive(obj) || (0, utils_1.is_buffer)(obj)) {
        if (encoder) {
            const key_value = encodeValuesOnly ? prefix
                // @ts-expect-error
                : encoder(prefix, defaults.encoder, charset, 'key', format);
            return [
                formatter?.(key_value) +
                    '=' +
                    // @ts-expect-error
                    formatter?.(encoder(obj, defaults.encoder, charset, 'value', format)),
            ];
        }
        return [formatter?.(prefix) + '=' + formatter?.(String(obj))];
    }
    const values = [];
    if (typeof obj === 'undefined') {
        return values;
    }
    let obj_keys;
    if (generateArrayPrefix === 'comma' && (0, values_1.isArray)(obj)) {
        // we need to join elements in
        if (encodeValuesOnly && encoder) {
            // @ts-expect-error values only
            obj = (0, utils_1.maybe_map)(obj, encoder);
        }
        obj_keys = [{ value: obj.length > 0 ? obj.join(',') || null : void undefined }];
    }
    else if ((0, values_1.isArray)(filter)) {
        obj_keys = filter;
    }
    else {
        const keys = Object.keys(obj);
        obj_keys = sort ? keys.sort(sort) : keys;
    }
    const encoded_prefix = encodeDotInKeys ? String(prefix).replace(/\./g, '%2E') : String(prefix);
    const adjusted_prefix = commaRoundTrip && (0, values_1.isArray)(obj) && obj.length === 1 ? encoded_prefix + '[]' : encoded_prefix;
    if (allowEmptyArrays && (0, values_1.isArray)(obj) && obj.length === 0) {
        return adjusted_prefix + '[]';
    }
    for (let j = 0; j < obj_keys.length; ++j) {
        const key = obj_keys[j];
        const value = 
        // @ts-ignore
        typeof key === 'object' && typeof key.value !== 'undefined' ? key.value : obj[key];
        if (skipNulls && value === null) {
            continue;
        }
        // @ts-ignore
        const encoded_key = allowDots && encodeDotInKeys ? key.replace(/\./g, '%2E') : key;
        const key_prefix = (0, values_1.isArray)(obj) ?
            typeof generateArrayPrefix === 'function' ?
                generateArrayPrefix(adjusted_prefix, encoded_key)
                : adjusted_prefix
            : adjusted_prefix + (allowDots ? '.' + encoded_key : '[' + encoded_key + ']');
        sideChannel.set(object, step);
        const valueSideChannel = new WeakMap();
        valueSideChannel.set(sentinel, sideChannel);
        push_to_array(values, inner_stringify(value, key_prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, 
        // @ts-ignore
        generateArrayPrefix === 'comma' && encodeValuesOnly && (0, values_1.isArray)(obj) ? null : encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, valueSideChannel));
    }
    return values;
}
function normalize_stringify_options(opts = defaults) {
    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }
    if (typeof opts.encodeDotInKeys !== 'undefined' && typeof opts.encodeDotInKeys !== 'boolean') {
        throw new TypeError('`encodeDotInKeys` option can only be `true` or `false`, when provided');
    }
    if (opts.encoder !== null && typeof opts.encoder !== 'undefined' && typeof opts.encoder !== 'function') {
        throw new TypeError('Encoder has to be a function.');
    }
    const charset = opts.charset || defaults.charset;
    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }
    let format = formats_1.default_format;
    if (typeof opts.format !== 'undefined') {
        if (!(0, utils_1.has)(formats_1.formatters, opts.format)) {
            throw new TypeError('Unknown format option provided.');
        }
        format = opts.format;
    }
    const formatter = formats_1.formatters[format];
    let filter = defaults.filter;
    if (typeof opts.filter === 'function' || (0, values_1.isArray)(opts.filter)) {
        filter = opts.filter;
    }
    let arrayFormat;
    if (opts.arrayFormat && opts.arrayFormat in array_prefix_generators) {
        arrayFormat = opts.arrayFormat;
    }
    else if ('indices' in opts) {
        arrayFormat = opts.indices ? 'indices' : 'repeat';
    }
    else {
        arrayFormat = defaults.arrayFormat;
    }
    if ('commaRoundTrip' in opts && typeof opts.commaRoundTrip !== 'boolean') {
        throw new TypeError('`commaRoundTrip` must be a boolean, or absent');
    }
    const allowDots = typeof opts.allowDots === 'undefined' ?
        !!opts.encodeDotInKeys === true ?
            true
            : defaults.allowDots
        : !!opts.allowDots;
    return {
        addQueryPrefix: typeof opts.addQueryPrefix === 'boolean' ? opts.addQueryPrefix : defaults.addQueryPrefix,
        // @ts-ignore
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
        arrayFormat: arrayFormat,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
        commaRoundTrip: !!opts.commaRoundTrip,
        delimiter: typeof opts.delimiter === 'undefined' ? defaults.delimiter : opts.delimiter,
        encode: typeof opts.encode === 'boolean' ? opts.encode : defaults.encode,
        encodeDotInKeys: typeof opts.encodeDotInKeys === 'boolean' ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
        encoder: typeof opts.encoder === 'function' ? opts.encoder : defaults.encoder,
        encodeValuesOnly: typeof opts.encodeValuesOnly === 'boolean' ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
        filter: filter,
        format: format,
        formatter: formatter,
        serializeDate: typeof opts.serializeDate === 'function' ? opts.serializeDate : defaults.serializeDate,
        skipNulls: typeof opts.skipNulls === 'boolean' ? opts.skipNulls : defaults.skipNulls,
        // @ts-ignore
        sort: typeof opts.sort === 'function' ? opts.sort : null,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling,
    };
}
function stringify(object, opts = {}) {
    let obj = object;
    const options = normalize_stringify_options(opts);
    let obj_keys;
    let filter;
    if (typeof options.filter === 'function') {
        filter = options.filter;
        obj = filter('', obj);
    }
    else if ((0, values_1.isArray)(options.filter)) {
        filter = options.filter;
        obj_keys = filter;
    }
    const keys = [];
    if (typeof obj !== 'object' || obj === null) {
        return '';
    }
    const generateArrayPrefix = array_prefix_generators[options.arrayFormat];
    const commaRoundTrip = generateArrayPrefix === 'comma' && options.commaRoundTrip;
    if (!obj_keys) {
        obj_keys = Object.keys(obj);
    }
    if (options.sort) {
        obj_keys.sort(options.sort);
    }
    const sideChannel = new WeakMap();
    for (let i = 0; i < obj_keys.length; ++i) {
        const key = obj_keys[i];
        if (options.skipNulls && obj[key] === null) {
            continue;
        }
        push_to_array(keys, inner_stringify(obj[key], key, 
        // @ts-expect-error
        generateArrayPrefix, commaRoundTrip, options.allowEmptyArrays, options.strictNullHandling, options.skipNulls, options.encodeDotInKeys, options.encode ? options.encoder : null, options.filter, options.sort, options.allowDots, options.serializeDate, options.format, options.formatter, options.encodeValuesOnly, options.charset, sideChannel));
    }
    const joined = keys.join(options.delimiter);
    let prefix = options.addQueryPrefix === true ? '?' : '';
    if (options.charsetSentinel) {
        if (options.charset === 'iso-8859-1') {
            // encodeURIComponent('&#10003;'), the "numeric entity" representation of a checkmark
            prefix += 'utf8=%26%2310003%3B&';
        }
        else {
            // encodeURIComponent('✓')
            prefix += 'utf8=%E2%9C%93&';
        }
    }
    return joined.length > 0 ? prefix + joined : '';
}
//# sourceMappingURL=stringify.js.map

/***/ },

/***/ "./node_modules/openai/internal/qs/utils.js"
/*!**************************************************!*\
  !*** ./node_modules/openai/internal/qs/utils.js ***!
  \**************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.encode = exports.has = void 0;
exports.merge = merge;
exports.assign_single_source = assign_single_source;
exports.decode = decode;
exports.compact = compact;
exports.is_regexp = is_regexp;
exports.is_buffer = is_buffer;
exports.combine = combine;
exports.maybe_map = maybe_map;
const formats_1 = __webpack_require__(/*! ./formats.js */ "./node_modules/openai/internal/qs/formats.js");
const values_1 = __webpack_require__(/*! ../utils/values.js */ "./node_modules/openai/internal/utils/values.js");
let has = (obj, key) => ((exports.has = Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty)),
    (0, exports.has)(obj, key));
exports.has = has;
const hex_table = /* @__PURE__ */ (() => {
    const array = [];
    for (let i = 0; i < 256; ++i) {
        array.push('%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase());
    }
    return array;
})();
function compact_queue(queue) {
    while (queue.length > 1) {
        const item = queue.pop();
        if (!item)
            continue;
        const obj = item.obj[item.prop];
        if ((0, values_1.isArray)(obj)) {
            const compacted = [];
            for (let j = 0; j < obj.length; ++j) {
                if (typeof obj[j] !== 'undefined') {
                    compacted.push(obj[j]);
                }
            }
            // @ts-ignore
            item.obj[item.prop] = compacted;
        }
    }
}
function array_to_object(source, options) {
    const obj = options && options.plainObjects ? Object.create(null) : {};
    for (let i = 0; i < source.length; ++i) {
        if (typeof source[i] !== 'undefined') {
            obj[i] = source[i];
        }
    }
    return obj;
}
function merge(target, source, options = {}) {
    if (!source) {
        return target;
    }
    if (typeof source !== 'object') {
        if ((0, values_1.isArray)(target)) {
            target.push(source);
        }
        else if (target && typeof target === 'object') {
            if ((options && (options.plainObjects || options.allowPrototypes)) || !(0, exports.has)(Object.prototype, source)) {
                target[source] = true;
            }
        }
        else {
            return [target, source];
        }
        return target;
    }
    if (!target || typeof target !== 'object') {
        return [target].concat(source);
    }
    let mergeTarget = target;
    if ((0, values_1.isArray)(target) && !(0, values_1.isArray)(source)) {
        // @ts-ignore
        mergeTarget = array_to_object(target, options);
    }
    if ((0, values_1.isArray)(target) && (0, values_1.isArray)(source)) {
        source.forEach(function (item, i) {
            if ((0, exports.has)(target, i)) {
                const targetItem = target[i];
                if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
                    target[i] = merge(targetItem, item, options);
                }
                else {
                    target.push(item);
                }
            }
            else {
                target[i] = item;
            }
        });
        return target;
    }
    return Object.keys(source).reduce(function (acc, key) {
        const value = source[key];
        if ((0, exports.has)(acc, key)) {
            acc[key] = merge(acc[key], value, options);
        }
        else {
            acc[key] = value;
        }
        return acc;
    }, mergeTarget);
}
function assign_single_source(target, source) {
    return Object.keys(source).reduce(function (acc, key) {
        acc[key] = source[key];
        return acc;
    }, target);
}
function decode(str, _, charset) {
    const strWithoutPlus = str.replace(/\+/g, ' ');
    if (charset === 'iso-8859-1') {
        // unescape never throws, no try...catch needed:
        return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
    }
    // utf-8
    try {
        return decodeURIComponent(strWithoutPlus);
    }
    catch (e) {
        return strWithoutPlus;
    }
}
const limit = 1024;
const encode = (str, _defaultEncoder, charset, _kind, format) => {
    // This code was originally written by Brian White for the io.js core querystring library.
    // It has been adapted here for stricter adherence to RFC 3986
    if (str.length === 0) {
        return str;
    }
    let string = str;
    if (typeof str === 'symbol') {
        string = Symbol.prototype.toString.call(str);
    }
    else if (typeof str !== 'string') {
        string = String(str);
    }
    if (charset === 'iso-8859-1') {
        return escape(string).replace(/%u[0-9a-f]{4}/gi, function ($0) {
            return '%26%23' + parseInt($0.slice(2), 16) + '%3B';
        });
    }
    let out = '';
    for (let j = 0; j < string.length; j += limit) {
        const segment = string.length >= limit ? string.slice(j, j + limit) : string;
        const arr = [];
        for (let i = 0; i < segment.length; ++i) {
            let c = segment.charCodeAt(i);
            if (c === 0x2d || // -
                c === 0x2e || // .
                c === 0x5f || // _
                c === 0x7e || // ~
                (c >= 0x30 && c <= 0x39) || // 0-9
                (c >= 0x41 && c <= 0x5a) || // a-z
                (c >= 0x61 && c <= 0x7a) || // A-Z
                (format === formats_1.RFC1738 && (c === 0x28 || c === 0x29)) // ( )
            ) {
                arr[arr.length] = segment.charAt(i);
                continue;
            }
            if (c < 0x80) {
                arr[arr.length] = hex_table[c];
                continue;
            }
            if (c < 0x800) {
                arr[arr.length] = hex_table[0xc0 | (c >> 6)] + hex_table[0x80 | (c & 0x3f)];
                continue;
            }
            if (c < 0xd800 || c >= 0xe000) {
                arr[arr.length] =
                    hex_table[0xe0 | (c >> 12)] + hex_table[0x80 | ((c >> 6) & 0x3f)] + hex_table[0x80 | (c & 0x3f)];
                continue;
            }
            i += 1;
            c = 0x10000 + (((c & 0x3ff) << 10) | (segment.charCodeAt(i) & 0x3ff));
            arr[arr.length] =
                hex_table[0xf0 | (c >> 18)] +
                    hex_table[0x80 | ((c >> 12) & 0x3f)] +
                    hex_table[0x80 | ((c >> 6) & 0x3f)] +
                    hex_table[0x80 | (c & 0x3f)];
        }
        out += arr.join('');
    }
    return out;
};
exports.encode = encode;
function compact(value) {
    const queue = [{ obj: { o: value }, prop: 'o' }];
    const refs = [];
    for (let i = 0; i < queue.length; ++i) {
        const item = queue[i];
        // @ts-ignore
        const obj = item.obj[item.prop];
        const keys = Object.keys(obj);
        for (let j = 0; j < keys.length; ++j) {
            const key = keys[j];
            const val = obj[key];
            if (typeof val === 'object' && val !== null && refs.indexOf(val) === -1) {
                queue.push({ obj: obj, prop: key });
                refs.push(val);
            }
        }
    }
    compact_queue(queue);
    return value;
}
function is_regexp(obj) {
    return Object.prototype.toString.call(obj) === '[object RegExp]';
}
function is_buffer(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}
function combine(a, b) {
    return [].concat(a, b);
}
function maybe_map(val, fn) {
    if ((0, values_1.isArray)(val)) {
        const mapped = [];
        for (let i = 0; i < val.length; i += 1) {
            mapped.push(fn(val[i]));
        }
        return mapped;
    }
    return fn(val);
}
//# sourceMappingURL=utils.js.map

/***/ },

/***/ "./node_modules/openai/internal/request-options.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/internal/request-options.js ***!
  \*********************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FallbackEncoder = void 0;
const FallbackEncoder = ({ headers, body }) => {
    return {
        bodyHeaders: {
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    };
};
exports.FallbackEncoder = FallbackEncoder;
//# sourceMappingURL=request-options.js.map

/***/ },

/***/ "./node_modules/openai/internal/shims.js"
/*!***********************************************!*\
  !*** ./node_modules/openai/internal/shims.js ***!
  \***********************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getDefaultFetch = getDefaultFetch;
exports.makeReadableStream = makeReadableStream;
exports.ReadableStreamFrom = ReadableStreamFrom;
exports.ReadableStreamToAsyncIterable = ReadableStreamToAsyncIterable;
exports.CancelReadableStream = CancelReadableStream;
function getDefaultFetch() {
    if (typeof fetch !== 'undefined') {
        return fetch;
    }
    throw new Error('`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`');
}
function makeReadableStream(...args) {
    const ReadableStream = globalThis.ReadableStream;
    if (typeof ReadableStream === 'undefined') {
        // Note: All of the platforms / runtimes we officially support already define
        // `ReadableStream` as a global, so this should only ever be hit on unsupported runtimes.
        throw new Error('`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`');
    }
    return new ReadableStream(...args);
}
function ReadableStreamFrom(iterable) {
    let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
    return makeReadableStream({
        start() { },
        async pull(controller) {
            const { done, value } = await iter.next();
            if (done) {
                controller.close();
            }
            else {
                controller.enqueue(value);
            }
        },
        async cancel() {
            await iter.return?.();
        },
    });
}
/**
 * Most browsers don't yet have async iterable support for ReadableStream,
 * and Node has a very different way of reading bytes from its "ReadableStream".
 *
 * This polyfill was pulled from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490
 */
function ReadableStreamToAsyncIterable(stream) {
    if (stream[Symbol.asyncIterator])
        return stream;
    const reader = stream.getReader();
    return {
        async next() {
            try {
                const result = await reader.read();
                if (result?.done)
                    reader.releaseLock(); // release lock when stream becomes closed
                return result;
            }
            catch (e) {
                reader.releaseLock(); // release lock when stream becomes errored
                throw e;
            }
        },
        async return() {
            const cancelPromise = reader.cancel();
            reader.releaseLock();
            await cancelPromise;
            return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}
/**
 * Cancels a ReadableStream we don't need to consume.
 * See https://undici.nodejs.org/#/?id=garbage-collection
 */
async function CancelReadableStream(stream) {
    if (stream === null || typeof stream !== 'object')
        return;
    if (stream[Symbol.asyncIterator]) {
        await stream[Symbol.asyncIterator]().return?.();
        return;
    }
    const reader = stream.getReader();
    const cancelPromise = reader.cancel();
    reader.releaseLock();
    await cancelPromise;
}
//# sourceMappingURL=shims.js.map

/***/ },

/***/ "./node_modules/openai/internal/to-file.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/internal/to-file.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.toFile = toFile;
const uploads_1 = __webpack_require__(/*! ./uploads.js */ "./node_modules/openai/internal/uploads.js");
const uploads_2 = __webpack_require__(/*! ./uploads.js */ "./node_modules/openai/internal/uploads.js");
/**
 * This check adds the arrayBuffer() method type because it is available and used at runtime
 */
const isBlobLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string' &&
    typeof value.text === 'function' &&
    typeof value.slice === 'function' &&
    typeof value.arrayBuffer === 'function';
/**
 * This check adds the arrayBuffer() method type because it is available and used at runtime
 */
const isFileLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.lastModified === 'number' &&
    isBlobLike(value);
const isResponseLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.url === 'string' &&
    typeof value.blob === 'function';
/**
 * Helper for creating a {@link File} to pass to an SDK upload method from a variety of different data formats
 * @param value the raw content of the file. Can be an {@link Uploadable}, BlobLikePart, or AsyncIterable of BlobLikeParts
 * @param {string=} name the name of the file. If omitted, toFile will try to determine a file name from bits if possible
 * @param {Object=} options additional properties
 * @param {string=} options.type the MIME type of the content
 * @param {number=} options.lastModified the last modified timestamp
 * @returns a {@link File} with the given properties
 */
async function toFile(value, name, options) {
    (0, uploads_2.checkFileSupport)();
    // If it's a promise, resolve it.
    value = await value;
    // If we've been given a `File` we don't need to do anything
    if (isFileLike(value)) {
        if (value instanceof File) {
            return value;
        }
        return (0, uploads_1.makeFile)([await value.arrayBuffer()], value.name);
    }
    if (isResponseLike(value)) {
        const blob = await value.blob();
        name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
        return (0, uploads_1.makeFile)(await getBytes(blob), name, options);
    }
    const parts = await getBytes(value);
    name || (name = (0, uploads_1.getName)(value));
    if (!options?.type) {
        const type = parts.find((part) => typeof part === 'object' && 'type' in part && part.type);
        if (typeof type === 'string') {
            options = { ...options, type };
        }
    }
    return (0, uploads_1.makeFile)(parts, name, options);
}
async function getBytes(value) {
    let parts = [];
    if (typeof value === 'string' ||
        ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
        value instanceof ArrayBuffer) {
        parts.push(value);
    }
    else if (isBlobLike(value)) {
        parts.push(value instanceof Blob ? value : await value.arrayBuffer());
    }
    else if ((0, uploads_1.isAsyncIterable)(value) // includes Readable, ReadableStream, etc.
    ) {
        for await (const chunk of value) {
            parts.push(...(await getBytes(chunk))); // TODO, consider validating?
        }
    }
    else {
        const constructor = value?.constructor?.name;
        throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ''}${propsForError(value)}`);
    }
    return parts;
}
function propsForError(value) {
    if (typeof value !== 'object' || value === null)
        return '';
    const props = Object.getOwnPropertyNames(value);
    return `; props: [${props.map((p) => `"${p}"`).join(', ')}]`;
}
//# sourceMappingURL=to-file.js.map

/***/ },

/***/ "./node_modules/openai/internal/tslib.js"
/*!***********************************************!*\
  !*** ./node_modules/openai/internal/tslib.js ***!
  \***********************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.__setModuleDefault = exports.__createBinding = void 0;
exports.__classPrivateFieldSet = __classPrivateFieldSet;
exports.__classPrivateFieldGet = __classPrivateFieldGet;
exports.__exportStar = __exportStar;
exports.__importStar = __importStar;
function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m")
        throw new TypeError("Private method is not writable");
    if (kind === "a" && !f)
        throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
        throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? (f.value = value) : state.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f)
        throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
        throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
var __createBinding = Object.create
    ? function (o, m, k, k2) {
        if (k2 === void 0)
            k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
            desc = {
                enumerable: true,
                get: function () {
                    return m[k];
                },
            };
        }
        Object.defineProperty(o, k2, desc);
    }
    : function (o, m, k, k2) {
        if (k2 === void 0)
            k2 = k;
        o[k2] = m[k];
    };
exports.__createBinding = __createBinding;
function __exportStar(m, o) {
    for (var p in m)
        if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p))
            __createBinding(o, m, p);
}
var __setModuleDefault = Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
    }
    : function (o, v) {
        o["default"] = v;
    };
exports.__setModuleDefault = __setModuleDefault;
var ownKeys = function (o) {
    ownKeys =
        Object.getOwnPropertyNames ||
            function (o2) {
                var ar = [];
                for (var k in o2)
                    if (Object.prototype.hasOwnProperty.call(o2, k))
                        ar[ar.length] = k;
                return ar;
            };
    return ownKeys(o);
};
function __importStar(mod) {
    if (mod && mod.__esModule)
        return mod;
    var result = {};
    if (mod != null) {
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
            if (k[i] !== "default")
                __createBinding(result, mod, k[i]);
    }
    __setModuleDefault(result, mod);
    return result;
}


/***/ },

/***/ "./node_modules/openai/internal/uploads.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/internal/uploads.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.createForm = exports.multipartFormRequestOptions = exports.maybeMultipartFormRequestOptions = exports.isAsyncIterable = exports.checkFileSupport = void 0;
exports.makeFile = makeFile;
exports.getName = getName;
const shims_1 = __webpack_require__(/*! ./shims.js */ "./node_modules/openai/internal/shims.js");
const checkFileSupport = () => {
    if (typeof File === 'undefined') {
        const { process } = globalThis;
        const isOldNode = typeof process?.versions?.node === 'string' && parseInt(process.versions.node.split('.')) < 20;
        throw new Error('`File` is not defined as a global, which is required for file uploads.' +
            (isOldNode ?
                " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`."
                : ''));
    }
};
exports.checkFileSupport = checkFileSupport;
/**
 * Construct a `File` instance. This is used to ensure a helpful error is thrown
 * for environments that don't define a global `File` yet.
 */
function makeFile(fileBits, fileName, options) {
    (0, exports.checkFileSupport)();
    return new File(fileBits, fileName ?? 'unknown_file', options);
}
function getName(value) {
    return (((typeof value === 'object' &&
        value !== null &&
        (('name' in value && value.name && String(value.name)) ||
            ('url' in value && value.url && String(value.url)) ||
            ('filename' in value && value.filename && String(value.filename)) ||
            ('path' in value && value.path && String(value.path)))) ||
        '')
        .split(/[\\/]/)
        .pop() || undefined);
}
const isAsyncIterable = (value) => value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
exports.isAsyncIterable = isAsyncIterable;
/**
 * Returns a multipart/form-data request if any part of the given request body contains a File / Blob value.
 * Otherwise returns the request as is.
 */
const maybeMultipartFormRequestOptions = async (opts, fetch) => {
    if (!hasUploadableValue(opts.body))
        return opts;
    return { ...opts, body: await (0, exports.createForm)(opts.body, fetch) };
};
exports.maybeMultipartFormRequestOptions = maybeMultipartFormRequestOptions;
const multipartFormRequestOptions = async (opts, fetch) => {
    return { ...opts, body: await (0, exports.createForm)(opts.body, fetch) };
};
exports.multipartFormRequestOptions = multipartFormRequestOptions;
const supportsFormDataMap = /* @__PURE__ */ new WeakMap();
/**
 * node-fetch doesn't support the global FormData object in recent node versions. Instead of sending
 * properly-encoded form data, it just stringifies the object, resulting in a request body of "[object FormData]".
 * This function detects if the fetch function provided supports the global FormData object to avoid
 * confusing error messages later on.
 */
function supportsFormData(fetchObject) {
    const fetch = typeof fetchObject === 'function' ? fetchObject : fetchObject.fetch;
    const cached = supportsFormDataMap.get(fetch);
    if (cached)
        return cached;
    const promise = (async () => {
        try {
            const FetchResponse = ('Response' in fetch ?
                fetch.Response
                : (await fetch('data:,')).constructor);
            const data = new FormData();
            if (data.toString() === (await new FetchResponse(data).text())) {
                return false;
            }
            return true;
        }
        catch {
            // avoid false negatives
            return true;
        }
    })();
    supportsFormDataMap.set(fetch, promise);
    return promise;
}
const createForm = async (body, fetch) => {
    if (!(await supportsFormData(fetch))) {
        throw new TypeError('The provided fetch function does not support file uploads with the current global FormData class.');
    }
    const form = new FormData();
    await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
    return form;
};
exports.createForm = createForm;
// We check for Blob not File because Bun.File doesn't inherit from File,
// but they both inherit from Blob and have a `name` property at runtime.
const isNamedBlob = (value) => value instanceof Blob && 'name' in value;
const isUploadable = (value) => typeof value === 'object' &&
    value !== null &&
    (value instanceof Response || (0, exports.isAsyncIterable)(value) || isNamedBlob(value));
const hasUploadableValue = (value) => {
    if (isUploadable(value))
        return true;
    if (Array.isArray(value))
        return value.some(hasUploadableValue);
    if (value && typeof value === 'object') {
        for (const k in value) {
            if (hasUploadableValue(value[k]))
                return true;
        }
    }
    return false;
};
const addFormValue = async (form, key, value) => {
    if (value === undefined)
        return;
    if (value == null) {
        throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
    }
    // TODO: make nested formats configurable
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        form.append(key, String(value));
    }
    else if (value instanceof Response) {
        form.append(key, makeFile([await value.blob()], getName(value)));
    }
    else if ((0, exports.isAsyncIterable)(value)) {
        form.append(key, makeFile([await new Response((0, shims_1.ReadableStreamFrom)(value)).blob()], getName(value)));
    }
    else if (isNamedBlob(value)) {
        form.append(key, value, getName(value));
    }
    else if (Array.isArray(value)) {
        await Promise.all(value.map((entry) => addFormValue(form, key + '[]', entry)));
    }
    else if (typeof value === 'object') {
        await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
    }
    else {
        throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
    }
};
//# sourceMappingURL=uploads.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils.js"
/*!***********************************************!*\
  !*** ./node_modules/openai/internal/utils.js ***!
  \***********************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
const tslib_1 = __webpack_require__(/*! ./tslib.js */ "./node_modules/openai/internal/tslib.js");
tslib_1.__exportStar(__webpack_require__(/*! ./utils/values.js */ "./node_modules/openai/internal/utils/values.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./utils/base64.js */ "./node_modules/openai/internal/utils/base64.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./utils/env.js */ "./node_modules/openai/internal/utils/env.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./utils/log.js */ "./node_modules/openai/internal/utils/log.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./utils/uuid.js */ "./node_modules/openai/internal/utils/uuid.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./utils/sleep.js */ "./node_modules/openai/internal/utils/sleep.js"), exports);
//# sourceMappingURL=utils.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/base64.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/internal/utils/base64.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.toFloat32Array = exports.fromBase64 = exports.toBase64 = void 0;
const error_1 = __webpack_require__(/*! ../../core/error.js */ "./node_modules/openai/core/error.js");
const bytes_1 = __webpack_require__(/*! ./bytes.js */ "./node_modules/openai/internal/utils/bytes.js");
const toBase64 = (data) => {
    if (!data)
        return '';
    if (typeof globalThis.Buffer !== 'undefined') {
        return globalThis.Buffer.from(data).toString('base64');
    }
    if (typeof data === 'string') {
        data = (0, bytes_1.encodeUTF8)(data);
    }
    if (typeof btoa !== 'undefined') {
        return btoa(String.fromCharCode.apply(null, data));
    }
    throw new error_1.OpenAIError('Cannot generate base64 string; Expected `Buffer` or `btoa` to be defined');
};
exports.toBase64 = toBase64;
const fromBase64 = (str) => {
    if (typeof globalThis.Buffer !== 'undefined') {
        const buf = globalThis.Buffer.from(str, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    if (typeof atob !== 'undefined') {
        const bstr = atob(str);
        const buf = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) {
            buf[i] = bstr.charCodeAt(i);
        }
        return buf;
    }
    throw new error_1.OpenAIError('Cannot decode base64 string; Expected `Buffer` or `atob` to be defined');
};
exports.fromBase64 = fromBase64;
/**
 * Converts a Base64 encoded string to a Float32Array.
 * @param base64Str - The Base64 encoded string.
 * @returns An Array of numbers interpreted as Float32 values.
 */
const toFloat32Array = (base64Str) => {
    if (typeof Buffer !== 'undefined') {
        // for Node.js environment
        const buf = Buffer.from(base64Str, 'base64');
        return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT));
    }
    else {
        // for legacy web platform APIs
        const binaryStr = atob(base64Str);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return Array.from(new Float32Array(bytes.buffer));
    }
};
exports.toFloat32Array = toFloat32Array;
//# sourceMappingURL=base64.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/bytes.js"
/*!*****************************************************!*\
  !*** ./node_modules/openai/internal/utils/bytes.js ***!
  \*****************************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.concatBytes = concatBytes;
exports.encodeUTF8 = encodeUTF8;
exports.decodeUTF8 = decodeUTF8;
function concatBytes(buffers) {
    let length = 0;
    for (const buffer of buffers) {
        length += buffer.length;
    }
    const output = new Uint8Array(length);
    let index = 0;
    for (const buffer of buffers) {
        output.set(buffer, index);
        index += buffer.length;
    }
    return output;
}
let encodeUTF8_;
function encodeUTF8(str) {
    let encoder;
    return (encodeUTF8_ ??
        ((encoder = new globalThis.TextEncoder()), (encodeUTF8_ = encoder.encode.bind(encoder))))(str);
}
let decodeUTF8_;
function decodeUTF8(bytes) {
    let decoder;
    return (decodeUTF8_ ??
        ((decoder = new globalThis.TextDecoder()), (decodeUTF8_ = decoder.decode.bind(decoder))))(bytes);
}
//# sourceMappingURL=bytes.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/env.js"
/*!***************************************************!*\
  !*** ./node_modules/openai/internal/utils/env.js ***!
  \***************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readEnv = void 0;
/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
const readEnv = (env) => {
    if (typeof globalThis.process !== 'undefined') {
        return globalThis.process.env?.[env]?.trim() ?? undefined;
    }
    if (typeof globalThis.Deno !== 'undefined') {
        return globalThis.Deno.env?.get?.(env)?.trim();
    }
    return undefined;
};
exports.readEnv = readEnv;
//# sourceMappingURL=env.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/log.js"
/*!***************************************************!*\
  !*** ./node_modules/openai/internal/utils/log.js ***!
  \***************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.formatRequestDetails = exports.parseLogLevel = void 0;
exports.loggerFor = loggerFor;
const values_1 = __webpack_require__(/*! ./values.js */ "./node_modules/openai/internal/utils/values.js");
const levelNumbers = {
    off: 0,
    error: 200,
    warn: 300,
    info: 400,
    debug: 500,
};
const parseLogLevel = (maybeLevel, sourceName, client) => {
    if (!maybeLevel) {
        return undefined;
    }
    if ((0, values_1.hasOwn)(levelNumbers, maybeLevel)) {
        return maybeLevel;
    }
    loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
    return undefined;
};
exports.parseLogLevel = parseLogLevel;
function noop() { }
function makeLogFn(fnLevel, logger, logLevel) {
    if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
        return noop;
    }
    else {
        // Don't wrap logger functions, we want the stacktrace intact!
        return logger[fnLevel].bind(logger);
    }
}
const noopLogger = {
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
};
let cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
    const logger = client.logger;
    const logLevel = client.logLevel ?? 'off';
    if (!logger) {
        return noopLogger;
    }
    const cachedLogger = cachedLoggers.get(logger);
    if (cachedLogger && cachedLogger[0] === logLevel) {
        return cachedLogger[1];
    }
    const levelLogger = {
        error: makeLogFn('error', logger, logLevel),
        warn: makeLogFn('warn', logger, logLevel),
        info: makeLogFn('info', logger, logLevel),
        debug: makeLogFn('debug', logger, logLevel),
    };
    cachedLoggers.set(logger, [logLevel, levelLogger]);
    return levelLogger;
}
const formatRequestDetails = (details) => {
    if (details.options) {
        details.options = { ...details.options };
        delete details.options['headers']; // redundant + leaks internals
    }
    if (details.headers) {
        details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [
            name,
            (name.toLowerCase() === 'authorization' ||
                name.toLowerCase() === 'cookie' ||
                name.toLowerCase() === 'set-cookie') ?
                '***'
                : value,
        ]));
    }
    if ('retryOfRequestLogID' in details) {
        if (details.retryOfRequestLogID) {
            details.retryOf = details.retryOfRequestLogID;
        }
        delete details.retryOfRequestLogID;
    }
    return details;
};
exports.formatRequestDetails = formatRequestDetails;
//# sourceMappingURL=log.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/path.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/internal/utils/path.js ***!
  \****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.path = exports.createPathTagFunction = void 0;
exports.encodeURIPath = encodeURIPath;
const error_1 = __webpack_require__(/*! ../../core/error.js */ "./node_modules/openai/core/error.js");
/**
 * Percent-encode everything that isn't safe to have in a path without encoding safe chars.
 *
 * Taken from https://datatracker.ietf.org/doc/html/rfc3986#section-3.3:
 * > unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * > sub-delims  = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
 * > pchar       = unreserved / pct-encoded / sub-delims / ":" / "@"
 */
function encodeURIPath(str) {
    return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
const EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
const createPathTagFunction = (pathEncoder = encodeURIPath) => function path(statics, ...params) {
    // If there are no params, no processing is needed.
    if (statics.length === 1)
        return statics[0];
    let postPath = false;
    const invalidSegments = [];
    const path = statics.reduce((previousValue, currentValue, index) => {
        if (/[?#]/.test(currentValue)) {
            postPath = true;
        }
        const value = params[index];
        let encoded = (postPath ? encodeURIComponent : pathEncoder)('' + value);
        if (index !== params.length &&
            (value == null ||
                (typeof value === 'object' &&
                    // handle values from other realms
                    value.toString ===
                        Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)
                            ?.toString))) {
            encoded = value + '';
            invalidSegments.push({
                start: previousValue.length + currentValue.length,
                length: encoded.length,
                error: `Value of type ${Object.prototype.toString
                    .call(value)
                    .slice(8, -1)} is not a valid path parameter`,
            });
        }
        return previousValue + currentValue + (index === params.length ? '' : encoded);
    }, '');
    const pathOnly = path.split(/[?#]/, 1)[0];
    const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
    let match;
    // Find all invalid segments
    while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
        invalidSegments.push({
            start: match.index,
            length: match[0].length,
            error: `Value "${match[0]}" can\'t be safely passed as a path parameter`,
        });
    }
    invalidSegments.sort((a, b) => a.start - b.start);
    if (invalidSegments.length > 0) {
        let lastEnd = 0;
        const underline = invalidSegments.reduce((acc, segment) => {
            const spaces = ' '.repeat(segment.start - lastEnd);
            const arrows = '^'.repeat(segment.length);
            lastEnd = segment.start + segment.length;
            return acc + spaces + arrows;
        }, '');
        throw new error_1.OpenAIError(`Path parameters result in path with invalid segments:\n${invalidSegments
            .map((e) => e.error)
            .join('\n')}\n${path}\n${underline}`);
    }
    return path;
};
exports.createPathTagFunction = createPathTagFunction;
/**
 * URI-encodes path params and ensures no unsafe /./ or /../ path segments are introduced.
 */
exports.path = (0, exports.createPathTagFunction)(encodeURIPath);
//# sourceMappingURL=path.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/sleep.js"
/*!*****************************************************!*\
  !*** ./node_modules/openai/internal/utils/sleep.js ***!
  \*****************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.sleep = void 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.sleep = sleep;
//# sourceMappingURL=sleep.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/uuid.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/internal/utils/uuid.js ***!
  \****************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.uuid4 = void 0;
/**
 * https://stackoverflow.com/a/2117523
 */
let uuid4 = function () {
    const { crypto } = globalThis;
    if (crypto?.randomUUID) {
        exports.uuid4 = crypto.randomUUID.bind(crypto);
        return crypto.randomUUID();
    }
    const u8 = new Uint8Array(1);
    const randomByte = crypto ? () => crypto.getRandomValues(u8)[0] : () => (Math.random() * 0xff) & 0xff;
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ (randomByte() & (15 >> (+c / 4)))).toString(16));
};
exports.uuid4 = uuid4;
//# sourceMappingURL=uuid.js.map

/***/ },

/***/ "./node_modules/openai/internal/utils/values.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/internal/utils/values.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.safeJSON = exports.maybeCoerceBoolean = exports.maybeCoerceFloat = exports.maybeCoerceInteger = exports.coerceBoolean = exports.coerceFloat = exports.coerceInteger = exports.validatePositiveInteger = exports.ensurePresent = exports.isReadonlyArray = exports.isArray = exports.isAbsoluteURL = void 0;
exports.maybeObj = maybeObj;
exports.isEmptyObj = isEmptyObj;
exports.hasOwn = hasOwn;
exports.isObj = isObj;
const error_1 = __webpack_require__(/*! ../../core/error.js */ "./node_modules/openai/core/error.js");
// https://url.spec.whatwg.org/#url-scheme-string
const startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
const isAbsoluteURL = (url) => {
    return startsWithSchemeRegexp.test(url);
};
exports.isAbsoluteURL = isAbsoluteURL;
let isArray = (val) => ((exports.isArray = Array.isArray), (0, exports.isArray)(val));
exports.isArray = isArray;
exports.isReadonlyArray = exports.isArray;
/** Returns an object if the given value isn't an object, otherwise returns as-is */
function maybeObj(x) {
    if (typeof x !== 'object') {
        return {};
    }
    return x ?? {};
}
// https://stackoverflow.com/a/34491287
function isEmptyObj(obj) {
    if (!obj)
        return true;
    for (const _k in obj)
        return false;
    return true;
}
// https://eslint.org/docs/latest/rules/no-prototype-builtins
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function isObj(obj) {
    return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}
const ensurePresent = (value) => {
    if (value == null) {
        throw new error_1.OpenAIError(`Expected a value to be given but received ${value} instead.`);
    }
    return value;
};
exports.ensurePresent = ensurePresent;
const validatePositiveInteger = (name, n) => {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
        throw new error_1.OpenAIError(`${name} must be an integer`);
    }
    if (n < 0) {
        throw new error_1.OpenAIError(`${name} must be a positive integer`);
    }
    return n;
};
exports.validatePositiveInteger = validatePositiveInteger;
const coerceInteger = (value) => {
    if (typeof value === 'number')
        return Math.round(value);
    if (typeof value === 'string')
        return parseInt(value, 10);
    throw new error_1.OpenAIError(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};
exports.coerceInteger = coerceInteger;
const coerceFloat = (value) => {
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string')
        return parseFloat(value);
    throw new error_1.OpenAIError(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};
exports.coerceFloat = coerceFloat;
const coerceBoolean = (value) => {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return value === 'true';
    return Boolean(value);
};
exports.coerceBoolean = coerceBoolean;
const maybeCoerceInteger = (value) => {
    if (value == null) {
        return undefined;
    }
    return (0, exports.coerceInteger)(value);
};
exports.maybeCoerceInteger = maybeCoerceInteger;
const maybeCoerceFloat = (value) => {
    if (value == null) {
        return undefined;
    }
    return (0, exports.coerceFloat)(value);
};
exports.maybeCoerceFloat = maybeCoerceFloat;
const maybeCoerceBoolean = (value) => {
    if (value == null) {
        return undefined;
    }
    return (0, exports.coerceBoolean)(value);
};
exports.maybeCoerceBoolean = maybeCoerceBoolean;
const safeJSON = (text) => {
    try {
        return JSON.parse(text);
    }
    catch (err) {
        return undefined;
    }
};
exports.safeJSON = safeJSON;
//# sourceMappingURL=values.js.map

/***/ },

/***/ "./node_modules/openai/lib/AbstractChatCompletionRunner.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/lib/AbstractChatCompletionRunner.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _AbstractChatCompletionRunner_instances, _AbstractChatCompletionRunner_getFinalContent, _AbstractChatCompletionRunner_getFinalMessage, _AbstractChatCompletionRunner_getFinalFunctionToolCall, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult, _AbstractChatCompletionRunner_calculateTotalUsage, _AbstractChatCompletionRunner_validateParams, _AbstractChatCompletionRunner_stringifyFunctionCallResult;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AbstractChatCompletionRunner = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const parser_1 = __webpack_require__(/*! ../lib/parser.js */ "./node_modules/openai/lib/parser.js");
const chatCompletionUtils_1 = __webpack_require__(/*! ./chatCompletionUtils.js */ "./node_modules/openai/lib/chatCompletionUtils.js");
const EventStream_1 = __webpack_require__(/*! ./EventStream.js */ "./node_modules/openai/lib/EventStream.js");
const RunnableFunction_1 = __webpack_require__(/*! ./RunnableFunction.js */ "./node_modules/openai/lib/RunnableFunction.js");
const DEFAULT_MAX_CHAT_COMPLETIONS = 10;
class AbstractChatCompletionRunner extends EventStream_1.EventStream {
    constructor() {
        super(...arguments);
        _AbstractChatCompletionRunner_instances.add(this);
        this._chatCompletions = [];
        this.messages = [];
    }
    _addChatCompletion(chatCompletion) {
        this._chatCompletions.push(chatCompletion);
        this._emit('chatCompletion', chatCompletion);
        const message = chatCompletion.choices[0]?.message;
        if (message)
            this._addMessage(message);
        return chatCompletion;
    }
    _addMessage(message, emit = true) {
        if (!('content' in message))
            message.content = null;
        this.messages.push(message);
        if (emit) {
            this._emit('message', message);
            if ((0, chatCompletionUtils_1.isToolMessage)(message) && message.content) {
                // Note, this assumes that {role: 'tool', content: …} is always the result of a call of tool of type=function.
                this._emit('functionToolCallResult', message.content);
            }
            else if ((0, chatCompletionUtils_1.isAssistantMessage)(message) && message.tool_calls) {
                for (const tool_call of message.tool_calls) {
                    if (tool_call.type === 'function') {
                        this._emit('functionToolCall', tool_call.function);
                    }
                }
            }
        }
    }
    /**
     * @returns a promise that resolves with the final ChatCompletion, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
     */
    async finalChatCompletion() {
        await this.done();
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (!completion)
            throw new error_1.OpenAIError('stream ended without producing a ChatCompletion');
        return completion;
    }
    /**
     * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalContent() {
        await this.done();
        return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    }
    /**
     * @returns a promise that resolves with the the final assistant ChatCompletionMessage response,
     * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalMessage() {
        await this.done();
        return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    }
    /**
     * @returns a promise that resolves with the content of the final FunctionCall, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalFunctionToolCall() {
        await this.done();
        return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
    }
    async finalFunctionToolCallResult() {
        await this.done();
        return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
    }
    async totalUsage() {
        await this.done();
        return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
    }
    allChatCompletions() {
        return [...this._chatCompletions];
    }
    _emitFinal() {
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (completion)
            this._emit('finalChatCompletion', completion);
        const finalMessage = tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
        if (finalMessage)
            this._emit('finalMessage', finalMessage);
        const finalContent = tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
        if (finalContent)
            this._emit('finalContent', finalContent);
        const finalFunctionCall = tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
        if (finalFunctionCall)
            this._emit('finalFunctionToolCall', finalFunctionCall);
        const finalFunctionCallResult = tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
        if (finalFunctionCallResult != null)
            this._emit('finalFunctionToolCallResult', finalFunctionCallResult);
        if (this._chatCompletions.some((c) => c.usage)) {
            this._emit('totalUsage', tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
        }
    }
    async _createChatCompletion(client, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_validateParams).call(this, params);
        const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
        this._connected();
        return this._addChatCompletion((0, parser_1.parseChatCompletion)(chatCompletion, params));
    }
    async _runChatCompletion(client, params, options) {
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        return await this._createChatCompletion(client, params, options);
    }
    async _runTools(client, params, options) {
        const role = 'tool';
        const { tool_choice = 'auto', stream, ...restParams } = params;
        const singleFunctionToCall = typeof tool_choice !== 'string' && tool_choice.type === 'function' && tool_choice?.function?.name;
        const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS } = options || {};
        // TODO(someday): clean this logic up
        const inputTools = params.tools.map((tool) => {
            if ((0, parser_1.isAutoParsableTool)(tool)) {
                if (!tool.$callback) {
                    throw new error_1.OpenAIError('Tool given to `.runTools()` that does not have an associated function');
                }
                return {
                    type: 'function',
                    function: {
                        function: tool.$callback,
                        name: tool.function.name,
                        description: tool.function.description || '',
                        parameters: tool.function.parameters,
                        parse: tool.$parseRaw,
                        strict: true,
                    },
                };
            }
            return tool;
        });
        const functionsByName = {};
        for (const f of inputTools) {
            if (f.type === 'function') {
                functionsByName[f.function.name || f.function.function.name] = f.function;
            }
        }
        const tools = 'tools' in params ?
            inputTools.map((t) => t.type === 'function' ?
                {
                    type: 'function',
                    function: {
                        name: t.function.name || t.function.function.name,
                        parameters: t.function.parameters,
                        description: t.function.description,
                        strict: t.function.strict,
                    },
                }
                : t)
            : undefined;
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        for (let i = 0; i < maxChatCompletions; ++i) {
            const chatCompletion = await this._createChatCompletion(client, {
                ...restParams,
                tool_choice,
                tools,
                messages: [...this.messages],
            }, options);
            const message = chatCompletion.choices[0]?.message;
            if (!message) {
                throw new error_1.OpenAIError(`missing message in ChatCompletion response`);
            }
            if (!message.tool_calls?.length) {
                return;
            }
            for (const tool_call of message.tool_calls) {
                if (tool_call.type !== 'function')
                    continue;
                const tool_call_id = tool_call.id;
                const { name, arguments: args } = tool_call.function;
                const fn = functionsByName[name];
                if (!fn) {
                    const content = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName)
                        .map((name) => JSON.stringify(name))
                        .join(', ')}. Please try again`;
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                else if (singleFunctionToCall && singleFunctionToCall !== name) {
                    const content = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                let parsed;
                try {
                    parsed = (0, RunnableFunction_1.isRunnableFunctionWithParse)(fn) ? await fn.parse(args) : args;
                }
                catch (error) {
                    const content = error instanceof Error ? error.message : String(error);
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                // @ts-expect-error it can't rule out `never` type.
                const rawContent = await fn.function(parsed, this);
                const content = tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
                this._addMessage({ role, tool_call_id, content });
                if (singleFunctionToCall) {
                    return;
                }
            }
        }
        return;
    }
}
exports.AbstractChatCompletionRunner = AbstractChatCompletionRunner;
_AbstractChatCompletionRunner_instances = new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent() {
    return tslib_1.__classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage() {
    let i = this.messages.length;
    while (i-- > 0) {
        const message = this.messages[i];
        if ((0, chatCompletionUtils_1.isAssistantMessage)(message)) {
            // TODO: support audio here
            const ret = {
                ...message,
                content: message.content ?? null,
                refusal: message.refusal ?? null,
            };
            return ret;
        }
    }
    throw new error_1.OpenAIError('stream ended without producing a ChatCompletionMessage with role=assistant');
}, _AbstractChatCompletionRunner_getFinalFunctionToolCall = function _AbstractChatCompletionRunner_getFinalFunctionToolCall() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if ((0, chatCompletionUtils_1.isAssistantMessage)(message) && message?.tool_calls?.length) {
            return message.tool_calls.filter((x) => x.type === 'function').at(-1)?.function;
        }
    }
    return;
}, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult = function _AbstractChatCompletionRunner_getFinalFunctionToolCallResult() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if ((0, chatCompletionUtils_1.isToolMessage)(message) &&
            message.content != null &&
            typeof message.content === 'string' &&
            this.messages.some((x) => x.role === 'assistant' &&
                x.tool_calls?.some((y) => y.type === 'function' && y.id === message.tool_call_id))) {
            return message.content;
        }
    }
    return;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage() {
    const total = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };
    for (const { usage } of this._chatCompletions) {
        if (usage) {
            total.completion_tokens += usage.completion_tokens;
            total.prompt_tokens += usage.prompt_tokens;
            total.total_tokens += usage.total_tokens;
        }
    }
    return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams(params) {
    if (params.n != null && params.n > 1) {
        throw new error_1.OpenAIError('ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.');
    }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult(rawContent) {
    return (typeof rawContent === 'string' ? rawContent
        : rawContent === undefined ? 'undefined'
            : JSON.stringify(rawContent));
};
//# sourceMappingURL=AbstractChatCompletionRunner.js.map

/***/ },

/***/ "./node_modules/openai/lib/AssistantStream.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/lib/AssistantStream.js ***!
  \****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _AssistantStream_instances, _a, _AssistantStream_events, _AssistantStream_runStepSnapshots, _AssistantStream_messageSnapshots, _AssistantStream_messageSnapshot, _AssistantStream_finalRun, _AssistantStream_currentContentIndex, _AssistantStream_currentContent, _AssistantStream_currentToolCallIndex, _AssistantStream_currentToolCall, _AssistantStream_currentEvent, _AssistantStream_currentRunSnapshot, _AssistantStream_currentRunStepSnapshot, _AssistantStream_addEvent, _AssistantStream_endRequest, _AssistantStream_handleMessage, _AssistantStream_handleRunStep, _AssistantStream_handleEvent, _AssistantStream_accumulateRunStep, _AssistantStream_accumulateMessage, _AssistantStream_accumulateContent, _AssistantStream_handleRun;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AssistantStream = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const streaming_1 = __webpack_require__(/*! ../streaming.js */ "./node_modules/openai/streaming.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const EventStream_1 = __webpack_require__(/*! ./EventStream.js */ "./node_modules/openai/lib/EventStream.js");
const utils_1 = __webpack_require__(/*! ../internal/utils.js */ "./node_modules/openai/internal/utils.js");
class AssistantStream extends EventStream_1.EventStream {
    constructor() {
        super(...arguments);
        _AssistantStream_instances.add(this);
        //Track all events in a single list for reference
        _AssistantStream_events.set(this, []);
        //Used to accumulate deltas
        //We are accumulating many types so the value here is not strict
        _AssistantStream_runStepSnapshots.set(this, {});
        _AssistantStream_messageSnapshots.set(this, {});
        _AssistantStream_messageSnapshot.set(this, void 0);
        _AssistantStream_finalRun.set(this, void 0);
        _AssistantStream_currentContentIndex.set(this, void 0);
        _AssistantStream_currentContent.set(this, void 0);
        _AssistantStream_currentToolCallIndex.set(this, void 0);
        _AssistantStream_currentToolCall.set(this, void 0);
        //For current snapshot methods
        _AssistantStream_currentEvent.set(this, void 0);
        _AssistantStream_currentRunSnapshot.set(this, void 0);
        _AssistantStream_currentRunStepSnapshot.set(this, void 0);
    }
    [(_AssistantStream_events = new WeakMap(), _AssistantStream_runStepSnapshots = new WeakMap(), _AssistantStream_messageSnapshots = new WeakMap(), _AssistantStream_messageSnapshot = new WeakMap(), _AssistantStream_finalRun = new WeakMap(), _AssistantStream_currentContentIndex = new WeakMap(), _AssistantStream_currentContent = new WeakMap(), _AssistantStream_currentToolCallIndex = new WeakMap(), _AssistantStream_currentToolCall = new WeakMap(), _AssistantStream_currentEvent = new WeakMap(), _AssistantStream_currentRunSnapshot = new WeakMap(), _AssistantStream_currentRunStepSnapshot = new WeakMap(), _AssistantStream_instances = new WeakSet(), Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        //Catch all for passing along all events
        this.on('event', (event) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(event);
            }
            else {
                pushQueue.push(event);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }));
                }
                const chunk = pushQueue.shift();
                return { value: chunk, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    static fromReadableStream(stream) {
        const runner = new _a();
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    async _fromReadableStream(readableStream, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        this._connected();
        const stream = streaming_1.Stream.fromReadableStream(readableStream, this.controller);
        for await (const event of stream) {
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addRun(tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    toReadableStream() {
        const stream = new streaming_1.Stream(this[Symbol.asyncIterator].bind(this), this.controller);
        return stream.toReadableStream();
    }
    static createToolAssistantStream(runId, runs, params, options) {
        const runner = new _a();
        runner._run(() => runner._runToolAssistantStream(runId, runs, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    async _createToolAssistantStream(run, runId, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await run.submitToolOutputs(runId, body, {
            ...options,
            signal: this.controller.signal,
        });
        this._connected();
        for await (const event of stream) {
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addRun(tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    static createThreadAssistantStream(params, thread, options) {
        const runner = new _a();
        runner._run(() => runner._threadAssistantStream(params, thread, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    static createAssistantStream(threadId, runs, params, options) {
        const runner = new _a();
        runner._run(() => runner._runAssistantStream(threadId, runs, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    currentEvent() {
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentEvent, "f");
    }
    currentRun() {
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentRunSnapshot, "f");
    }
    currentMessageSnapshot() {
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f");
    }
    currentRunStepSnapshot() {
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f");
    }
    async finalRunSteps() {
        await this.done();
        return Object.values(tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"));
    }
    async finalMessages() {
        await this.done();
        return Object.values(tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f"));
    }
    async finalRun() {
        await this.done();
        if (!tslib_1.__classPrivateFieldGet(this, _AssistantStream_finalRun, "f"))
            throw Error('Final run was not received.');
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
    }
    async _createThreadAssistantStream(thread, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const event of stream) {
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addRun(tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    async _createAssistantStream(run, threadId, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const event of stream) {
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addRun(tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    static accumulateDelta(acc, delta) {
        for (const [key, deltaValue] of Object.entries(delta)) {
            if (!acc.hasOwnProperty(key)) {
                acc[key] = deltaValue;
                continue;
            }
            let accValue = acc[key];
            if (accValue === null || accValue === undefined) {
                acc[key] = deltaValue;
                continue;
            }
            // We don't accumulate these special properties
            if (key === 'index' || key === 'type') {
                acc[key] = deltaValue;
                continue;
            }
            // Type-specific accumulation logic
            if (typeof accValue === 'string' && typeof deltaValue === 'string') {
                accValue += deltaValue;
            }
            else if (typeof accValue === 'number' && typeof deltaValue === 'number') {
                accValue += deltaValue;
            }
            else if ((0, utils_1.isObj)(accValue) && (0, utils_1.isObj)(deltaValue)) {
                accValue = this.accumulateDelta(accValue, deltaValue);
            }
            else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
                if (accValue.every((x) => typeof x === 'string' || typeof x === 'number')) {
                    accValue.push(...deltaValue); // Use spread syntax for efficient addition
                    continue;
                }
                for (const deltaEntry of deltaValue) {
                    if (!(0, utils_1.isObj)(deltaEntry)) {
                        throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
                    }
                    const index = deltaEntry['index'];
                    if (index == null) {
                        console.error(deltaEntry);
                        throw new Error('Expected array delta entry to have an `index` property');
                    }
                    if (typeof index !== 'number') {
                        throw new Error(`Expected array delta entry \`index\` property to be a number but got ${index}`);
                    }
                    const accEntry = accValue[index];
                    if (accEntry == null) {
                        accValue.push(deltaEntry);
                    }
                    else {
                        accValue[index] = this.accumulateDelta(accEntry, deltaEntry);
                    }
                }
                continue;
            }
            else {
                throw Error(`Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`);
            }
            acc[key] = accValue;
        }
        return acc;
    }
    _addRun(run) {
        return run;
    }
    async _threadAssistantStream(params, thread, options) {
        return await this._createThreadAssistantStream(thread, params, options);
    }
    async _runAssistantStream(threadId, runs, params, options) {
        return await this._createAssistantStream(runs, threadId, params, options);
    }
    async _runToolAssistantStream(runId, runs, params, options) {
        return await this._createToolAssistantStream(runs, runId, params, options);
    }
}
exports.AssistantStream = AssistantStream;
_a = AssistantStream, _AssistantStream_addEvent = function _AssistantStream_addEvent(event) {
    if (this.ended)
        return;
    tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentEvent, event, "f");
    tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleEvent).call(this, event);
    switch (event.event) {
        case 'thread.created':
            //No action on this event.
            break;
        case 'thread.run.created':
        case 'thread.run.queued':
        case 'thread.run.in_progress':
        case 'thread.run.requires_action':
        case 'thread.run.completed':
        case 'thread.run.incomplete':
        case 'thread.run.failed':
        case 'thread.run.cancelling':
        case 'thread.run.cancelled':
        case 'thread.run.expired':
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRun).call(this, event);
            break;
        case 'thread.run.step.created':
        case 'thread.run.step.in_progress':
        case 'thread.run.step.delta':
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRunStep).call(this, event);
            break;
        case 'thread.message.created':
        case 'thread.message.in_progress':
        case 'thread.message.delta':
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleMessage).call(this, event);
            break;
        case 'error':
            //This is included for completeness, but errors are processed in the SSE event processing so this should not occur
            throw new Error('Encountered an error event in event processing - errors should be processed earlier');
        default:
            assertNever(event);
    }
}, _AssistantStream_endRequest = function _AssistantStream_endRequest() {
    if (this.ended) {
        throw new error_1.OpenAIError(`stream has ended, this shouldn't happen`);
    }
    if (!tslib_1.__classPrivateFieldGet(this, _AssistantStream_finalRun, "f"))
        throw Error('Final run has not been received');
    return tslib_1.__classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
}, _AssistantStream_handleMessage = function _AssistantStream_handleMessage(event) {
    const [accumulatedMessage, newContent] = tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateMessage).call(this, event, tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
    tslib_1.__classPrivateFieldSet(this, _AssistantStream_messageSnapshot, accumulatedMessage, "f");
    tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f")[accumulatedMessage.id] = accumulatedMessage;
    for (const content of newContent) {
        const snapshotContent = accumulatedMessage.content[content.index];
        if (snapshotContent?.type == 'text') {
            this._emit('textCreated', snapshotContent.text);
        }
    }
    switch (event.event) {
        case 'thread.message.created':
            this._emit('messageCreated', event.data);
            break;
        case 'thread.message.in_progress':
            break;
        case 'thread.message.delta':
            this._emit('messageDelta', event.data.delta, accumulatedMessage);
            if (event.data.delta.content) {
                for (const content of event.data.delta.content) {
                    //If it is text delta, emit a text delta event
                    if (content.type == 'text' && content.text) {
                        let textDelta = content.text;
                        let snapshot = accumulatedMessage.content[content.index];
                        if (snapshot && snapshot.type == 'text') {
                            this._emit('textDelta', textDelta, snapshot.text);
                        }
                        else {
                            throw Error('The snapshot associated with this text delta is not text or missing');
                        }
                    }
                    if (content.index != tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")) {
                        //See if we have in progress content
                        if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContent, "f")) {
                            switch (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContent, "f").type) {
                                case 'text':
                                    this._emit('textDone', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContent, "f").text, tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                                    break;
                                case 'image_file':
                                    this._emit('imageFileDone', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContent, "f").image_file, tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                                    break;
                            }
                        }
                        tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentContentIndex, content.index, "f");
                    }
                    tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentContent, accumulatedMessage.content[content.index], "f");
                }
            }
            break;
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            //We emit the latest content we were working on on completion (including incomplete)
            if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f") !== undefined) {
                const currentContent = event.data.content[tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")];
                if (currentContent) {
                    switch (currentContent.type) {
                        case 'image_file':
                            this._emit('imageFileDone', currentContent.image_file, tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                            break;
                        case 'text':
                            this._emit('textDone', currentContent.text, tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                            break;
                    }
                }
            }
            if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f")) {
                this._emit('messageDone', event.data);
            }
            tslib_1.__classPrivateFieldSet(this, _AssistantStream_messageSnapshot, undefined, "f");
    }
}, _AssistantStream_handleRunStep = function _AssistantStream_handleRunStep(event) {
    const accumulatedRunStep = tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateRunStep).call(this, event);
    tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, accumulatedRunStep, "f");
    switch (event.event) {
        case 'thread.run.step.created':
            this._emit('runStepCreated', event.data);
            break;
        case 'thread.run.step.delta':
            const delta = event.data.delta;
            if (delta.step_details &&
                delta.step_details.type == 'tool_calls' &&
                delta.step_details.tool_calls &&
                accumulatedRunStep.step_details.type == 'tool_calls') {
                for (const toolCall of delta.step_details.tool_calls) {
                    if (toolCall.index == tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCallIndex, "f")) {
                        this._emit('toolCallDelta', toolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index]);
                    }
                    else {
                        if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
                            this._emit('toolCallDone', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
                        }
                        tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, toolCall.index, "f");
                        tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentToolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index], "f");
                        if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"))
                            this._emit('toolCallCreated', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
                    }
                }
            }
            this._emit('runStepDelta', event.data.delta, accumulatedRunStep);
            break;
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
            tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, undefined, "f");
            const details = event.data.step_details;
            if (details.type == 'tool_calls') {
                if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
                    this._emit('toolCallDone', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
                    tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentToolCall, undefined, "f");
                }
            }
            this._emit('runStepDone', event.data, accumulatedRunStep);
            break;
        case 'thread.run.step.in_progress':
            break;
    }
}, _AssistantStream_handleEvent = function _AssistantStream_handleEvent(event) {
    tslib_1.__classPrivateFieldGet(this, _AssistantStream_events, "f").push(event);
    this._emit('event', event);
}, _AssistantStream_accumulateRunStep = function _AssistantStream_accumulateRunStep(event) {
    switch (event.event) {
        case 'thread.run.step.created':
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
            return event.data;
        case 'thread.run.step.delta':
            let snapshot = tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
            if (!snapshot) {
                throw Error('Received a RunStepDelta before creation of a snapshot');
            }
            let data = event.data;
            if (data.delta) {
                const accumulated = _a.accumulateDelta(snapshot, data.delta);
                tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = accumulated;
            }
            return tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
        case 'thread.run.step.in_progress':
            tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
            break;
    }
    if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id])
        return tslib_1.__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
    throw new Error('No snapshot available');
}, _AssistantStream_accumulateMessage = function _AssistantStream_accumulateMessage(event, snapshot) {
    let newContent = [];
    switch (event.event) {
        case 'thread.message.created':
            //On creation the snapshot is just the initial message
            return [event.data, newContent];
        case 'thread.message.delta':
            if (!snapshot) {
                throw Error('Received a delta with no existing snapshot (there should be one from message creation)');
            }
            let data = event.data;
            //If this delta does not have content, nothing to process
            if (data.delta.content) {
                for (const contentElement of data.delta.content) {
                    if (contentElement.index in snapshot.content) {
                        let currentContent = snapshot.content[contentElement.index];
                        snapshot.content[contentElement.index] = tslib_1.__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateContent).call(this, contentElement, currentContent);
                    }
                    else {
                        snapshot.content[contentElement.index] = contentElement;
                        // This is a new element
                        newContent.push(contentElement);
                    }
                }
            }
            return [snapshot, newContent];
        case 'thread.message.in_progress':
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            //No changes on other thread events
            if (snapshot) {
                return [snapshot, newContent];
            }
            else {
                throw Error('Received thread message event with no existing snapshot');
            }
    }
    throw Error('Tried to accumulate a non-message event');
}, _AssistantStream_accumulateContent = function _AssistantStream_accumulateContent(contentElement, currentContent) {
    return _a.accumulateDelta(currentContent, contentElement);
}, _AssistantStream_handleRun = function _AssistantStream_handleRun(event) {
    tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentRunSnapshot, event.data, "f");
    switch (event.event) {
        case 'thread.run.created':
            break;
        case 'thread.run.queued':
            break;
        case 'thread.run.in_progress':
            break;
        case 'thread.run.requires_action':
        case 'thread.run.cancelled':
        case 'thread.run.failed':
        case 'thread.run.completed':
        case 'thread.run.expired':
        case 'thread.run.incomplete':
            tslib_1.__classPrivateFieldSet(this, _AssistantStream_finalRun, event.data, "f");
            if (tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
                this._emit('toolCallDone', tslib_1.__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
                tslib_1.__classPrivateFieldSet(this, _AssistantStream_currentToolCall, undefined, "f");
            }
            break;
        case 'thread.run.cancelling':
            break;
    }
};
function assertNever(_x) { }
//# sourceMappingURL=AssistantStream.js.map

/***/ },

/***/ "./node_modules/openai/lib/ChatCompletionRunner.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/lib/ChatCompletionRunner.js ***!
  \*********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatCompletionRunner = void 0;
const AbstractChatCompletionRunner_1 = __webpack_require__(/*! ./AbstractChatCompletionRunner.js */ "./node_modules/openai/lib/AbstractChatCompletionRunner.js");
const chatCompletionUtils_1 = __webpack_require__(/*! ./chatCompletionUtils.js */ "./node_modules/openai/lib/chatCompletionUtils.js");
class ChatCompletionRunner extends AbstractChatCompletionRunner_1.AbstractChatCompletionRunner {
    static runTools(client, params, options) {
        const runner = new ChatCompletionRunner();
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
        };
        runner._run(() => runner._runTools(client, params, opts));
        return runner;
    }
    _addMessage(message, emit = true) {
        super._addMessage(message, emit);
        if ((0, chatCompletionUtils_1.isAssistantMessage)(message) && message.content) {
            this._emit('content', message.content);
        }
    }
}
exports.ChatCompletionRunner = ChatCompletionRunner;
//# sourceMappingURL=ChatCompletionRunner.js.map

/***/ },

/***/ "./node_modules/openai/lib/ChatCompletionStream.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/lib/ChatCompletionStream.js ***!
  \*********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _ChatCompletionStream_instances, _ChatCompletionStream_params, _ChatCompletionStream_choiceEventStates, _ChatCompletionStream_currentChatCompletionSnapshot, _ChatCompletionStream_beginRequest, _ChatCompletionStream_getChoiceEventState, _ChatCompletionStream_addChunk, _ChatCompletionStream_emitToolCallDoneEvent, _ChatCompletionStream_emitContentDoneEvents, _ChatCompletionStream_endRequest, _ChatCompletionStream_getAutoParseableResponseFormat, _ChatCompletionStream_accumulateChatCompletion;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatCompletionStream = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const parser_1 = __webpack_require__(/*! ../_vendor/partial-json-parser/parser.js */ "./node_modules/openai/_vendor/partial-json-parser/parser.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const parser_2 = __webpack_require__(/*! ../lib/parser.js */ "./node_modules/openai/lib/parser.js");
const streaming_1 = __webpack_require__(/*! ../streaming.js */ "./node_modules/openai/streaming.js");
const AbstractChatCompletionRunner_1 = __webpack_require__(/*! ./AbstractChatCompletionRunner.js */ "./node_modules/openai/lib/AbstractChatCompletionRunner.js");
class ChatCompletionStream extends AbstractChatCompletionRunner_1.AbstractChatCompletionRunner {
    constructor(params) {
        super();
        _ChatCompletionStream_instances.add(this);
        _ChatCompletionStream_params.set(this, void 0);
        _ChatCompletionStream_choiceEventStates.set(this, void 0);
        _ChatCompletionStream_currentChatCompletionSnapshot.set(this, void 0);
        tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_params, params, "f");
        tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
    }
    get currentChatCompletionSnapshot() {
        return tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    }
    /**
     * Intended for use on the frontend, consuming a stream produced with
     * `.toReadableStream()` on the backend.
     *
     * Note that messages sent to the model do not appear in `.on('message')`
     * in this context.
     */
    static fromReadableStream(stream) {
        const runner = new ChatCompletionStream(null);
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    static createChatCompletion(client, params, options) {
        const runner = new ChatCompletionStream(params);
        runner._run(() => runner._runChatCompletion(client, { ...params, stream: true }, { ...options, headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' } }));
        return runner;
    }
    async _createChatCompletion(client, params, options) {
        super._createChatCompletion;
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
        const stream = await client.chat.completions.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const chunk of stream) {
            tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addChatCompletion(tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
    }
    async _fromReadableStream(readableStream, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
        this._connected();
        const stream = streaming_1.Stream.fromReadableStream(readableStream, this.controller);
        let chatId;
        for await (const chunk of stream) {
            if (chatId && chatId !== chunk.id) {
                // A new request has been made.
                this._addChatCompletion(tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
            }
            tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
            chatId = chunk.id;
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return this._addChatCompletion(tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
    }
    [(_ChatCompletionStream_params = new WeakMap(), _ChatCompletionStream_choiceEventStates = new WeakMap(), _ChatCompletionStream_currentChatCompletionSnapshot = new WeakMap(), _ChatCompletionStream_instances = new WeakSet(), _ChatCompletionStream_beginRequest = function _ChatCompletionStream_beginRequest() {
        if (this.ended)
            return;
        tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, undefined, "f");
    }, _ChatCompletionStream_getChoiceEventState = function _ChatCompletionStream_getChoiceEventState(choice) {
        let state = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
        if (state) {
            return state;
        }
        state = {
            content_done: false,
            refusal_done: false,
            logprobs_content_done: false,
            logprobs_refusal_done: false,
            done_tool_calls: new Set(),
            current_tool_call_index: null,
        };
        tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index] = state;
        return state;
    }, _ChatCompletionStream_addChunk = function _ChatCompletionStream_addChunk(chunk) {
        if (this.ended)
            return;
        const completion = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_accumulateChatCompletion).call(this, chunk);
        this._emit('chunk', chunk, completion);
        for (const choice of chunk.choices) {
            const choiceSnapshot = completion.choices[choice.index];
            if (choice.delta.content != null &&
                choiceSnapshot.message?.role === 'assistant' &&
                choiceSnapshot.message?.content) {
                this._emit('content', choice.delta.content, choiceSnapshot.message.content);
                this._emit('content.delta', {
                    delta: choice.delta.content,
                    snapshot: choiceSnapshot.message.content,
                    parsed: choiceSnapshot.message.parsed,
                });
            }
            if (choice.delta.refusal != null &&
                choiceSnapshot.message?.role === 'assistant' &&
                choiceSnapshot.message?.refusal) {
                this._emit('refusal.delta', {
                    delta: choice.delta.refusal,
                    snapshot: choiceSnapshot.message.refusal,
                });
            }
            if (choice.logprobs?.content != null && choiceSnapshot.message?.role === 'assistant') {
                this._emit('logprobs.content.delta', {
                    content: choice.logprobs?.content,
                    snapshot: choiceSnapshot.logprobs?.content ?? [],
                });
            }
            if (choice.logprobs?.refusal != null && choiceSnapshot.message?.role === 'assistant') {
                this._emit('logprobs.refusal.delta', {
                    refusal: choice.logprobs?.refusal,
                    snapshot: choiceSnapshot.logprobs?.refusal ?? [],
                });
            }
            const state = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
            if (choiceSnapshot.finish_reason) {
                tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
                if (state.current_tool_call_index != null) {
                    tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
                }
            }
            for (const toolCall of choice.delta.tool_calls ?? []) {
                if (state.current_tool_call_index !== toolCall.index) {
                    tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
                    // new tool call started, the previous one is done
                    if (state.current_tool_call_index != null) {
                        tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
                    }
                }
                state.current_tool_call_index = toolCall.index;
            }
            for (const toolCallDelta of choice.delta.tool_calls ?? []) {
                const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallDelta.index];
                if (!toolCallSnapshot?.type) {
                    continue;
                }
                if (toolCallSnapshot?.type === 'function') {
                    this._emit('tool_calls.function.arguments.delta', {
                        name: toolCallSnapshot.function?.name,
                        index: toolCallDelta.index,
                        arguments: toolCallSnapshot.function.arguments,
                        parsed_arguments: toolCallSnapshot.function.parsed_arguments,
                        arguments_delta: toolCallDelta.function?.arguments ?? '',
                    });
                }
                else {
                    assertNever(toolCallSnapshot?.type);
                }
            }
        }
    }, _ChatCompletionStream_emitToolCallDoneEvent = function _ChatCompletionStream_emitToolCallDoneEvent(choiceSnapshot, toolCallIndex) {
        const state = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
        if (state.done_tool_calls.has(toolCallIndex)) {
            // we've already fired the done event
            return;
        }
        const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallIndex];
        if (!toolCallSnapshot) {
            throw new Error('no tool call snapshot');
        }
        if (!toolCallSnapshot.type) {
            throw new Error('tool call snapshot missing `type`');
        }
        if (toolCallSnapshot.type === 'function') {
            const inputTool = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => (0, parser_2.isChatCompletionFunctionTool)(tool) && tool.function.name === toolCallSnapshot.function.name); // TS doesn't narrow based on isChatCompletionTool
            this._emit('tool_calls.function.arguments.done', {
                name: toolCallSnapshot.function.name,
                index: toolCallIndex,
                arguments: toolCallSnapshot.function.arguments,
                parsed_arguments: (0, parser_2.isAutoParsableTool)(inputTool) ? inputTool.$parseRaw(toolCallSnapshot.function.arguments)
                    : inputTool?.function.strict ? JSON.parse(toolCallSnapshot.function.arguments)
                        : null,
            });
        }
        else {
            assertNever(toolCallSnapshot.type);
        }
    }, _ChatCompletionStream_emitContentDoneEvents = function _ChatCompletionStream_emitContentDoneEvents(choiceSnapshot) {
        const state = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
        if (choiceSnapshot.message.content && !state.content_done) {
            state.content_done = true;
            const responseFormat = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this);
            this._emit('content.done', {
                content: choiceSnapshot.message.content,
                parsed: responseFormat ? responseFormat.$parseRaw(choiceSnapshot.message.content) : null,
            });
        }
        if (choiceSnapshot.message.refusal && !state.refusal_done) {
            state.refusal_done = true;
            this._emit('refusal.done', { refusal: choiceSnapshot.message.refusal });
        }
        if (choiceSnapshot.logprobs?.content && !state.logprobs_content_done) {
            state.logprobs_content_done = true;
            this._emit('logprobs.content.done', { content: choiceSnapshot.logprobs.content });
        }
        if (choiceSnapshot.logprobs?.refusal && !state.logprobs_refusal_done) {
            state.logprobs_refusal_done = true;
            this._emit('logprobs.refusal.done', { refusal: choiceSnapshot.logprobs.refusal });
        }
    }, _ChatCompletionStream_endRequest = function _ChatCompletionStream_endRequest() {
        if (this.ended) {
            throw new error_1.OpenAIError(`stream has ended, this shouldn't happen`);
        }
        const snapshot = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
        if (!snapshot) {
            throw new error_1.OpenAIError(`request ended without sending any chunks`);
        }
        tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, undefined, "f");
        tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
        return finalizeChatCompletion(snapshot, tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"));
    }, _ChatCompletionStream_getAutoParseableResponseFormat = function _ChatCompletionStream_getAutoParseableResponseFormat() {
        const responseFormat = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format;
        if ((0, parser_2.isAutoParsableResponseFormat)(responseFormat)) {
            return responseFormat;
        }
        return null;
    }, _ChatCompletionStream_accumulateChatCompletion = function _ChatCompletionStream_accumulateChatCompletion(chunk) {
        var _a, _b, _c, _d;
        let snapshot = tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
        const { choices, ...rest } = chunk;
        if (!snapshot) {
            snapshot = tslib_1.__classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, {
                ...rest,
                choices: [],
            }, "f");
        }
        else {
            Object.assign(snapshot, rest);
        }
        for (const { delta, finish_reason, index, logprobs = null, ...other } of chunk.choices) {
            let choice = snapshot.choices[index];
            if (!choice) {
                choice = snapshot.choices[index] = { finish_reason, index, message: {}, logprobs, ...other };
            }
            if (logprobs) {
                if (!choice.logprobs) {
                    choice.logprobs = Object.assign({}, logprobs);
                }
                else {
                    const { content, refusal, ...rest } = logprobs;
                    assertIsEmpty(rest);
                    Object.assign(choice.logprobs, rest);
                    if (content) {
                        (_a = choice.logprobs).content ?? (_a.content = []);
                        choice.logprobs.content.push(...content);
                    }
                    if (refusal) {
                        (_b = choice.logprobs).refusal ?? (_b.refusal = []);
                        choice.logprobs.refusal.push(...refusal);
                    }
                }
            }
            if (finish_reason) {
                choice.finish_reason = finish_reason;
                if (tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f") && (0, parser_2.hasAutoParseableInput)(tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"))) {
                    if (finish_reason === 'length') {
                        throw new error_1.LengthFinishReasonError();
                    }
                    if (finish_reason === 'content_filter') {
                        throw new error_1.ContentFilterFinishReasonError();
                    }
                }
            }
            Object.assign(choice, other);
            if (!delta)
                continue; // Shouldn't happen; just in case.
            const { content, refusal, function_call, role, tool_calls, ...rest } = delta;
            assertIsEmpty(rest);
            Object.assign(choice.message, rest);
            if (refusal) {
                choice.message.refusal = (choice.message.refusal || '') + refusal;
            }
            if (role)
                choice.message.role = role;
            if (function_call) {
                if (!choice.message.function_call) {
                    choice.message.function_call = function_call;
                }
                else {
                    if (function_call.name)
                        choice.message.function_call.name = function_call.name;
                    if (function_call.arguments) {
                        (_c = choice.message.function_call).arguments ?? (_c.arguments = '');
                        choice.message.function_call.arguments += function_call.arguments;
                    }
                }
            }
            if (content) {
                choice.message.content = (choice.message.content || '') + content;
                if (!choice.message.refusal && tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this)) {
                    choice.message.parsed = (0, parser_1.partialParse)(choice.message.content);
                }
            }
            if (tool_calls) {
                if (!choice.message.tool_calls)
                    choice.message.tool_calls = [];
                for (const { index, id, type, function: fn, ...rest } of tool_calls) {
                    const tool_call = ((_d = choice.message.tool_calls)[index] ?? (_d[index] = {}));
                    Object.assign(tool_call, rest);
                    if (id)
                        tool_call.id = id;
                    if (type)
                        tool_call.type = type;
                    if (fn)
                        tool_call.function ?? (tool_call.function = { name: fn.name ?? '', arguments: '' });
                    if (fn?.name)
                        tool_call.function.name = fn.name;
                    if (fn?.arguments) {
                        tool_call.function.arguments += fn.arguments;
                        if ((0, parser_2.shouldParseToolCall)(tslib_1.__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"), tool_call)) {
                            tool_call.function.parsed_arguments = (0, parser_1.partialParse)(tool_call.function.arguments);
                        }
                    }
                }
            }
        }
        return snapshot;
    }, Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        this.on('chunk', (chunk) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(chunk);
            }
            else {
                pushQueue.push(chunk);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }));
                }
                const chunk = pushQueue.shift();
                return { value: chunk, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    toReadableStream() {
        const stream = new streaming_1.Stream(this[Symbol.asyncIterator].bind(this), this.controller);
        return stream.toReadableStream();
    }
}
exports.ChatCompletionStream = ChatCompletionStream;
function finalizeChatCompletion(snapshot, params) {
    const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
    const completion = {
        ...rest,
        id,
        choices: choices.map(({ message, finish_reason, index, logprobs, ...choiceRest }) => {
            if (!finish_reason) {
                throw new error_1.OpenAIError(`missing finish_reason for choice ${index}`);
            }
            const { content = null, function_call, tool_calls, ...messageRest } = message;
            const role = message.role; // this is what we expect; in theory it could be different which would make our types a slight lie but would be fine.
            if (!role) {
                throw new error_1.OpenAIError(`missing role for choice ${index}`);
            }
            if (function_call) {
                const { arguments: args, name } = function_call;
                if (args == null) {
                    throw new error_1.OpenAIError(`missing function_call.arguments for choice ${index}`);
                }
                if (!name) {
                    throw new error_1.OpenAIError(`missing function_call.name for choice ${index}`);
                }
                return {
                    ...choiceRest,
                    message: {
                        content,
                        function_call: { arguments: args, name },
                        role,
                        refusal: message.refusal ?? null,
                    },
                    finish_reason,
                    index,
                    logprobs,
                };
            }
            if (tool_calls) {
                return {
                    ...choiceRest,
                    index,
                    finish_reason,
                    logprobs,
                    message: {
                        ...messageRest,
                        role,
                        content,
                        refusal: message.refusal ?? null,
                        tool_calls: tool_calls.map((tool_call, i) => {
                            const { function: fn, type, id, ...toolRest } = tool_call;
                            const { arguments: args, name, ...fnRest } = fn || {};
                            if (id == null) {
                                throw new error_1.OpenAIError(`missing choices[${index}].tool_calls[${i}].id\n${str(snapshot)}`);
                            }
                            if (type == null) {
                                throw new error_1.OpenAIError(`missing choices[${index}].tool_calls[${i}].type\n${str(snapshot)}`);
                            }
                            if (name == null) {
                                throw new error_1.OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name\n${str(snapshot)}`);
                            }
                            if (args == null) {
                                throw new error_1.OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments\n${str(snapshot)}`);
                            }
                            return { ...toolRest, id, type, function: { ...fnRest, name, arguments: args } };
                        }),
                    },
                };
            }
            return {
                ...choiceRest,
                message: { ...messageRest, content, role, refusal: message.refusal ?? null },
                finish_reason,
                index,
                logprobs,
            };
        }),
        created,
        model,
        object: 'chat.completion',
        ...(system_fingerprint ? { system_fingerprint } : {}),
    };
    return (0, parser_2.maybeParseChatCompletion)(completion, params);
}
function str(x) {
    return JSON.stringify(x);
}
/**
 * Ensures the given argument is an empty object, useful for
 * asserting that all known properties on an object have been
 * destructured.
 */
function assertIsEmpty(obj) {
    return;
}
function assertNever(_x) { }
//# sourceMappingURL=ChatCompletionStream.js.map

/***/ },

/***/ "./node_modules/openai/lib/ChatCompletionStreamingRunner.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/lib/ChatCompletionStreamingRunner.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatCompletionStreamingRunner = void 0;
const ChatCompletionStream_1 = __webpack_require__(/*! ./ChatCompletionStream.js */ "./node_modules/openai/lib/ChatCompletionStream.js");
class ChatCompletionStreamingRunner extends ChatCompletionStream_1.ChatCompletionStream {
    static fromReadableStream(stream) {
        const runner = new ChatCompletionStreamingRunner(null);
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    static runTools(client, params, options) {
        const runner = new ChatCompletionStreamingRunner(
        // @ts-expect-error TODO these types are incompatible
        params);
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
        };
        runner._run(() => runner._runTools(client, params, opts));
        return runner;
    }
}
exports.ChatCompletionStreamingRunner = ChatCompletionStreamingRunner;
//# sourceMappingURL=ChatCompletionStreamingRunner.js.map

/***/ },

/***/ "./node_modules/openai/lib/EventStream.js"
/*!************************************************!*\
  !*** ./node_modules/openai/lib/EventStream.js ***!
  \************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _EventStream_instances, _EventStream_connectedPromise, _EventStream_resolveConnectedPromise, _EventStream_rejectConnectedPromise, _EventStream_endPromise, _EventStream_resolveEndPromise, _EventStream_rejectEndPromise, _EventStream_listeners, _EventStream_ended, _EventStream_errored, _EventStream_aborted, _EventStream_catchingPromiseCreated, _EventStream_handleError;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.EventStream = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
class EventStream {
    constructor() {
        _EventStream_instances.add(this);
        this.controller = new AbortController();
        _EventStream_connectedPromise.set(this, void 0);
        _EventStream_resolveConnectedPromise.set(this, () => { });
        _EventStream_rejectConnectedPromise.set(this, () => { });
        _EventStream_endPromise.set(this, void 0);
        _EventStream_resolveEndPromise.set(this, () => { });
        _EventStream_rejectEndPromise.set(this, () => { });
        _EventStream_listeners.set(this, {});
        _EventStream_ended.set(this, false);
        _EventStream_errored.set(this, false);
        _EventStream_aborted.set(this, false);
        _EventStream_catchingPromiseCreated.set(this, false);
        tslib_1.__classPrivateFieldSet(this, _EventStream_connectedPromise, new Promise((resolve, reject) => {
            tslib_1.__classPrivateFieldSet(this, _EventStream_resolveConnectedPromise, resolve, "f");
            tslib_1.__classPrivateFieldSet(this, _EventStream_rejectConnectedPromise, reject, "f");
        }), "f");
        tslib_1.__classPrivateFieldSet(this, _EventStream_endPromise, new Promise((resolve, reject) => {
            tslib_1.__classPrivateFieldSet(this, _EventStream_resolveEndPromise, resolve, "f");
            tslib_1.__classPrivateFieldSet(this, _EventStream_rejectEndPromise, reject, "f");
        }), "f");
        // Don't let these promises cause unhandled rejection errors.
        // we will manually cause an unhandled rejection error later
        // if the user hasn't registered any error listener or called
        // any promise-returning method.
        tslib_1.__classPrivateFieldGet(this, _EventStream_connectedPromise, "f").catch(() => { });
        tslib_1.__classPrivateFieldGet(this, _EventStream_endPromise, "f").catch(() => { });
    }
    _run(executor) {
        // Unfortunately if we call `executor()` immediately we get runtime errors about
        // references to `this` before the `super()` constructor call returns.
        setTimeout(() => {
            executor().then(() => {
                this._emitFinal();
                this._emit('end');
            }, tslib_1.__classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_handleError).bind(this));
        }, 0);
    }
    _connected() {
        if (this.ended)
            return;
        tslib_1.__classPrivateFieldGet(this, _EventStream_resolveConnectedPromise, "f").call(this);
        this._emit('connect');
    }
    get ended() {
        return tslib_1.__classPrivateFieldGet(this, _EventStream_ended, "f");
    }
    get errored() {
        return tslib_1.__classPrivateFieldGet(this, _EventStream_errored, "f");
    }
    get aborted() {
        return tslib_1.__classPrivateFieldGet(this, _EventStream_aborted, "f");
    }
    abort() {
        this.controller.abort();
    }
    /**
     * Adds the listener function to the end of the listeners array for the event.
     * No checks are made to see if the listener has already been added. Multiple calls passing
     * the same combination of event and listener will result in the listener being added, and
     * called, multiple times.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    on(event, listener) {
        const listeners = tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] || (tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = []);
        listeners.push({ listener });
        return this;
    }
    /**
     * Removes the specified listener from the listener array for the event.
     * off() will remove, at most, one instance of a listener from the listener array. If any single
     * listener has been added multiple times to the listener array for the specified event, then
     * off() must be called multiple times to remove each instance.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    off(event, listener) {
        const listeners = tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
        if (!listeners)
            return this;
        const index = listeners.findIndex((l) => l.listener === listener);
        if (index >= 0)
            listeners.splice(index, 1);
        return this;
    }
    /**
     * Adds a one-time listener function for the event. The next time the event is triggered,
     * this listener is removed and then invoked.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    once(event, listener) {
        const listeners = tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] || (tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = []);
        listeners.push({ listener, once: true });
        return this;
    }
    /**
     * This is similar to `.once()`, but returns a Promise that resolves the next time
     * the event is triggered, instead of calling a listener callback.
     * @returns a Promise that resolves the next time given event is triggered,
     * or rejects if an error is emitted.  (If you request the 'error' event,
     * returns a promise that resolves with the error).
     *
     * Example:
     *
     *   const message = await stream.emitted('message') // rejects if the stream errors
     */
    emitted(event) {
        return new Promise((resolve, reject) => {
            tslib_1.__classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
            if (event !== 'error')
                this.once('error', reject);
            this.once(event, resolve);
        });
    }
    async done() {
        tslib_1.__classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
        await tslib_1.__classPrivateFieldGet(this, _EventStream_endPromise, "f");
    }
    _emit(event, ...args) {
        // make sure we don't emit any events after end
        if (tslib_1.__classPrivateFieldGet(this, _EventStream_ended, "f")) {
            return;
        }
        if (event === 'end') {
            tslib_1.__classPrivateFieldSet(this, _EventStream_ended, true, "f");
            tslib_1.__classPrivateFieldGet(this, _EventStream_resolveEndPromise, "f").call(this);
        }
        const listeners = tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
        if (listeners) {
            tslib_1.__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
            listeners.forEach(({ listener }) => listener(...args));
        }
        if (event === 'abort') {
            const error = args[0];
            if (!tslib_1.__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
                Promise.reject(error);
            }
            tslib_1.__classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
            tslib_1.__classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
            this._emit('end');
            return;
        }
        if (event === 'error') {
            // NOTE: _emit('error', error) should only be called from #handleError().
            const error = args[0];
            if (!tslib_1.__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
                // Trigger an unhandled rejection if the user hasn't registered any error handlers.
                // If you are seeing stack traces here, make sure to handle errors via either:
                // - runner.on('error', () => ...)
                // - await runner.done()
                // - await runner.finalChatCompletion()
                // - etc.
                Promise.reject(error);
            }
            tslib_1.__classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
            tslib_1.__classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
            this._emit('end');
        }
    }
    _emitFinal() { }
}
exports.EventStream = EventStream;
_EventStream_connectedPromise = new WeakMap(), _EventStream_resolveConnectedPromise = new WeakMap(), _EventStream_rejectConnectedPromise = new WeakMap(), _EventStream_endPromise = new WeakMap(), _EventStream_resolveEndPromise = new WeakMap(), _EventStream_rejectEndPromise = new WeakMap(), _EventStream_listeners = new WeakMap(), _EventStream_ended = new WeakMap(), _EventStream_errored = new WeakMap(), _EventStream_aborted = new WeakMap(), _EventStream_catchingPromiseCreated = new WeakMap(), _EventStream_instances = new WeakSet(), _EventStream_handleError = function _EventStream_handleError(error) {
    tslib_1.__classPrivateFieldSet(this, _EventStream_errored, true, "f");
    if (error instanceof Error && error.name === 'AbortError') {
        error = new error_1.APIUserAbortError();
    }
    if (error instanceof error_1.APIUserAbortError) {
        tslib_1.__classPrivateFieldSet(this, _EventStream_aborted, true, "f");
        return this._emit('abort', error);
    }
    if (error instanceof error_1.OpenAIError) {
        return this._emit('error', error);
    }
    if (error instanceof Error) {
        const openAIError = new error_1.OpenAIError(error.message);
        // @ts-ignore
        openAIError.cause = error;
        return this._emit('error', openAIError);
    }
    return this._emit('error', new error_1.OpenAIError(String(error)));
};
//# sourceMappingURL=EventStream.js.map

/***/ },

/***/ "./node_modules/openai/lib/ResponsesParser.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/lib/ResponsesParser.js ***!
  \****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.maybeParseResponse = maybeParseResponse;
exports.parseResponse = parseResponse;
exports.hasAutoParseableInput = hasAutoParseableInput;
exports.makeParseableResponseTool = makeParseableResponseTool;
exports.isAutoParsableTool = isAutoParsableTool;
exports.shouldParseToolCall = shouldParseToolCall;
exports.validateInputTools = validateInputTools;
exports.addOutputText = addOutputText;
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const parser_1 = __webpack_require__(/*! ../lib/parser.js */ "./node_modules/openai/lib/parser.js");
function maybeParseResponse(response, params) {
    if (!params || !hasAutoParseableInput(params)) {
        return {
            ...response,
            output_parsed: null,
            output: response.output.map((item) => {
                if (item.type === 'function_call') {
                    return {
                        ...item,
                        parsed_arguments: null,
                    };
                }
                if (item.type === 'message') {
                    return {
                        ...item,
                        content: item.content.map((content) => ({
                            ...content,
                            parsed: null,
                        })),
                    };
                }
                else {
                    return item;
                }
            }),
        };
    }
    return parseResponse(response, params);
}
function parseResponse(response, params) {
    const output = response.output.map((item) => {
        if (item.type === 'function_call') {
            return {
                ...item,
                parsed_arguments: parseToolCall(params, item),
            };
        }
        if (item.type === 'message') {
            const content = item.content.map((content) => {
                if (content.type === 'output_text') {
                    return {
                        ...content,
                        parsed: parseTextFormat(params, content.text),
                    };
                }
                return content;
            });
            return {
                ...item,
                content,
            };
        }
        return item;
    });
    const parsed = Object.assign({}, response, { output });
    if (!Object.getOwnPropertyDescriptor(response, 'output_text')) {
        addOutputText(parsed);
    }
    Object.defineProperty(parsed, 'output_parsed', {
        enumerable: true,
        get() {
            for (const output of parsed.output) {
                if (output.type !== 'message') {
                    continue;
                }
                for (const content of output.content) {
                    if (content.type === 'output_text' && content.parsed !== null) {
                        return content.parsed;
                    }
                }
            }
            return null;
        },
    });
    return parsed;
}
function parseTextFormat(params, content) {
    if (params.text?.format?.type !== 'json_schema') {
        return null;
    }
    if ('$parseRaw' in params.text?.format) {
        const text_format = params.text?.format;
        return text_format.$parseRaw(content);
    }
    return JSON.parse(content);
}
function hasAutoParseableInput(params) {
    if ((0, parser_1.isAutoParsableResponseFormat)(params.text?.format)) {
        return true;
    }
    return false;
}
function makeParseableResponseTool(tool, { parser, callback, }) {
    const obj = { ...tool };
    Object.defineProperties(obj, {
        $brand: {
            value: 'auto-parseable-tool',
            enumerable: false,
        },
        $parseRaw: {
            value: parser,
            enumerable: false,
        },
        $callback: {
            value: callback,
            enumerable: false,
        },
    });
    return obj;
}
function isAutoParsableTool(tool) {
    return tool?.['$brand'] === 'auto-parseable-tool';
}
function getInputToolByName(input_tools, name) {
    return input_tools.find((tool) => tool.type === 'function' && tool.name === name);
}
function parseToolCall(params, toolCall) {
    const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
    return {
        ...toolCall,
        ...toolCall,
        parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.arguments)
            : inputTool?.strict ? JSON.parse(toolCall.arguments)
                : null,
    };
}
function shouldParseToolCall(params, toolCall) {
    if (!params) {
        return false;
    }
    const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
    return isAutoParsableTool(inputTool) || inputTool?.strict || false;
}
function validateInputTools(tools) {
    for (const tool of tools ?? []) {
        if (tool.type !== 'function') {
            throw new error_1.OpenAIError(`Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``);
        }
        if (tool.function.strict !== true) {
            throw new error_1.OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
        }
    }
}
function addOutputText(rsp) {
    const texts = [];
    for (const output of rsp.output) {
        if (output.type !== 'message') {
            continue;
        }
        for (const content of output.content) {
            if (content.type === 'output_text') {
                texts.push(content.text);
            }
        }
    }
    rsp.output_text = texts.join('');
}
//# sourceMappingURL=ResponsesParser.js.map

/***/ },

/***/ "./node_modules/openai/lib/RunnableFunction.js"
/*!*****************************************************!*\
  !*** ./node_modules/openai/lib/RunnableFunction.js ***!
  \*****************************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ParsingToolFunction = void 0;
exports.isRunnableFunctionWithParse = isRunnableFunctionWithParse;
function isRunnableFunctionWithParse(fn) {
    return typeof fn.parse === 'function';
}
/**
 * This is helper class for passing a `function` and `parse` where the `function`
 * argument type matches the `parse` return type.
 */
class ParsingToolFunction {
    constructor(input) {
        this.type = 'function';
        this.function = input;
    }
}
exports.ParsingToolFunction = ParsingToolFunction;
//# sourceMappingURL=RunnableFunction.js.map

/***/ },

/***/ "./node_modules/openai/lib/Util.js"
/*!*****************************************!*\
  !*** ./node_modules/openai/lib/Util.js ***!
  \*****************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.allSettledWithThrow = void 0;
/**
 * Like `Promise.allSettled()` but throws an error if any promises are rejected.
 */
const allSettledWithThrow = async (promises) => {
    const results = await Promise.allSettled(promises);
    const rejected = results.filter((result) => result.status === 'rejected');
    if (rejected.length) {
        for (const result of rejected) {
            console.error(result.reason);
        }
        throw new Error(`${rejected.length} promise(s) failed - see the above errors`);
    }
    // Note: TS was complaining about using `.filter().map()` here for some reason
    const values = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            values.push(result.value);
        }
    }
    return values;
};
exports.allSettledWithThrow = allSettledWithThrow;
//# sourceMappingURL=Util.js.map

/***/ },

/***/ "./node_modules/openai/lib/chatCompletionUtils.js"
/*!********************************************************!*\
  !*** ./node_modules/openai/lib/chatCompletionUtils.js ***!
  \********************************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.isToolMessage = exports.isAssistantMessage = void 0;
exports.isPresent = isPresent;
const isAssistantMessage = (message) => {
    return message?.role === 'assistant';
};
exports.isAssistantMessage = isAssistantMessage;
const isToolMessage = (message) => {
    return message?.role === 'tool';
};
exports.isToolMessage = isToolMessage;
function isPresent(obj) {
    return obj != null;
}
//# sourceMappingURL=chatCompletionUtils.js.map

/***/ },

/***/ "./node_modules/openai/lib/parser.js"
/*!*******************************************!*\
  !*** ./node_modules/openai/lib/parser.js ***!
  \*******************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.isChatCompletionFunctionTool = isChatCompletionFunctionTool;
exports.makeParseableResponseFormat = makeParseableResponseFormat;
exports.makeParseableTextFormat = makeParseableTextFormat;
exports.isAutoParsableResponseFormat = isAutoParsableResponseFormat;
exports.makeParseableTool = makeParseableTool;
exports.isAutoParsableTool = isAutoParsableTool;
exports.maybeParseChatCompletion = maybeParseChatCompletion;
exports.parseChatCompletion = parseChatCompletion;
exports.shouldParseToolCall = shouldParseToolCall;
exports.hasAutoParseableInput = hasAutoParseableInput;
exports.assertToolCallsAreChatCompletionFunctionToolCalls = assertToolCallsAreChatCompletionFunctionToolCalls;
exports.validateInputTools = validateInputTools;
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
function isChatCompletionFunctionTool(tool) {
    return tool !== undefined && 'function' in tool && tool.function !== undefined;
}
function makeParseableResponseFormat(response_format, parser) {
    const obj = { ...response_format };
    Object.defineProperties(obj, {
        $brand: {
            value: 'auto-parseable-response-format',
            enumerable: false,
        },
        $parseRaw: {
            value: parser,
            enumerable: false,
        },
    });
    return obj;
}
function makeParseableTextFormat(response_format, parser) {
    const obj = { ...response_format };
    Object.defineProperties(obj, {
        $brand: {
            value: 'auto-parseable-response-format',
            enumerable: false,
        },
        $parseRaw: {
            value: parser,
            enumerable: false,
        },
    });
    return obj;
}
function isAutoParsableResponseFormat(response_format) {
    return response_format?.['$brand'] === 'auto-parseable-response-format';
}
function makeParseableTool(tool, { parser, callback, }) {
    const obj = { ...tool };
    Object.defineProperties(obj, {
        $brand: {
            value: 'auto-parseable-tool',
            enumerable: false,
        },
        $parseRaw: {
            value: parser,
            enumerable: false,
        },
        $callback: {
            value: callback,
            enumerable: false,
        },
    });
    return obj;
}
function isAutoParsableTool(tool) {
    return tool?.['$brand'] === 'auto-parseable-tool';
}
function maybeParseChatCompletion(completion, params) {
    if (!params || !hasAutoParseableInput(params)) {
        return {
            ...completion,
            choices: completion.choices.map((choice) => {
                assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
                return {
                    ...choice,
                    message: {
                        ...choice.message,
                        parsed: null,
                        ...(choice.message.tool_calls ?
                            {
                                tool_calls: choice.message.tool_calls,
                            }
                            : undefined),
                    },
                };
            }),
        };
    }
    return parseChatCompletion(completion, params);
}
function parseChatCompletion(completion, params) {
    const choices = completion.choices.map((choice) => {
        if (choice.finish_reason === 'length') {
            throw new error_1.LengthFinishReasonError();
        }
        if (choice.finish_reason === 'content_filter') {
            throw new error_1.ContentFilterFinishReasonError();
        }
        assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
        return {
            ...choice,
            message: {
                ...choice.message,
                ...(choice.message.tool_calls ?
                    {
                        tool_calls: choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? undefined,
                    }
                    : undefined),
                parsed: choice.message.content && !choice.message.refusal ?
                    parseResponseFormat(params, choice.message.content)
                    : null,
            },
        };
    });
    return { ...completion, choices };
}
function parseResponseFormat(params, content) {
    if (params.response_format?.type !== 'json_schema') {
        return null;
    }
    if (params.response_format?.type === 'json_schema') {
        if ('$parseRaw' in params.response_format) {
            const response_format = params.response_format;
            return response_format.$parseRaw(content);
        }
        return JSON.parse(content);
    }
    return null;
}
function parseToolCall(params, toolCall) {
    const inputTool = params.tools?.find((inputTool) => isChatCompletionFunctionTool(inputTool) && inputTool.function?.name === toolCall.function.name); // TS doesn't narrow based on isChatCompletionTool
    return {
        ...toolCall,
        function: {
            ...toolCall.function,
            parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.function.arguments)
                : inputTool?.function.strict ? JSON.parse(toolCall.function.arguments)
                    : null,
        },
    };
}
function shouldParseToolCall(params, toolCall) {
    if (!params || !('tools' in params) || !params.tools) {
        return false;
    }
    const inputTool = params.tools?.find((inputTool) => isChatCompletionFunctionTool(inputTool) && inputTool.function?.name === toolCall.function.name);
    return (isChatCompletionFunctionTool(inputTool) &&
        (isAutoParsableTool(inputTool) || inputTool?.function.strict || false));
}
function hasAutoParseableInput(params) {
    if (isAutoParsableResponseFormat(params.response_format)) {
        return true;
    }
    return (params.tools?.some((t) => isAutoParsableTool(t) || (t.type === 'function' && t.function.strict === true)) ?? false);
}
function assertToolCallsAreChatCompletionFunctionToolCalls(toolCalls) {
    for (const toolCall of toolCalls || []) {
        if (toolCall.type !== 'function') {
            throw new error_1.OpenAIError(`Currently only \`function\` tool calls are supported; Received \`${toolCall.type}\``);
        }
    }
}
function validateInputTools(tools) {
    for (const tool of tools ?? []) {
        if (tool.type !== 'function') {
            throw new error_1.OpenAIError(`Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``);
        }
        if (tool.function.strict !== true) {
            throw new error_1.OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
        }
    }
}
//# sourceMappingURL=parser.js.map

/***/ },

/***/ "./node_modules/openai/lib/responses/ResponseStream.js"
/*!*************************************************************!*\
  !*** ./node_modules/openai/lib/responses/ResponseStream.js ***!
  \*************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var _ResponseStream_instances, _ResponseStream_params, _ResponseStream_currentResponseSnapshot, _ResponseStream_finalResponse, _ResponseStream_beginRequest, _ResponseStream_addEvent, _ResponseStream_endRequest, _ResponseStream_accumulateResponse;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ResponseStream = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ../../error.js */ "./node_modules/openai/error.js");
const EventStream_1 = __webpack_require__(/*! ../EventStream.js */ "./node_modules/openai/lib/EventStream.js");
const ResponsesParser_1 = __webpack_require__(/*! ../ResponsesParser.js */ "./node_modules/openai/lib/ResponsesParser.js");
class ResponseStream extends EventStream_1.EventStream {
    constructor(params) {
        super();
        _ResponseStream_instances.add(this);
        _ResponseStream_params.set(this, void 0);
        _ResponseStream_currentResponseSnapshot.set(this, void 0);
        _ResponseStream_finalResponse.set(this, void 0);
        tslib_1.__classPrivateFieldSet(this, _ResponseStream_params, params, "f");
    }
    static createResponse(client, params, options) {
        const runner = new ResponseStream(params);
        runner._run(() => runner._createOrRetrieveResponse(client, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    async _createOrRetrieveResponse(client, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        tslib_1.__classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
        let stream;
        let starting_after = null;
        if ('response_id' in params) {
            stream = await client.responses.retrieve(params.response_id, { stream: true }, { ...options, signal: this.controller.signal, stream: true });
            starting_after = params.starting_after ?? null;
        }
        else {
            stream = await client.responses.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
        }
        this._connected();
        for await (const event of stream) {
            tslib_1.__classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, starting_after);
        }
        if (stream.controller.signal?.aborted) {
            throw new error_1.APIUserAbortError();
        }
        return tslib_1.__classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
    }
    [(_ResponseStream_params = new WeakMap(), _ResponseStream_currentResponseSnapshot = new WeakMap(), _ResponseStream_finalResponse = new WeakMap(), _ResponseStream_instances = new WeakSet(), _ResponseStream_beginRequest = function _ResponseStream_beginRequest() {
        if (this.ended)
            return;
        tslib_1.__classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, undefined, "f");
    }, _ResponseStream_addEvent = function _ResponseStream_addEvent(event, starting_after) {
        if (this.ended)
            return;
        const maybeEmit = (name, event) => {
            if (starting_after == null || event.sequence_number > starting_after) {
                this._emit(name, event);
            }
        };
        const response = tslib_1.__classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_accumulateResponse).call(this, event);
        maybeEmit('event', event);
        switch (event.type) {
            case 'response.output_text.delta': {
                const output = response.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'message') {
                    const content = output.content[event.content_index];
                    if (!content) {
                        throw new error_1.OpenAIError(`missing content at index ${event.content_index}`);
                    }
                    if (content.type !== 'output_text') {
                        throw new error_1.OpenAIError(`expected content to be 'output_text', got ${content.type}`);
                    }
                    maybeEmit('response.output_text.delta', {
                        ...event,
                        snapshot: content.text,
                    });
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const output = response.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'function_call') {
                    maybeEmit('response.function_call_arguments.delta', {
                        ...event,
                        snapshot: output.arguments,
                    });
                }
                break;
            }
            default:
                maybeEmit(event.type, event);
                break;
        }
    }, _ResponseStream_endRequest = function _ResponseStream_endRequest() {
        if (this.ended) {
            throw new error_1.OpenAIError(`stream has ended, this shouldn't happen`);
        }
        const snapshot = tslib_1.__classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
        if (!snapshot) {
            throw new error_1.OpenAIError(`request ended without sending any events`);
        }
        tslib_1.__classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, undefined, "f");
        const parsedResponse = finalizeResponse(snapshot, tslib_1.__classPrivateFieldGet(this, _ResponseStream_params, "f"));
        tslib_1.__classPrivateFieldSet(this, _ResponseStream_finalResponse, parsedResponse, "f");
        return parsedResponse;
    }, _ResponseStream_accumulateResponse = function _ResponseStream_accumulateResponse(event) {
        let snapshot = tslib_1.__classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
        if (!snapshot) {
            if (event.type !== 'response.created') {
                throw new error_1.OpenAIError(`When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`);
            }
            snapshot = tslib_1.__classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
            return snapshot;
        }
        switch (event.type) {
            case 'response.output_item.added': {
                snapshot.output.push(event.item);
                break;
            }
            case 'response.content_part.added': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                const type = output.type;
                const part = event.part;
                if (type === 'message' && part.type !== 'reasoning_text') {
                    output.content.push(part);
                }
                else if (type === 'reasoning' && part.type === 'reasoning_text') {
                    if (!output.content) {
                        output.content = [];
                    }
                    output.content.push(part);
                }
                break;
            }
            case 'response.output_text.delta': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'message') {
                    const content = output.content[event.content_index];
                    if (!content) {
                        throw new error_1.OpenAIError(`missing content at index ${event.content_index}`);
                    }
                    if (content.type !== 'output_text') {
                        throw new error_1.OpenAIError(`expected content to be 'output_text', got ${content.type}`);
                    }
                    content.text += event.delta;
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'function_call') {
                    output.arguments += event.delta;
                }
                break;
            }
            case 'response.reasoning_text.delta': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new error_1.OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'reasoning') {
                    const content = output.content?.[event.content_index];
                    if (!content) {
                        throw new error_1.OpenAIError(`missing content at index ${event.content_index}`);
                    }
                    if (content.type !== 'reasoning_text') {
                        throw new error_1.OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
                    }
                    content.text += event.delta;
                }
                break;
            }
            case 'response.completed': {
                tslib_1.__classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
                break;
            }
        }
        return snapshot;
    }, Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        this.on('event', (event) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(event);
            }
            else {
                pushQueue.push(event);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((event) => (event ? { value: event, done: false } : { value: undefined, done: true }));
                }
                const event = pushQueue.shift();
                return { value: event, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    /**
     * @returns a promise that resolves with the final Response, or rejects
     * if an error occurred or the stream ended prematurely without producing a REsponse.
     */
    async finalResponse() {
        await this.done();
        const response = tslib_1.__classPrivateFieldGet(this, _ResponseStream_finalResponse, "f");
        if (!response)
            throw new error_1.OpenAIError('stream ended without producing a ChatCompletion');
        return response;
    }
}
exports.ResponseStream = ResponseStream;
function finalizeResponse(snapshot, params) {
    return (0, ResponsesParser_1.maybeParseResponse)(snapshot, params);
}
//# sourceMappingURL=ResponseStream.js.map

/***/ },

/***/ "./node_modules/openai/resources/audio/audio.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/resources/audio/audio.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Audio = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const SpeechAPI = tslib_1.__importStar(__webpack_require__(/*! ./speech.js */ "./node_modules/openai/resources/audio/speech.js"));
const speech_1 = __webpack_require__(/*! ./speech.js */ "./node_modules/openai/resources/audio/speech.js");
const TranscriptionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./transcriptions.js */ "./node_modules/openai/resources/audio/transcriptions.js"));
const transcriptions_1 = __webpack_require__(/*! ./transcriptions.js */ "./node_modules/openai/resources/audio/transcriptions.js");
const TranslationsAPI = tslib_1.__importStar(__webpack_require__(/*! ./translations.js */ "./node_modules/openai/resources/audio/translations.js"));
const translations_1 = __webpack_require__(/*! ./translations.js */ "./node_modules/openai/resources/audio/translations.js");
class Audio extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.transcriptions = new TranscriptionsAPI.Transcriptions(this._client);
        this.translations = new TranslationsAPI.Translations(this._client);
        this.speech = new SpeechAPI.Speech(this._client);
    }
}
exports.Audio = Audio;
Audio.Transcriptions = transcriptions_1.Transcriptions;
Audio.Translations = translations_1.Translations;
Audio.Speech = speech_1.Speech;
//# sourceMappingURL=audio.js.map

/***/ },

/***/ "./node_modules/openai/resources/audio/speech.js"
/*!*******************************************************!*\
  !*** ./node_modules/openai/resources/audio/speech.js ***!
  \*******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Speech = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
class Speech extends resource_1.APIResource {
    /**
     * Generates audio from the input text.
     *
     * @example
     * ```ts
     * const speech = await client.audio.speech.create({
     *   input: 'input',
     *   model: 'string',
     *   voice: 'ash',
     * });
     *
     * const content = await speech.blob();
     * console.log(content);
     * ```
     */
    create(body, options) {
        return this._client.post('/audio/speech', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/octet-stream' }, options?.headers]),
            __binaryResponse: true,
        });
    }
}
exports.Speech = Speech;
//# sourceMappingURL=speech.js.map

/***/ },

/***/ "./node_modules/openai/resources/audio/transcriptions.js"
/*!***************************************************************!*\
  !*** ./node_modules/openai/resources/audio/transcriptions.js ***!
  \***************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Transcriptions = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const uploads_1 = __webpack_require__(/*! ../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
class Transcriptions extends resource_1.APIResource {
    create(body, options) {
        return this._client.post('/audio/transcriptions', (0, uploads_1.multipartFormRequestOptions)({
            body,
            ...options,
            stream: body.stream ?? false,
            __metadata: { model: body.model },
        }, this._client));
    }
}
exports.Transcriptions = Transcriptions;
//# sourceMappingURL=transcriptions.js.map

/***/ },

/***/ "./node_modules/openai/resources/audio/translations.js"
/*!*************************************************************!*\
  !*** ./node_modules/openai/resources/audio/translations.js ***!
  \*************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Translations = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const uploads_1 = __webpack_require__(/*! ../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
class Translations extends resource_1.APIResource {
    create(body, options) {
        return this._client.post('/audio/translations', (0, uploads_1.multipartFormRequestOptions)({ body, ...options, __metadata: { model: body.model } }, this._client));
    }
}
exports.Translations = Translations;
//# sourceMappingURL=translations.js.map

/***/ },

/***/ "./node_modules/openai/resources/batches.js"
/*!**************************************************!*\
  !*** ./node_modules/openai/resources/batches.js ***!
  \**************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Batches = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Batches extends resource_1.APIResource {
    /**
     * Creates and executes a batch from an uploaded file of requests
     */
    create(body, options) {
        return this._client.post('/batches', { body, ...options });
    }
    /**
     * Retrieves a batch.
     */
    retrieve(batchID, options) {
        return this._client.get((0, path_1.path) `/batches/${batchID}`, options);
    }
    /**
     * List your organization's batches.
     */
    list(query = {}, options) {
        return this._client.getAPIList('/batches', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Cancels an in-progress batch. The batch will be in status `cancelling` for up to
     * 10 minutes, before changing to `cancelled`, where it will have partial results
     * (if any) available in the output file.
     */
    cancel(batchID, options) {
        return this._client.post((0, path_1.path) `/batches/${batchID}/cancel`, options);
    }
}
exports.Batches = Batches;
//# sourceMappingURL=batches.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/assistants.js"
/*!**********************************************************!*\
  !*** ./node_modules/openai/resources/beta/assistants.js ***!
  \**********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Assistants = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Assistants extends resource_1.APIResource {
    /**
     * Create an assistant with a model and instructions.
     *
     * @deprecated
     */
    create(body, options) {
        return this._client.post('/assistants', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieves an assistant.
     *
     * @deprecated
     */
    retrieve(assistantID, options) {
        return this._client.get((0, path_1.path) `/assistants/${assistantID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Modifies an assistant.
     *
     * @deprecated
     */
    update(assistantID, body, options) {
        return this._client.post((0, path_1.path) `/assistants/${assistantID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of assistants.
     *
     * @deprecated
     */
    list(query = {}, options) {
        return this._client.getAPIList('/assistants', (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Delete an assistant.
     *
     * @deprecated
     */
    delete(assistantID, options) {
        return this._client.delete((0, path_1.path) `/assistants/${assistantID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.Assistants = Assistants;
//# sourceMappingURL=assistants.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/beta.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/resources/beta/beta.js ***!
  \****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Beta = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const AssistantsAPI = tslib_1.__importStar(__webpack_require__(/*! ./assistants.js */ "./node_modules/openai/resources/beta/assistants.js"));
const assistants_1 = __webpack_require__(/*! ./assistants.js */ "./node_modules/openai/resources/beta/assistants.js");
const RealtimeAPI = tslib_1.__importStar(__webpack_require__(/*! ./realtime/realtime.js */ "./node_modules/openai/resources/beta/realtime/realtime.js"));
const realtime_1 = __webpack_require__(/*! ./realtime/realtime.js */ "./node_modules/openai/resources/beta/realtime/realtime.js");
const ChatKitAPI = tslib_1.__importStar(__webpack_require__(/*! ./chatkit/chatkit.js */ "./node_modules/openai/resources/beta/chatkit/chatkit.js"));
const chatkit_1 = __webpack_require__(/*! ./chatkit/chatkit.js */ "./node_modules/openai/resources/beta/chatkit/chatkit.js");
const ThreadsAPI = tslib_1.__importStar(__webpack_require__(/*! ./threads/threads.js */ "./node_modules/openai/resources/beta/threads/threads.js"));
const threads_1 = __webpack_require__(/*! ./threads/threads.js */ "./node_modules/openai/resources/beta/threads/threads.js");
class Beta extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.realtime = new RealtimeAPI.Realtime(this._client);
        this.chatkit = new ChatKitAPI.ChatKit(this._client);
        this.assistants = new AssistantsAPI.Assistants(this._client);
        this.threads = new ThreadsAPI.Threads(this._client);
    }
}
exports.Beta = Beta;
Beta.Realtime = realtime_1.Realtime;
Beta.ChatKit = chatkit_1.ChatKit;
Beta.Assistants = assistants_1.Assistants;
Beta.Threads = threads_1.Threads;
//# sourceMappingURL=beta.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/chatkit/chatkit.js"
/*!***************************************************************!*\
  !*** ./node_modules/openai/resources/beta/chatkit/chatkit.js ***!
  \***************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatKit = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const SessionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./sessions.js */ "./node_modules/openai/resources/beta/chatkit/sessions.js"));
const sessions_1 = __webpack_require__(/*! ./sessions.js */ "./node_modules/openai/resources/beta/chatkit/sessions.js");
const ThreadsAPI = tslib_1.__importStar(__webpack_require__(/*! ./threads.js */ "./node_modules/openai/resources/beta/chatkit/threads.js"));
const threads_1 = __webpack_require__(/*! ./threads.js */ "./node_modules/openai/resources/beta/chatkit/threads.js");
class ChatKit extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.sessions = new SessionsAPI.Sessions(this._client);
        this.threads = new ThreadsAPI.Threads(this._client);
    }
}
exports.ChatKit = ChatKit;
ChatKit.Sessions = sessions_1.Sessions;
ChatKit.Threads = threads_1.Threads;
//# sourceMappingURL=chatkit.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/chatkit/sessions.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/beta/chatkit/sessions.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Sessions = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Sessions extends resource_1.APIResource {
    /**
     * Create a ChatKit session
     *
     * @example
     * ```ts
     * const chatSession =
     *   await client.beta.chatkit.sessions.create({
     *     user: 'x',
     *     workflow: { id: 'id' },
     *   });
     * ```
     */
    create(body, options) {
        return this._client.post('/chatkit/sessions', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]),
        });
    }
    /**
     * Cancel a ChatKit session
     *
     * @example
     * ```ts
     * const chatSession =
     *   await client.beta.chatkit.sessions.cancel('cksess_123');
     * ```
     */
    cancel(sessionID, options) {
        return this._client.post((0, path_1.path) `/chatkit/sessions/${sessionID}/cancel`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]),
        });
    }
}
exports.Sessions = Sessions;
//# sourceMappingURL=sessions.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/chatkit/threads.js"
/*!***************************************************************!*\
  !*** ./node_modules/openai/resources/beta/chatkit/threads.js ***!
  \***************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Threads = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Threads extends resource_1.APIResource {
    /**
     * Retrieve a ChatKit thread
     *
     * @example
     * ```ts
     * const chatkitThread =
     *   await client.beta.chatkit.threads.retrieve('cthr_123');
     * ```
     */
    retrieve(threadID, options) {
        return this._client.get((0, path_1.path) `/chatkit/threads/${threadID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]),
        });
    }
    /**
     * List ChatKit threads
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const chatkitThread of client.beta.chatkit.threads.list()) {
     *   // ...
     * }
     * ```
     */
    list(query = {}, options) {
        return this._client.getAPIList('/chatkit/threads', (pagination_1.ConversationCursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]),
        });
    }
    /**
     * Delete a ChatKit thread
     *
     * @example
     * ```ts
     * const thread = await client.beta.chatkit.threads.delete(
     *   'cthr_123',
     * );
     * ```
     */
    delete(threadID, options) {
        return this._client.delete((0, path_1.path) `/chatkit/threads/${threadID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]),
        });
    }
    /**
     * List ChatKit thread items
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const thread of client.beta.chatkit.threads.listItems(
     *   'cthr_123',
     * )) {
     *   // ...
     * }
     * ```
     */
    listItems(threadID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/chatkit/threads/${threadID}/items`, (pagination_1.ConversationCursorPage), { query, ...options, headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'chatkit_beta=v1' }, options?.headers]) });
    }
}
exports.Threads = Threads;
//# sourceMappingURL=threads.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/realtime/realtime.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/beta/realtime/realtime.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Realtime = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const SessionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./sessions.js */ "./node_modules/openai/resources/beta/realtime/sessions.js"));
const sessions_1 = __webpack_require__(/*! ./sessions.js */ "./node_modules/openai/resources/beta/realtime/sessions.js");
const TranscriptionSessionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./transcription-sessions.js */ "./node_modules/openai/resources/beta/realtime/transcription-sessions.js"));
const transcription_sessions_1 = __webpack_require__(/*! ./transcription-sessions.js */ "./node_modules/openai/resources/beta/realtime/transcription-sessions.js");
/**
 * @deprecated Realtime has now launched and is generally available. The old beta API is now deprecated.
 */
class Realtime extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.sessions = new SessionsAPI.Sessions(this._client);
        this.transcriptionSessions = new TranscriptionSessionsAPI.TranscriptionSessions(this._client);
    }
}
exports.Realtime = Realtime;
Realtime.Sessions = sessions_1.Sessions;
Realtime.TranscriptionSessions = transcription_sessions_1.TranscriptionSessions;
//# sourceMappingURL=realtime.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/realtime/sessions.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/beta/realtime/sessions.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Sessions = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
class Sessions extends resource_1.APIResource {
    /**
     * Create an ephemeral API token for use in client-side applications with the
     * Realtime API. Can be configured with the same session parameters as the
     * `session.update` client event.
     *
     * It responds with a session object, plus a `client_secret` key which contains a
     * usable ephemeral API token that can be used to authenticate browser clients for
     * the Realtime API.
     *
     * @example
     * ```ts
     * const session =
     *   await client.beta.realtime.sessions.create();
     * ```
     */
    create(body, options) {
        return this._client.post('/realtime/sessions', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.Sessions = Sessions;
//# sourceMappingURL=sessions.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/realtime/transcription-sessions.js"
/*!*******************************************************************************!*\
  !*** ./node_modules/openai/resources/beta/realtime/transcription-sessions.js ***!
  \*******************************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TranscriptionSessions = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
class TranscriptionSessions extends resource_1.APIResource {
    /**
     * Create an ephemeral API token for use in client-side applications with the
     * Realtime API specifically for realtime transcriptions. Can be configured with
     * the same session parameters as the `transcription_session.update` client event.
     *
     * It responds with a session object, plus a `client_secret` key which contains a
     * usable ephemeral API token that can be used to authenticate browser clients for
     * the Realtime API.
     *
     * @example
     * ```ts
     * const transcriptionSession =
     *   await client.beta.realtime.transcriptionSessions.create();
     * ```
     */
    create(body, options) {
        return this._client.post('/realtime/transcription_sessions', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.TranscriptionSessions = TranscriptionSessions;
//# sourceMappingURL=transcription-sessions.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/threads/messages.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/beta/threads/messages.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Messages = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Messages extends resource_1.APIResource {
    /**
     * Create a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    create(threadID, body, options) {
        return this._client.post((0, path_1.path) `/threads/${threadID}/messages`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieve a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(messageID, params, options) {
        const { thread_id } = params;
        return this._client.get((0, path_1.path) `/threads/${thread_id}/messages/${messageID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Modifies a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(messageID, params, options) {
        const { thread_id, ...body } = params;
        return this._client.post((0, path_1.path) `/threads/${thread_id}/messages/${messageID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of messages for a given thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    list(threadID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/threads/${threadID}/messages`, (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Deletes a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    delete(messageID, params, options) {
        const { thread_id } = params;
        return this._client.delete((0, path_1.path) `/threads/${thread_id}/messages/${messageID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.Messages = Messages;
//# sourceMappingURL=messages.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/threads/runs/runs.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/beta/threads/runs/runs.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Runs = void 0;
const tslib_1 = __webpack_require__(/*! ../../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const StepsAPI = tslib_1.__importStar(__webpack_require__(/*! ./steps.js */ "./node_modules/openai/resources/beta/threads/runs/steps.js"));
const steps_1 = __webpack_require__(/*! ./steps.js */ "./node_modules/openai/resources/beta/threads/runs/steps.js");
const pagination_1 = __webpack_require__(/*! ../../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const AssistantStream_1 = __webpack_require__(/*! ../../../../lib/AssistantStream.js */ "./node_modules/openai/lib/AssistantStream.js");
const sleep_1 = __webpack_require__(/*! ../../../../internal/utils/sleep.js */ "./node_modules/openai/internal/utils/sleep.js");
const path_1 = __webpack_require__(/*! ../../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Runs extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.steps = new StepsAPI.Steps(this._client);
    }
    create(threadID, params, options) {
        const { include, ...body } = params;
        return this._client.post((0, path_1.path) `/threads/${threadID}/runs`, {
            query: { include },
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
            stream: params.stream ?? false,
        });
    }
    /**
     * Retrieves a run.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(runID, params, options) {
        const { thread_id } = params;
        return this._client.get((0, path_1.path) `/threads/${thread_id}/runs/${runID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Modifies a run.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(runID, params, options) {
        const { thread_id, ...body } = params;
        return this._client.post((0, path_1.path) `/threads/${thread_id}/runs/${runID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of runs belonging to a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    list(threadID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/threads/${threadID}/runs`, (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Cancels a run that is `in_progress`.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    cancel(runID, params, options) {
        const { thread_id } = params;
        return this._client.post((0, path_1.path) `/threads/${thread_id}/runs/${runID}/cancel`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * A helper to create a run an poll for a terminal state. More information on Run
     * lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async createAndPoll(threadId, body, options) {
        const run = await this.create(threadId, body, options);
        return await this.poll(run.id, { thread_id: threadId }, options);
    }
    /**
     * Create a Run stream
     *
     * @deprecated use `stream` instead
     */
    createAndStream(threadId, body, options) {
        return AssistantStream_1.AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
    }
    /**
     * A helper to poll a run status until it reaches a terminal state. More
     * information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async poll(runId, params, options) {
        const headers = (0, headers_1.buildHeaders)([
            options?.headers,
            {
                'X-Stainless-Poll-Helper': 'true',
                'X-Stainless-Custom-Poll-Interval': options?.pollIntervalMs?.toString() ?? undefined,
            },
        ]);
        while (true) {
            const { data: run, response } = await this.retrieve(runId, params, {
                ...options,
                headers: { ...options?.headers, ...headers },
            }).withResponse();
            switch (run.status) {
                //If we are in any sort of intermediate state we poll
                case 'queued':
                case 'in_progress':
                case 'cancelling':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await (0, sleep_1.sleep)(sleepInterval);
                    break;
                //We return the run in any terminal state.
                case 'requires_action':
                case 'incomplete':
                case 'cancelled':
                case 'completed':
                case 'failed':
                case 'expired':
                    return run;
            }
        }
    }
    /**
     * Create a Run stream
     */
    stream(threadId, body, options) {
        return AssistantStream_1.AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
    }
    submitToolOutputs(runID, params, options) {
        const { thread_id, ...body } = params;
        return this._client.post((0, path_1.path) `/threads/${thread_id}/runs/${runID}/submit_tool_outputs`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
            stream: params.stream ?? false,
        });
    }
    /**
     * A helper to submit a tool output to a run and poll for a terminal run state.
     * More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async submitToolOutputsAndPoll(runId, params, options) {
        const run = await this.submitToolOutputs(runId, params, options);
        return await this.poll(run.id, params, options);
    }
    /**
     * Submit the tool outputs from a previous run and stream the run to a terminal
     * state. More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    submitToolOutputsStream(runId, params, options) {
        return AssistantStream_1.AssistantStream.createToolAssistantStream(runId, this._client.beta.threads.runs, params, options);
    }
}
exports.Runs = Runs;
Runs.Steps = steps_1.Steps;
//# sourceMappingURL=runs.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/threads/runs/steps.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/beta/threads/runs/steps.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Steps = void 0;
const resource_1 = __webpack_require__(/*! ../../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Steps extends resource_1.APIResource {
    /**
     * Retrieves a run step.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(stepID, params, options) {
        const { thread_id, run_id, ...query } = params;
        return this._client.get((0, path_1.path) `/threads/${thread_id}/runs/${run_id}/steps/${stepID}`, {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of run steps belonging to a run.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    list(runID, params, options) {
        const { thread_id, ...query } = params;
        return this._client.getAPIList((0, path_1.path) `/threads/${thread_id}/runs/${runID}/steps`, (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.Steps = Steps;
//# sourceMappingURL=steps.js.map

/***/ },

/***/ "./node_modules/openai/resources/beta/threads/threads.js"
/*!***************************************************************!*\
  !*** ./node_modules/openai/resources/beta/threads/threads.js ***!
  \***************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Threads = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const MessagesAPI = tslib_1.__importStar(__webpack_require__(/*! ./messages.js */ "./node_modules/openai/resources/beta/threads/messages.js"));
const messages_1 = __webpack_require__(/*! ./messages.js */ "./node_modules/openai/resources/beta/threads/messages.js");
const RunsAPI = tslib_1.__importStar(__webpack_require__(/*! ./runs/runs.js */ "./node_modules/openai/resources/beta/threads/runs/runs.js"));
const runs_1 = __webpack_require__(/*! ./runs/runs.js */ "./node_modules/openai/resources/beta/threads/runs/runs.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const AssistantStream_1 = __webpack_require__(/*! ../../../lib/AssistantStream.js */ "./node_modules/openai/lib/AssistantStream.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Threads extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.runs = new RunsAPI.Runs(this._client);
        this.messages = new MessagesAPI.Messages(this._client);
    }
    /**
     * Create a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    create(body = {}, options) {
        return this._client.post('/threads', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieves a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(threadID, options) {
        return this._client.get((0, path_1.path) `/threads/${threadID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Modifies a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(threadID, body, options) {
        return this._client.post((0, path_1.path) `/threads/${threadID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Delete a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    delete(threadID, options) {
        return this._client.delete((0, path_1.path) `/threads/${threadID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    createAndRun(body, options) {
        return this._client.post('/threads/runs', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
            stream: body.stream ?? false,
        });
    }
    /**
     * A helper to create a thread, start a run and then poll for a terminal state.
     * More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async createAndRunPoll(body, options) {
        const run = await this.createAndRun(body, options);
        return await this.runs.poll(run.id, { thread_id: run.thread_id }, options);
    }
    /**
     * Create a thread and stream the run back
     */
    createAndRunStream(body, options) {
        return AssistantStream_1.AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
    }
}
exports.Threads = Threads;
Threads.Runs = runs_1.Runs;
Threads.Messages = messages_1.Messages;
//# sourceMappingURL=threads.js.map

/***/ },

/***/ "./node_modules/openai/resources/chat/chat.js"
/*!****************************************************!*\
  !*** ./node_modules/openai/resources/chat/chat.js ***!
  \****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Chat = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const CompletionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./completions/completions.js */ "./node_modules/openai/resources/chat/completions/completions.js"));
const completions_1 = __webpack_require__(/*! ./completions/completions.js */ "./node_modules/openai/resources/chat/completions/completions.js");
class Chat extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.completions = new CompletionsAPI.Completions(this._client);
    }
}
exports.Chat = Chat;
Chat.Completions = completions_1.Completions;
//# sourceMappingURL=chat.js.map

/***/ },

/***/ "./node_modules/openai/resources/chat/completions/completions.js"
/*!***********************************************************************!*\
  !*** ./node_modules/openai/resources/chat/completions/completions.js ***!
  \***********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatCompletionRunner = exports.ChatCompletionStream = exports.ParsingToolFunction = exports.ChatCompletionStreamingRunner = exports.Completions = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const MessagesAPI = tslib_1.__importStar(__webpack_require__(/*! ./messages.js */ "./node_modules/openai/resources/chat/completions/messages.js"));
const messages_1 = __webpack_require__(/*! ./messages.js */ "./node_modules/openai/resources/chat/completions/messages.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
const ChatCompletionRunner_1 = __webpack_require__(/*! ../../../lib/ChatCompletionRunner.js */ "./node_modules/openai/lib/ChatCompletionRunner.js");
const ChatCompletionStreamingRunner_1 = __webpack_require__(/*! ../../../lib/ChatCompletionStreamingRunner.js */ "./node_modules/openai/lib/ChatCompletionStreamingRunner.js");
const ChatCompletionStream_1 = __webpack_require__(/*! ../../../lib/ChatCompletionStream.js */ "./node_modules/openai/lib/ChatCompletionStream.js");
const parser_1 = __webpack_require__(/*! ../../../lib/parser.js */ "./node_modules/openai/lib/parser.js");
class Completions extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.messages = new MessagesAPI.Messages(this._client);
    }
    create(body, options) {
        return this._client.post('/chat/completions', { body, ...options, stream: body.stream ?? false });
    }
    /**
     * Get a stored chat completion. Only Chat Completions that have been created with
     * the `store` parameter set to `true` will be returned.
     *
     * @example
     * ```ts
     * const chatCompletion =
     *   await client.chat.completions.retrieve('completion_id');
     * ```
     */
    retrieve(completionID, options) {
        return this._client.get((0, path_1.path) `/chat/completions/${completionID}`, options);
    }
    /**
     * Modify a stored chat completion. Only Chat Completions that have been created
     * with the `store` parameter set to `true` can be modified. Currently, the only
     * supported modification is to update the `metadata` field.
     *
     * @example
     * ```ts
     * const chatCompletion = await client.chat.completions.update(
     *   'completion_id',
     *   { metadata: { foo: 'string' } },
     * );
     * ```
     */
    update(completionID, body, options) {
        return this._client.post((0, path_1.path) `/chat/completions/${completionID}`, { body, ...options });
    }
    /**
     * List stored Chat Completions. Only Chat Completions that have been stored with
     * the `store` parameter set to `true` will be returned.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const chatCompletion of client.chat.completions.list()) {
     *   // ...
     * }
     * ```
     */
    list(query = {}, options) {
        return this._client.getAPIList('/chat/completions', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Delete a stored chat completion. Only Chat Completions that have been created
     * with the `store` parameter set to `true` can be deleted.
     *
     * @example
     * ```ts
     * const chatCompletionDeleted =
     *   await client.chat.completions.delete('completion_id');
     * ```
     */
    delete(completionID, options) {
        return this._client.delete((0, path_1.path) `/chat/completions/${completionID}`, options);
    }
    parse(body, options) {
        (0, parser_1.validateInputTools)(body.tools);
        return this._client.chat.completions
            .create(body, {
            ...options,
            headers: {
                ...options?.headers,
                'X-Stainless-Helper-Method': 'chat.completions.parse',
            },
        })
            ._thenUnwrap((completion) => (0, parser_1.parseChatCompletion)(completion, body));
    }
    runTools(body, options) {
        if (body.stream) {
            return ChatCompletionStreamingRunner_1.ChatCompletionStreamingRunner.runTools(this._client, body, options);
        }
        return ChatCompletionRunner_1.ChatCompletionRunner.runTools(this._client, body, options);
    }
    /**
     * Creates a chat completion stream
     */
    stream(body, options) {
        return ChatCompletionStream_1.ChatCompletionStream.createChatCompletion(this._client, body, options);
    }
}
exports.Completions = Completions;
var ChatCompletionStreamingRunner_2 = __webpack_require__(/*! ../../../lib/ChatCompletionStreamingRunner.js */ "./node_modules/openai/lib/ChatCompletionStreamingRunner.js");
Object.defineProperty(exports, "ChatCompletionStreamingRunner", ({ enumerable: true, get: function () { return ChatCompletionStreamingRunner_2.ChatCompletionStreamingRunner; } }));
var RunnableFunction_1 = __webpack_require__(/*! ../../../lib/RunnableFunction.js */ "./node_modules/openai/lib/RunnableFunction.js");
Object.defineProperty(exports, "ParsingToolFunction", ({ enumerable: true, get: function () { return RunnableFunction_1.ParsingToolFunction; } }));
var ChatCompletionStream_2 = __webpack_require__(/*! ../../../lib/ChatCompletionStream.js */ "./node_modules/openai/lib/ChatCompletionStream.js");
Object.defineProperty(exports, "ChatCompletionStream", ({ enumerable: true, get: function () { return ChatCompletionStream_2.ChatCompletionStream; } }));
var ChatCompletionRunner_2 = __webpack_require__(/*! ../../../lib/ChatCompletionRunner.js */ "./node_modules/openai/lib/ChatCompletionRunner.js");
Object.defineProperty(exports, "ChatCompletionRunner", ({ enumerable: true, get: function () { return ChatCompletionRunner_2.ChatCompletionRunner; } }));
Completions.Messages = messages_1.Messages;
//# sourceMappingURL=completions.js.map

/***/ },

/***/ "./node_modules/openai/resources/chat/completions/index.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/chat/completions/index.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Messages = exports.Completions = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
var completions_1 = __webpack_require__(/*! ./completions.js */ "./node_modules/openai/resources/chat/completions/completions.js");
Object.defineProperty(exports, "Completions", ({ enumerable: true, get: function () { return completions_1.Completions; } }));
tslib_1.__exportStar(__webpack_require__(/*! ./completions.js */ "./node_modules/openai/resources/chat/completions/completions.js"), exports);
var messages_1 = __webpack_require__(/*! ./messages.js */ "./node_modules/openai/resources/chat/completions/messages.js");
Object.defineProperty(exports, "Messages", ({ enumerable: true, get: function () { return messages_1.Messages; } }));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/openai/resources/chat/completions/messages.js"
/*!********************************************************************!*\
  !*** ./node_modules/openai/resources/chat/completions/messages.js ***!
  \********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Messages = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Messages extends resource_1.APIResource {
    /**
     * Get the messages in a stored chat completion. Only Chat Completions that have
     * been created with the `store` parameter set to `true` will be returned.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const chatCompletionStoreMessage of client.chat.completions.messages.list(
     *   'completion_id',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(completionID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/chat/completions/${completionID}/messages`, (pagination_1.CursorPage), { query, ...options });
    }
}
exports.Messages = Messages;
//# sourceMappingURL=messages.js.map

/***/ },

/***/ "./node_modules/openai/resources/chat/index.js"
/*!*****************************************************!*\
  !*** ./node_modules/openai/resources/chat/index.js ***!
  \*****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Completions = exports.Chat = void 0;
var chat_1 = __webpack_require__(/*! ./chat.js */ "./node_modules/openai/resources/chat/chat.js");
Object.defineProperty(exports, "Chat", ({ enumerable: true, get: function () { return chat_1.Chat; } }));
var index_1 = __webpack_require__(/*! ./completions/index.js */ "./node_modules/openai/resources/chat/completions/index.js");
Object.defineProperty(exports, "Completions", ({ enumerable: true, get: function () { return index_1.Completions; } }));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/openai/resources/completions.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/resources/completions.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Completions = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
class Completions extends resource_1.APIResource {
    create(body, options) {
        return this._client.post('/completions', { body, ...options, stream: body.stream ?? false });
    }
}
exports.Completions = Completions;
//# sourceMappingURL=completions.js.map

/***/ },

/***/ "./node_modules/openai/resources/containers/containers.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/containers/containers.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Containers = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const FilesAPI = tslib_1.__importStar(__webpack_require__(/*! ./files/files.js */ "./node_modules/openai/resources/containers/files/files.js"));
const files_1 = __webpack_require__(/*! ./files/files.js */ "./node_modules/openai/resources/containers/files/files.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Containers extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.files = new FilesAPI.Files(this._client);
    }
    /**
     * Create Container
     */
    create(body, options) {
        return this._client.post('/containers', { body, ...options });
    }
    /**
     * Retrieve Container
     */
    retrieve(containerID, options) {
        return this._client.get((0, path_1.path) `/containers/${containerID}`, options);
    }
    /**
     * List Containers
     */
    list(query = {}, options) {
        return this._client.getAPIList('/containers', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Delete Container
     */
    delete(containerID, options) {
        return this._client.delete((0, path_1.path) `/containers/${containerID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
}
exports.Containers = Containers;
Containers.Files = files_1.Files;
//# sourceMappingURL=containers.js.map

/***/ },

/***/ "./node_modules/openai/resources/containers/files/content.js"
/*!*******************************************************************!*\
  !*** ./node_modules/openai/resources/containers/files/content.js ***!
  \*******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Content = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Content extends resource_1.APIResource {
    /**
     * Retrieve Container File Content
     */
    retrieve(fileID, params, options) {
        const { container_id } = params;
        return this._client.get((0, path_1.path) `/containers/${container_id}/files/${fileID}/content`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/binary' }, options?.headers]),
            __binaryResponse: true,
        });
    }
}
exports.Content = Content;
//# sourceMappingURL=content.js.map

/***/ },

/***/ "./node_modules/openai/resources/containers/files/files.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/containers/files/files.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Files = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const ContentAPI = tslib_1.__importStar(__webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/containers/files/content.js"));
const content_1 = __webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/containers/files/content.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const uploads_1 = __webpack_require__(/*! ../../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Files extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.content = new ContentAPI.Content(this._client);
    }
    /**
     * Create a Container File
     *
     * You can send either a multipart/form-data request with the raw file content, or
     * a JSON request with a file ID.
     */
    create(containerID, body, options) {
        return this._client.post((0, path_1.path) `/containers/${containerID}/files`, (0, uploads_1.multipartFormRequestOptions)({ body, ...options }, this._client));
    }
    /**
     * Retrieve Container File
     */
    retrieve(fileID, params, options) {
        const { container_id } = params;
        return this._client.get((0, path_1.path) `/containers/${container_id}/files/${fileID}`, options);
    }
    /**
     * List Container files
     */
    list(containerID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/containers/${containerID}/files`, (pagination_1.CursorPage), {
            query,
            ...options,
        });
    }
    /**
     * Delete Container File
     */
    delete(fileID, params, options) {
        const { container_id } = params;
        return this._client.delete((0, path_1.path) `/containers/${container_id}/files/${fileID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
}
exports.Files = Files;
Files.Content = content_1.Content;
//# sourceMappingURL=files.js.map

/***/ },

/***/ "./node_modules/openai/resources/conversations/conversations.js"
/*!**********************************************************************!*\
  !*** ./node_modules/openai/resources/conversations/conversations.js ***!
  \**********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Conversations = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const ItemsAPI = tslib_1.__importStar(__webpack_require__(/*! ./items.js */ "./node_modules/openai/resources/conversations/items.js"));
const items_1 = __webpack_require__(/*! ./items.js */ "./node_modules/openai/resources/conversations/items.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Conversations extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.items = new ItemsAPI.Items(this._client);
    }
    /**
     * Create a conversation.
     */
    create(body = {}, options) {
        return this._client.post('/conversations', { body, ...options });
    }
    /**
     * Get a conversation
     */
    retrieve(conversationID, options) {
        return this._client.get((0, path_1.path) `/conversations/${conversationID}`, options);
    }
    /**
     * Update a conversation
     */
    update(conversationID, body, options) {
        return this._client.post((0, path_1.path) `/conversations/${conversationID}`, { body, ...options });
    }
    /**
     * Delete a conversation. Items in the conversation will not be deleted.
     */
    delete(conversationID, options) {
        return this._client.delete((0, path_1.path) `/conversations/${conversationID}`, options);
    }
}
exports.Conversations = Conversations;
Conversations.Items = items_1.Items;
//# sourceMappingURL=conversations.js.map

/***/ },

/***/ "./node_modules/openai/resources/conversations/items.js"
/*!**************************************************************!*\
  !*** ./node_modules/openai/resources/conversations/items.js ***!
  \**************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Items = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Items extends resource_1.APIResource {
    /**
     * Create items in a conversation with the given ID.
     */
    create(conversationID, params, options) {
        const { include, ...body } = params;
        return this._client.post((0, path_1.path) `/conversations/${conversationID}/items`, {
            query: { include },
            body,
            ...options,
        });
    }
    /**
     * Get a single item from a conversation with the given IDs.
     */
    retrieve(itemID, params, options) {
        const { conversation_id, ...query } = params;
        return this._client.get((0, path_1.path) `/conversations/${conversation_id}/items/${itemID}`, { query, ...options });
    }
    /**
     * List all items for a conversation with the given ID.
     */
    list(conversationID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/conversations/${conversationID}/items`, (pagination_1.ConversationCursorPage), { query, ...options });
    }
    /**
     * Delete an item from a conversation with the given IDs.
     */
    delete(itemID, params, options) {
        const { conversation_id } = params;
        return this._client.delete((0, path_1.path) `/conversations/${conversation_id}/items/${itemID}`, options);
    }
}
exports.Items = Items;
//# sourceMappingURL=items.js.map

/***/ },

/***/ "./node_modules/openai/resources/embeddings.js"
/*!*****************************************************!*\
  !*** ./node_modules/openai/resources/embeddings.js ***!
  \*****************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Embeddings = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const utils_1 = __webpack_require__(/*! ../internal/utils.js */ "./node_modules/openai/internal/utils.js");
class Embeddings extends resource_1.APIResource {
    /**
     * Creates an embedding vector representing the input text.
     *
     * @example
     * ```ts
     * const createEmbeddingResponse =
     *   await client.embeddings.create({
     *     input: 'The quick brown fox jumped over the lazy dog',
     *     model: 'text-embedding-3-small',
     *   });
     * ```
     */
    create(body, options) {
        const hasUserProvidedEncodingFormat = !!body.encoding_format;
        // No encoding_format specified, defaulting to base64 for performance reasons
        // See https://github.com/openai/openai-node/pull/1312
        let encoding_format = hasUserProvidedEncodingFormat ? body.encoding_format : 'base64';
        if (hasUserProvidedEncodingFormat) {
            (0, utils_1.loggerFor)(this._client).debug('embeddings/user defined encoding_format:', body.encoding_format);
        }
        const response = this._client.post('/embeddings', {
            body: {
                ...body,
                encoding_format: encoding_format,
            },
            ...options,
        });
        // if the user specified an encoding_format, return the response as-is
        if (hasUserProvidedEncodingFormat) {
            return response;
        }
        // in this stage, we are sure the user did not specify an encoding_format
        // and we defaulted to base64 for performance reasons
        // we are sure then that the response is base64 encoded, let's decode it
        // the returned result will be a float32 array since this is OpenAI API's default encoding
        (0, utils_1.loggerFor)(this._client).debug('embeddings/decoding base64 embeddings from base64');
        return response._thenUnwrap((response) => {
            if (response && response.data) {
                response.data.forEach((embeddingBase64Obj) => {
                    const embeddingBase64Str = embeddingBase64Obj.embedding;
                    embeddingBase64Obj.embedding = (0, utils_1.toFloat32Array)(embeddingBase64Str);
                });
            }
            return response;
        });
    }
}
exports.Embeddings = Embeddings;
//# sourceMappingURL=embeddings.js.map

/***/ },

/***/ "./node_modules/openai/resources/evals/evals.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/resources/evals/evals.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Evals = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const RunsAPI = tslib_1.__importStar(__webpack_require__(/*! ./runs/runs.js */ "./node_modules/openai/resources/evals/runs/runs.js"));
const runs_1 = __webpack_require__(/*! ./runs/runs.js */ "./node_modules/openai/resources/evals/runs/runs.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Evals extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.runs = new RunsAPI.Runs(this._client);
    }
    /**
     * Create the structure of an evaluation that can be used to test a model's
     * performance. An evaluation is a set of testing criteria and the config for a
     * data source, which dictates the schema of the data used in the evaluation. After
     * creating an evaluation, you can run it on different models and model parameters.
     * We support several types of graders and datasources. For more information, see
     * the [Evals guide](https://platform.openai.com/docs/guides/evals).
     */
    create(body, options) {
        return this._client.post('/evals', { body, ...options });
    }
    /**
     * Get an evaluation by ID.
     */
    retrieve(evalID, options) {
        return this._client.get((0, path_1.path) `/evals/${evalID}`, options);
    }
    /**
     * Update certain properties of an evaluation.
     */
    update(evalID, body, options) {
        return this._client.post((0, path_1.path) `/evals/${evalID}`, { body, ...options });
    }
    /**
     * List evaluations for a project.
     */
    list(query = {}, options) {
        return this._client.getAPIList('/evals', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Delete an evaluation.
     */
    delete(evalID, options) {
        return this._client.delete((0, path_1.path) `/evals/${evalID}`, options);
    }
}
exports.Evals = Evals;
Evals.Runs = runs_1.Runs;
//# sourceMappingURL=evals.js.map

/***/ },

/***/ "./node_modules/openai/resources/evals/runs/output-items.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/evals/runs/output-items.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OutputItems = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class OutputItems extends resource_1.APIResource {
    /**
     * Get an evaluation run output item by ID.
     */
    retrieve(outputItemID, params, options) {
        const { eval_id, run_id } = params;
        return this._client.get((0, path_1.path) `/evals/${eval_id}/runs/${run_id}/output_items/${outputItemID}`, options);
    }
    /**
     * Get a list of output items for an evaluation run.
     */
    list(runID, params, options) {
        const { eval_id, ...query } = params;
        return this._client.getAPIList((0, path_1.path) `/evals/${eval_id}/runs/${runID}/output_items`, (pagination_1.CursorPage), { query, ...options });
    }
}
exports.OutputItems = OutputItems;
//# sourceMappingURL=output-items.js.map

/***/ },

/***/ "./node_modules/openai/resources/evals/runs/runs.js"
/*!**********************************************************!*\
  !*** ./node_modules/openai/resources/evals/runs/runs.js ***!
  \**********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Runs = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const OutputItemsAPI = tslib_1.__importStar(__webpack_require__(/*! ./output-items.js */ "./node_modules/openai/resources/evals/runs/output-items.js"));
const output_items_1 = __webpack_require__(/*! ./output-items.js */ "./node_modules/openai/resources/evals/runs/output-items.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Runs extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.outputItems = new OutputItemsAPI.OutputItems(this._client);
    }
    /**
     * Kicks off a new run for a given evaluation, specifying the data source, and what
     * model configuration to use to test. The datasource will be validated against the
     * schema specified in the config of the evaluation.
     */
    create(evalID, body, options) {
        return this._client.post((0, path_1.path) `/evals/${evalID}/runs`, { body, ...options });
    }
    /**
     * Get an evaluation run by ID.
     */
    retrieve(runID, params, options) {
        const { eval_id } = params;
        return this._client.get((0, path_1.path) `/evals/${eval_id}/runs/${runID}`, options);
    }
    /**
     * Get a list of runs for an evaluation.
     */
    list(evalID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/evals/${evalID}/runs`, (pagination_1.CursorPage), {
            query,
            ...options,
        });
    }
    /**
     * Delete an eval run.
     */
    delete(runID, params, options) {
        const { eval_id } = params;
        return this._client.delete((0, path_1.path) `/evals/${eval_id}/runs/${runID}`, options);
    }
    /**
     * Cancel an ongoing evaluation run.
     */
    cancel(runID, params, options) {
        const { eval_id } = params;
        return this._client.post((0, path_1.path) `/evals/${eval_id}/runs/${runID}`, options);
    }
}
exports.Runs = Runs;
Runs.OutputItems = output_items_1.OutputItems;
//# sourceMappingURL=runs.js.map

/***/ },

/***/ "./node_modules/openai/resources/files.js"
/*!************************************************!*\
  !*** ./node_modules/openai/resources/files.js ***!
  \************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Files = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const sleep_1 = __webpack_require__(/*! ../internal/utils/sleep.js */ "./node_modules/openai/internal/utils/sleep.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const uploads_1 = __webpack_require__(/*! ../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Files extends resource_1.APIResource {
    /**
     * Upload a file that can be used across various endpoints. Individual files can be
     * up to 512 MB, and each project can store up to 2.5 TB of files in total. There
     * is no organization-wide storage limit.
     *
     * - The Assistants API supports files up to 2 million tokens and of specific file
     *   types. See the
     *   [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools)
     *   for details.
     * - The Fine-tuning API only supports `.jsonl` files. The input also has certain
     *   required formats for fine-tuning
     *   [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input)
     *   or
     *   [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
     *   models.
     * - The Batch API only supports `.jsonl` files up to 200 MB in size. The input
     *   also has a specific required
     *   [format](https://platform.openai.com/docs/api-reference/batch/request-input).
     *
     * Please [contact us](https://help.openai.com/) if you need to increase these
     * storage limits.
     */
    create(body, options) {
        return this._client.post('/files', (0, uploads_1.multipartFormRequestOptions)({ body, ...options }, this._client));
    }
    /**
     * Returns information about a specific file.
     */
    retrieve(fileID, options) {
        return this._client.get((0, path_1.path) `/files/${fileID}`, options);
    }
    /**
     * Returns a list of files.
     */
    list(query = {}, options) {
        return this._client.getAPIList('/files', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Delete a file and remove it from all vector stores.
     */
    delete(fileID, options) {
        return this._client.delete((0, path_1.path) `/files/${fileID}`, options);
    }
    /**
     * Returns the contents of the specified file.
     */
    content(fileID, options) {
        return this._client.get((0, path_1.path) `/files/${fileID}/content`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/binary' }, options?.headers]),
            __binaryResponse: true,
        });
    }
    /**
     * Waits for the given file to be processed, default timeout is 30 mins.
     */
    async waitForProcessing(id, { pollInterval = 5000, maxWait = 30 * 60 * 1000 } = {}) {
        const TERMINAL_STATES = new Set(['processed', 'error', 'deleted']);
        const start = Date.now();
        let file = await this.retrieve(id);
        while (!file.status || !TERMINAL_STATES.has(file.status)) {
            await (0, sleep_1.sleep)(pollInterval);
            file = await this.retrieve(id);
            if (Date.now() - start > maxWait) {
                throw new error_1.APIConnectionTimeoutError({
                    message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`,
                });
            }
        }
        return file;
    }
}
exports.Files = Files;
//# sourceMappingURL=files.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/alpha/alpha.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/alpha/alpha.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Alpha = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const GradersAPI = tslib_1.__importStar(__webpack_require__(/*! ./graders.js */ "./node_modules/openai/resources/fine-tuning/alpha/graders.js"));
const graders_1 = __webpack_require__(/*! ./graders.js */ "./node_modules/openai/resources/fine-tuning/alpha/graders.js");
class Alpha extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.graders = new GradersAPI.Graders(this._client);
    }
}
exports.Alpha = Alpha;
Alpha.Graders = graders_1.Graders;
//# sourceMappingURL=alpha.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/alpha/graders.js"
/*!********************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/alpha/graders.js ***!
  \********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Graders = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
class Graders extends resource_1.APIResource {
    /**
     * Run a grader.
     *
     * @example
     * ```ts
     * const response = await client.fineTuning.alpha.graders.run({
     *   grader: {
     *     input: 'input',
     *     name: 'name',
     *     operation: 'eq',
     *     reference: 'reference',
     *     type: 'string_check',
     *   },
     *   model_sample: 'model_sample',
     * });
     * ```
     */
    run(body, options) {
        return this._client.post('/fine_tuning/alpha/graders/run', { body, ...options });
    }
    /**
     * Validate a grader.
     *
     * @example
     * ```ts
     * const response =
     *   await client.fineTuning.alpha.graders.validate({
     *     grader: {
     *       input: 'input',
     *       name: 'name',
     *       operation: 'eq',
     *       reference: 'reference',
     *       type: 'string_check',
     *     },
     *   });
     * ```
     */
    validate(body, options) {
        return this._client.post('/fine_tuning/alpha/graders/validate', { body, ...options });
    }
}
exports.Graders = Graders;
//# sourceMappingURL=graders.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.js"
/*!******************************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.js ***!
  \******************************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Checkpoints = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const PermissionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./permissions.js */ "./node_modules/openai/resources/fine-tuning/checkpoints/permissions.js"));
const permissions_1 = __webpack_require__(/*! ./permissions.js */ "./node_modules/openai/resources/fine-tuning/checkpoints/permissions.js");
class Checkpoints extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.permissions = new PermissionsAPI.Permissions(this._client);
    }
}
exports.Checkpoints = Checkpoints;
Checkpoints.Permissions = permissions_1.Permissions;
//# sourceMappingURL=checkpoints.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/checkpoints/permissions.js"
/*!******************************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/checkpoints/permissions.js ***!
  \******************************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Permissions = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Permissions extends resource_1.APIResource {
    /**
     * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
     *
     * This enables organization owners to share fine-tuned models with other projects
     * in their organization.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const permissionCreateResponse of client.fineTuning.checkpoints.permissions.create(
     *   'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
     *   { project_ids: ['string'] },
     * )) {
     *   // ...
     * }
     * ```
     */
    create(fineTunedModelCheckpoint, body, options) {
        return this._client.getAPIList((0, path_1.path) `/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, (pagination_1.Page), { body, method: 'post', ...options });
    }
    /**
     * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
     *
     * Organization owners can use this endpoint to view all permissions for a
     * fine-tuned model checkpoint.
     *
     * @example
     * ```ts
     * const permission =
     *   await client.fineTuning.checkpoints.permissions.retrieve(
     *     'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     *   );
     * ```
     */
    retrieve(fineTunedModelCheckpoint, query = {}, options) {
        return this._client.get((0, path_1.path) `/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
            query,
            ...options,
        });
    }
    /**
     * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
     *
     * Organization owners can use this endpoint to delete a permission for a
     * fine-tuned model checkpoint.
     *
     * @example
     * ```ts
     * const permission =
     *   await client.fineTuning.checkpoints.permissions.delete(
     *     'cp_zc4Q7MP6XxulcVzj4MZdwsAB',
     *     {
     *       fine_tuned_model_checkpoint:
     *         'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
     *     },
     *   );
     * ```
     */
    delete(permissionID, params, options) {
        const { fine_tuned_model_checkpoint } = params;
        return this._client.delete((0, path_1.path) `/fine_tuning/checkpoints/${fine_tuned_model_checkpoint}/permissions/${permissionID}`, options);
    }
}
exports.Permissions = Permissions;
//# sourceMappingURL=permissions.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/fine-tuning.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/fine-tuning.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FineTuning = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const MethodsAPI = tslib_1.__importStar(__webpack_require__(/*! ./methods.js */ "./node_modules/openai/resources/fine-tuning/methods.js"));
const methods_1 = __webpack_require__(/*! ./methods.js */ "./node_modules/openai/resources/fine-tuning/methods.js");
const AlphaAPI = tslib_1.__importStar(__webpack_require__(/*! ./alpha/alpha.js */ "./node_modules/openai/resources/fine-tuning/alpha/alpha.js"));
const alpha_1 = __webpack_require__(/*! ./alpha/alpha.js */ "./node_modules/openai/resources/fine-tuning/alpha/alpha.js");
const CheckpointsAPI = tslib_1.__importStar(__webpack_require__(/*! ./checkpoints/checkpoints.js */ "./node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.js"));
const checkpoints_1 = __webpack_require__(/*! ./checkpoints/checkpoints.js */ "./node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.js");
const JobsAPI = tslib_1.__importStar(__webpack_require__(/*! ./jobs/jobs.js */ "./node_modules/openai/resources/fine-tuning/jobs/jobs.js"));
const jobs_1 = __webpack_require__(/*! ./jobs/jobs.js */ "./node_modules/openai/resources/fine-tuning/jobs/jobs.js");
class FineTuning extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.methods = new MethodsAPI.Methods(this._client);
        this.jobs = new JobsAPI.Jobs(this._client);
        this.checkpoints = new CheckpointsAPI.Checkpoints(this._client);
        this.alpha = new AlphaAPI.Alpha(this._client);
    }
}
exports.FineTuning = FineTuning;
FineTuning.Methods = methods_1.Methods;
FineTuning.Jobs = jobs_1.Jobs;
FineTuning.Checkpoints = checkpoints_1.Checkpoints;
FineTuning.Alpha = alpha_1.Alpha;
//# sourceMappingURL=fine-tuning.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/jobs/checkpoints.js"
/*!***********************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/jobs/checkpoints.js ***!
  \***********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Checkpoints = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Checkpoints extends resource_1.APIResource {
    /**
     * List checkpoints for a fine-tuning job.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const fineTuningJobCheckpoint of client.fineTuning.jobs.checkpoints.list(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(fineTuningJobID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}/checkpoints`, (pagination_1.CursorPage), { query, ...options });
    }
}
exports.Checkpoints = Checkpoints;
//# sourceMappingURL=checkpoints.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/jobs/jobs.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/jobs/jobs.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Jobs = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const CheckpointsAPI = tslib_1.__importStar(__webpack_require__(/*! ./checkpoints.js */ "./node_modules/openai/resources/fine-tuning/jobs/checkpoints.js"));
const checkpoints_1 = __webpack_require__(/*! ./checkpoints.js */ "./node_modules/openai/resources/fine-tuning/jobs/checkpoints.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Jobs extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.checkpoints = new CheckpointsAPI.Checkpoints(this._client);
    }
    /**
     * Creates a fine-tuning job which begins the process of creating a new model from
     * a given dataset.
     *
     * Response includes details of the enqueued job including job status and the name
     * of the fine-tuned models once complete.
     *
     * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.create({
     *   model: 'gpt-4o-mini',
     *   training_file: 'file-abc123',
     * });
     * ```
     */
    create(body, options) {
        return this._client.post('/fine_tuning/jobs', { body, ...options });
    }
    /**
     * Get info about a fine-tuning job.
     *
     * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.retrieve(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    retrieve(fineTuningJobID, options) {
        return this._client.get((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}`, options);
    }
    /**
     * List your organization's fine-tuning jobs
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const fineTuningJob of client.fineTuning.jobs.list()) {
     *   // ...
     * }
     * ```
     */
    list(query = {}, options) {
        return this._client.getAPIList('/fine_tuning/jobs', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Immediately cancel a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.cancel(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    cancel(fineTuningJobID, options) {
        return this._client.post((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}/cancel`, options);
    }
    /**
     * Get status updates for a fine-tuning job.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const fineTuningJobEvent of client.fineTuning.jobs.listEvents(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * )) {
     *   // ...
     * }
     * ```
     */
    listEvents(fineTuningJobID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}/events`, (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Pause a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.pause(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    pause(fineTuningJobID, options) {
        return this._client.post((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}/pause`, options);
    }
    /**
     * Resume a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.resume(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    resume(fineTuningJobID, options) {
        return this._client.post((0, path_1.path) `/fine_tuning/jobs/${fineTuningJobID}/resume`, options);
    }
}
exports.Jobs = Jobs;
Jobs.Checkpoints = checkpoints_1.Checkpoints;
//# sourceMappingURL=jobs.js.map

/***/ },

/***/ "./node_modules/openai/resources/fine-tuning/methods.js"
/*!**************************************************************!*\
  !*** ./node_modules/openai/resources/fine-tuning/methods.js ***!
  \**************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Methods = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
class Methods extends resource_1.APIResource {
}
exports.Methods = Methods;
//# sourceMappingURL=methods.js.map

/***/ },

/***/ "./node_modules/openai/resources/graders/grader-models.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/graders/grader-models.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GraderModels = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
class GraderModels extends resource_1.APIResource {
}
exports.GraderModels = GraderModels;
//# sourceMappingURL=grader-models.js.map

/***/ },

/***/ "./node_modules/openai/resources/graders/graders.js"
/*!**********************************************************!*\
  !*** ./node_modules/openai/resources/graders/graders.js ***!
  \**********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Graders = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const GraderModelsAPI = tslib_1.__importStar(__webpack_require__(/*! ./grader-models.js */ "./node_modules/openai/resources/graders/grader-models.js"));
const grader_models_1 = __webpack_require__(/*! ./grader-models.js */ "./node_modules/openai/resources/graders/grader-models.js");
class Graders extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.graderModels = new GraderModelsAPI.GraderModels(this._client);
    }
}
exports.Graders = Graders;
Graders.GraderModels = grader_models_1.GraderModels;
//# sourceMappingURL=graders.js.map

/***/ },

/***/ "./node_modules/openai/resources/images.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/resources/images.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Images = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const uploads_1 = __webpack_require__(/*! ../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
class Images extends resource_1.APIResource {
    /**
     * Creates a variation of a given image. This endpoint only supports `dall-e-2`.
     *
     * @example
     * ```ts
     * const imagesResponse = await client.images.createVariation({
     *   image: fs.createReadStream('otter.png'),
     * });
     * ```
     */
    createVariation(body, options) {
        return this._client.post('/images/variations', (0, uploads_1.multipartFormRequestOptions)({ body, ...options }, this._client));
    }
    edit(body, options) {
        return this._client.post('/images/edits', (0, uploads_1.multipartFormRequestOptions)({ body, ...options, stream: body.stream ?? false }, this._client));
    }
    generate(body, options) {
        return this._client.post('/images/generations', { body, ...options, stream: body.stream ?? false });
    }
}
exports.Images = Images;
//# sourceMappingURL=images.js.map

/***/ },

/***/ "./node_modules/openai/resources/index.js"
/*!************************************************!*\
  !*** ./node_modules/openai/resources/index.js ***!
  \************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Webhooks = exports.Videos = exports.VectorStores = exports.Uploads = exports.Skills = exports.Responses = exports.Realtime = exports.Moderations = exports.Models = exports.Images = exports.Graders = exports.FineTuning = exports.Files = exports.Evals = exports.Embeddings = exports.Conversations = exports.Containers = exports.Completions = exports.Beta = exports.Batches = exports.Audio = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
tslib_1.__exportStar(__webpack_require__(/*! ./chat/index.js */ "./node_modules/openai/resources/chat/index.js"), exports);
tslib_1.__exportStar(__webpack_require__(/*! ./shared.js */ "./node_modules/openai/resources/shared.js"), exports);
var audio_1 = __webpack_require__(/*! ./audio/audio.js */ "./node_modules/openai/resources/audio/audio.js");
Object.defineProperty(exports, "Audio", ({ enumerable: true, get: function () { return audio_1.Audio; } }));
var batches_1 = __webpack_require__(/*! ./batches.js */ "./node_modules/openai/resources/batches.js");
Object.defineProperty(exports, "Batches", ({ enumerable: true, get: function () { return batches_1.Batches; } }));
var beta_1 = __webpack_require__(/*! ./beta/beta.js */ "./node_modules/openai/resources/beta/beta.js");
Object.defineProperty(exports, "Beta", ({ enumerable: true, get: function () { return beta_1.Beta; } }));
var completions_1 = __webpack_require__(/*! ./completions.js */ "./node_modules/openai/resources/completions.js");
Object.defineProperty(exports, "Completions", ({ enumerable: true, get: function () { return completions_1.Completions; } }));
var containers_1 = __webpack_require__(/*! ./containers/containers.js */ "./node_modules/openai/resources/containers/containers.js");
Object.defineProperty(exports, "Containers", ({ enumerable: true, get: function () { return containers_1.Containers; } }));
var conversations_1 = __webpack_require__(/*! ./conversations/conversations.js */ "./node_modules/openai/resources/conversations/conversations.js");
Object.defineProperty(exports, "Conversations", ({ enumerable: true, get: function () { return conversations_1.Conversations; } }));
var embeddings_1 = __webpack_require__(/*! ./embeddings.js */ "./node_modules/openai/resources/embeddings.js");
Object.defineProperty(exports, "Embeddings", ({ enumerable: true, get: function () { return embeddings_1.Embeddings; } }));
var evals_1 = __webpack_require__(/*! ./evals/evals.js */ "./node_modules/openai/resources/evals/evals.js");
Object.defineProperty(exports, "Evals", ({ enumerable: true, get: function () { return evals_1.Evals; } }));
var files_1 = __webpack_require__(/*! ./files.js */ "./node_modules/openai/resources/files.js");
Object.defineProperty(exports, "Files", ({ enumerable: true, get: function () { return files_1.Files; } }));
var fine_tuning_1 = __webpack_require__(/*! ./fine-tuning/fine-tuning.js */ "./node_modules/openai/resources/fine-tuning/fine-tuning.js");
Object.defineProperty(exports, "FineTuning", ({ enumerable: true, get: function () { return fine_tuning_1.FineTuning; } }));
var graders_1 = __webpack_require__(/*! ./graders/graders.js */ "./node_modules/openai/resources/graders/graders.js");
Object.defineProperty(exports, "Graders", ({ enumerable: true, get: function () { return graders_1.Graders; } }));
var images_1 = __webpack_require__(/*! ./images.js */ "./node_modules/openai/resources/images.js");
Object.defineProperty(exports, "Images", ({ enumerable: true, get: function () { return images_1.Images; } }));
var models_1 = __webpack_require__(/*! ./models.js */ "./node_modules/openai/resources/models.js");
Object.defineProperty(exports, "Models", ({ enumerable: true, get: function () { return models_1.Models; } }));
var moderations_1 = __webpack_require__(/*! ./moderations.js */ "./node_modules/openai/resources/moderations.js");
Object.defineProperty(exports, "Moderations", ({ enumerable: true, get: function () { return moderations_1.Moderations; } }));
var realtime_1 = __webpack_require__(/*! ./realtime/realtime.js */ "./node_modules/openai/resources/realtime/realtime.js");
Object.defineProperty(exports, "Realtime", ({ enumerable: true, get: function () { return realtime_1.Realtime; } }));
var responses_1 = __webpack_require__(/*! ./responses/responses.js */ "./node_modules/openai/resources/responses/responses.js");
Object.defineProperty(exports, "Responses", ({ enumerable: true, get: function () { return responses_1.Responses; } }));
var skills_1 = __webpack_require__(/*! ./skills/skills.js */ "./node_modules/openai/resources/skills/skills.js");
Object.defineProperty(exports, "Skills", ({ enumerable: true, get: function () { return skills_1.Skills; } }));
var uploads_1 = __webpack_require__(/*! ./uploads/uploads.js */ "./node_modules/openai/resources/uploads/uploads.js");
Object.defineProperty(exports, "Uploads", ({ enumerable: true, get: function () { return uploads_1.Uploads; } }));
var vector_stores_1 = __webpack_require__(/*! ./vector-stores/vector-stores.js */ "./node_modules/openai/resources/vector-stores/vector-stores.js");
Object.defineProperty(exports, "VectorStores", ({ enumerable: true, get: function () { return vector_stores_1.VectorStores; } }));
var videos_1 = __webpack_require__(/*! ./videos.js */ "./node_modules/openai/resources/videos.js");
Object.defineProperty(exports, "Videos", ({ enumerable: true, get: function () { return videos_1.Videos; } }));
var webhooks_1 = __webpack_require__(/*! ./webhooks.js */ "./node_modules/openai/resources/webhooks.js");
Object.defineProperty(exports, "Webhooks", ({ enumerable: true, get: function () { return webhooks_1.Webhooks; } }));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/openai/resources/models.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/resources/models.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Models = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Models extends resource_1.APIResource {
    /**
     * Retrieves a model instance, providing basic information about the model such as
     * the owner and permissioning.
     */
    retrieve(model, options) {
        return this._client.get((0, path_1.path) `/models/${model}`, options);
    }
    /**
     * Lists the currently available models, and provides basic information about each
     * one such as the owner and availability.
     */
    list(options) {
        return this._client.getAPIList('/models', (pagination_1.Page), options);
    }
    /**
     * Delete a fine-tuned model. You must have the Owner role in your organization to
     * delete a model.
     */
    delete(model, options) {
        return this._client.delete((0, path_1.path) `/models/${model}`, options);
    }
}
exports.Models = Models;
//# sourceMappingURL=models.js.map

/***/ },

/***/ "./node_modules/openai/resources/moderations.js"
/*!******************************************************!*\
  !*** ./node_modules/openai/resources/moderations.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Moderations = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
class Moderations extends resource_1.APIResource {
    /**
     * Classifies if text and/or image inputs are potentially harmful. Learn more in
     * the [moderation guide](https://platform.openai.com/docs/guides/moderation).
     */
    create(body, options) {
        return this._client.post('/moderations', { body, ...options });
    }
}
exports.Moderations = Moderations;
//# sourceMappingURL=moderations.js.map

/***/ },

/***/ "./node_modules/openai/resources/realtime/calls.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/resources/realtime/calls.js ***!
  \*********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Calls = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Calls extends resource_1.APIResource {
    /**
     * Accept an incoming SIP call and configure the realtime session that will handle
     * it.
     *
     * @example
     * ```ts
     * await client.realtime.calls.accept('call_id', {
     *   type: 'realtime',
     * });
     * ```
     */
    accept(callID, body, options) {
        return this._client.post((0, path_1.path) `/realtime/calls/${callID}/accept`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
    /**
     * End an active Realtime API call, whether it was initiated over SIP or WebRTC.
     *
     * @example
     * ```ts
     * await client.realtime.calls.hangup('call_id');
     * ```
     */
    hangup(callID, options) {
        return this._client.post((0, path_1.path) `/realtime/calls/${callID}/hangup`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
    /**
     * Transfer an active SIP call to a new destination using the SIP REFER verb.
     *
     * @example
     * ```ts
     * await client.realtime.calls.refer('call_id', {
     *   target_uri: 'tel:+14155550123',
     * });
     * ```
     */
    refer(callID, body, options) {
        return this._client.post((0, path_1.path) `/realtime/calls/${callID}/refer`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
    /**
     * Decline an incoming SIP call by returning a SIP status code to the caller.
     *
     * @example
     * ```ts
     * await client.realtime.calls.reject('call_id');
     * ```
     */
    reject(callID, body = {}, options) {
        return this._client.post((0, path_1.path) `/realtime/calls/${callID}/reject`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
}
exports.Calls = Calls;
//# sourceMappingURL=calls.js.map

/***/ },

/***/ "./node_modules/openai/resources/realtime/client-secrets.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/realtime/client-secrets.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ClientSecrets = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
class ClientSecrets extends resource_1.APIResource {
    /**
     * Create a Realtime client secret with an associated session configuration.
     *
     * @example
     * ```ts
     * const clientSecret =
     *   await client.realtime.clientSecrets.create();
     * ```
     */
    create(body, options) {
        return this._client.post('/realtime/client_secrets', { body, ...options });
    }
}
exports.ClientSecrets = ClientSecrets;
//# sourceMappingURL=client-secrets.js.map

/***/ },

/***/ "./node_modules/openai/resources/realtime/realtime.js"
/*!************************************************************!*\
  !*** ./node_modules/openai/resources/realtime/realtime.js ***!
  \************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Realtime = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const CallsAPI = tslib_1.__importStar(__webpack_require__(/*! ./calls.js */ "./node_modules/openai/resources/realtime/calls.js"));
const calls_1 = __webpack_require__(/*! ./calls.js */ "./node_modules/openai/resources/realtime/calls.js");
const ClientSecretsAPI = tslib_1.__importStar(__webpack_require__(/*! ./client-secrets.js */ "./node_modules/openai/resources/realtime/client-secrets.js"));
const client_secrets_1 = __webpack_require__(/*! ./client-secrets.js */ "./node_modules/openai/resources/realtime/client-secrets.js");
class Realtime extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.clientSecrets = new ClientSecretsAPI.ClientSecrets(this._client);
        this.calls = new CallsAPI.Calls(this._client);
    }
}
exports.Realtime = Realtime;
Realtime.ClientSecrets = client_secrets_1.ClientSecrets;
Realtime.Calls = calls_1.Calls;
//# sourceMappingURL=realtime.js.map

/***/ },

/***/ "./node_modules/openai/resources/responses/input-items.js"
/*!****************************************************************!*\
  !*** ./node_modules/openai/resources/responses/input-items.js ***!
  \****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.InputItems = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class InputItems extends resource_1.APIResource {
    /**
     * Returns a list of input items for a given response.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const responseItem of client.responses.inputItems.list(
     *   'response_id',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(responseID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/responses/${responseID}/input_items`, (pagination_1.CursorPage), { query, ...options });
    }
}
exports.InputItems = InputItems;
//# sourceMappingURL=input-items.js.map

/***/ },

/***/ "./node_modules/openai/resources/responses/input-tokens.js"
/*!*****************************************************************!*\
  !*** ./node_modules/openai/resources/responses/input-tokens.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.InputTokens = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
class InputTokens extends resource_1.APIResource {
    /**
     * Get input token counts
     *
     * @example
     * ```ts
     * const response = await client.responses.inputTokens.count();
     * ```
     */
    count(body = {}, options) {
        return this._client.post('/responses/input_tokens', { body, ...options });
    }
}
exports.InputTokens = InputTokens;
//# sourceMappingURL=input-tokens.js.map

/***/ },

/***/ "./node_modules/openai/resources/responses/responses.js"
/*!**************************************************************!*\
  !*** ./node_modules/openai/resources/responses/responses.js ***!
  \**************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Responses = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const ResponsesParser_1 = __webpack_require__(/*! ../../lib/ResponsesParser.js */ "./node_modules/openai/lib/ResponsesParser.js");
const ResponseStream_1 = __webpack_require__(/*! ../../lib/responses/ResponseStream.js */ "./node_modules/openai/lib/responses/ResponseStream.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const InputItemsAPI = tslib_1.__importStar(__webpack_require__(/*! ./input-items.js */ "./node_modules/openai/resources/responses/input-items.js"));
const input_items_1 = __webpack_require__(/*! ./input-items.js */ "./node_modules/openai/resources/responses/input-items.js");
const InputTokensAPI = tslib_1.__importStar(__webpack_require__(/*! ./input-tokens.js */ "./node_modules/openai/resources/responses/input-tokens.js"));
const input_tokens_1 = __webpack_require__(/*! ./input-tokens.js */ "./node_modules/openai/resources/responses/input-tokens.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Responses extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.inputItems = new InputItemsAPI.InputItems(this._client);
        this.inputTokens = new InputTokensAPI.InputTokens(this._client);
    }
    create(body, options) {
        return this._client.post('/responses', { body, ...options, stream: body.stream ?? false })._thenUnwrap((rsp) => {
            if ('object' in rsp && rsp.object === 'response') {
                (0, ResponsesParser_1.addOutputText)(rsp);
            }
            return rsp;
        });
    }
    retrieve(responseID, query = {}, options) {
        return this._client.get((0, path_1.path) `/responses/${responseID}`, {
            query,
            ...options,
            stream: query?.stream ?? false,
        })._thenUnwrap((rsp) => {
            if ('object' in rsp && rsp.object === 'response') {
                (0, ResponsesParser_1.addOutputText)(rsp);
            }
            return rsp;
        });
    }
    /**
     * Deletes a model response with the given ID.
     *
     * @example
     * ```ts
     * await client.responses.delete(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    delete(responseID, options) {
        return this._client.delete((0, path_1.path) `/responses/${responseID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: '*/*' }, options?.headers]),
        });
    }
    parse(body, options) {
        return this._client.responses
            .create(body, options)
            ._thenUnwrap((response) => (0, ResponsesParser_1.parseResponse)(response, body));
    }
    /**
     * Creates a model response stream
     */
    stream(body, options) {
        return ResponseStream_1.ResponseStream.createResponse(this._client, body, options);
    }
    /**
     * Cancels a model response with the given ID. Only responses created with the
     * `background` parameter set to `true` can be cancelled.
     * [Learn more](https://platform.openai.com/docs/guides/background).
     *
     * @example
     * ```ts
     * const response = await client.responses.cancel(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    cancel(responseID, options) {
        return this._client.post((0, path_1.path) `/responses/${responseID}/cancel`, options);
    }
    /**
     * Compact conversation
     *
     * @example
     * ```ts
     * const compactedResponse = await client.responses.compact({
     *   model: 'gpt-5.2',
     * });
     * ```
     */
    compact(body, options) {
        return this._client.post('/responses/compact', { body, ...options });
    }
}
exports.Responses = Responses;
Responses.InputItems = input_items_1.InputItems;
Responses.InputTokens = input_tokens_1.InputTokens;
//# sourceMappingURL=responses.js.map

/***/ },

/***/ "./node_modules/openai/resources/shared.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/resources/shared.js ***!
  \*************************************************/
(__unused_webpack_module, exports) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
//# sourceMappingURL=shared.js.map

/***/ },

/***/ "./node_modules/openai/resources/skills/content.js"
/*!*********************************************************!*\
  !*** ./node_modules/openai/resources/skills/content.js ***!
  \*********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Content = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Content extends resource_1.APIResource {
    /**
     * Get Skill Content
     */
    retrieve(skillID, options) {
        return this._client.get((0, path_1.path) `/skills/${skillID}/content`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/binary' }, options?.headers]),
            __binaryResponse: true,
        });
    }
}
exports.Content = Content;
//# sourceMappingURL=content.js.map

/***/ },

/***/ "./node_modules/openai/resources/skills/skills.js"
/*!********************************************************!*\
  !*** ./node_modules/openai/resources/skills/skills.js ***!
  \********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Skills = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const ContentAPI = tslib_1.__importStar(__webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/skills/content.js"));
const content_1 = __webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/skills/content.js");
const VersionsAPI = tslib_1.__importStar(__webpack_require__(/*! ./versions/versions.js */ "./node_modules/openai/resources/skills/versions/versions.js"));
const versions_1 = __webpack_require__(/*! ./versions/versions.js */ "./node_modules/openai/resources/skills/versions/versions.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const uploads_1 = __webpack_require__(/*! ../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Skills extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.content = new ContentAPI.Content(this._client);
        this.versions = new VersionsAPI.Versions(this._client);
    }
    /**
     * Create Skill
     */
    create(body = {}, options) {
        return this._client.post('/skills', (0, uploads_1.maybeMultipartFormRequestOptions)({ body, ...options }, this._client));
    }
    /**
     * Get Skill
     */
    retrieve(skillID, options) {
        return this._client.get((0, path_1.path) `/skills/${skillID}`, options);
    }
    /**
     * Update Skill Default Version
     */
    update(skillID, body, options) {
        return this._client.post((0, path_1.path) `/skills/${skillID}`, { body, ...options });
    }
    /**
     * List Skills
     */
    list(query = {}, options) {
        return this._client.getAPIList('/skills', (pagination_1.CursorPage), { query, ...options });
    }
    /**
     * Delete Skill
     */
    delete(skillID, options) {
        return this._client.delete((0, path_1.path) `/skills/${skillID}`, options);
    }
}
exports.Skills = Skills;
Skills.Content = content_1.Content;
Skills.Versions = versions_1.Versions;
//# sourceMappingURL=skills.js.map

/***/ },

/***/ "./node_modules/openai/resources/skills/versions/content.js"
/*!******************************************************************!*\
  !*** ./node_modules/openai/resources/skills/versions/content.js ***!
  \******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Content = void 0;
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Content extends resource_1.APIResource {
    /**
     * Get Skill Version Content
     */
    retrieve(version, params, options) {
        const { skill_id } = params;
        return this._client.get((0, path_1.path) `/skills/${skill_id}/versions/${version}/content`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/binary' }, options?.headers]),
            __binaryResponse: true,
        });
    }
}
exports.Content = Content;
//# sourceMappingURL=content.js.map

/***/ },

/***/ "./node_modules/openai/resources/skills/versions/versions.js"
/*!*******************************************************************!*\
  !*** ./node_modules/openai/resources/skills/versions/versions.js ***!
  \*******************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Versions = void 0;
const tslib_1 = __webpack_require__(/*! ../../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../../core/resource.js */ "./node_modules/openai/core/resource.js");
const ContentAPI = tslib_1.__importStar(__webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/skills/versions/content.js"));
const content_1 = __webpack_require__(/*! ./content.js */ "./node_modules/openai/resources/skills/versions/content.js");
const pagination_1 = __webpack_require__(/*! ../../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const uploads_1 = __webpack_require__(/*! ../../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Versions extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.content = new ContentAPI.Content(this._client);
    }
    /**
     * Create Skill Version
     */
    create(skillID, body = {}, options) {
        return this._client.post((0, path_1.path) `/skills/${skillID}/versions`, (0, uploads_1.maybeMultipartFormRequestOptions)({ body, ...options }, this._client));
    }
    /**
     * Get Skill Version
     */
    retrieve(version, params, options) {
        const { skill_id } = params;
        return this._client.get((0, path_1.path) `/skills/${skill_id}/versions/${version}`, options);
    }
    /**
     * List Skill Versions
     */
    list(skillID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/skills/${skillID}/versions`, (pagination_1.CursorPage), {
            query,
            ...options,
        });
    }
    /**
     * Delete Skill Version
     */
    delete(version, params, options) {
        const { skill_id } = params;
        return this._client.delete((0, path_1.path) `/skills/${skill_id}/versions/${version}`, options);
    }
}
exports.Versions = Versions;
Versions.Content = content_1.Content;
//# sourceMappingURL=versions.js.map

/***/ },

/***/ "./node_modules/openai/resources/uploads/parts.js"
/*!********************************************************!*\
  !*** ./node_modules/openai/resources/uploads/parts.js ***!
  \********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Parts = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const uploads_1 = __webpack_require__(/*! ../../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Parts extends resource_1.APIResource {
    /**
     * Adds a
     * [Part](https://platform.openai.com/docs/api-reference/uploads/part-object) to an
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object.
     * A Part represents a chunk of bytes from the file you are trying to upload.
     *
     * Each Part can be at most 64 MB, and you can add Parts until you hit the Upload
     * maximum of 8 GB.
     *
     * It is possible to add multiple Parts in parallel. You can decide the intended
     * order of the Parts when you
     * [complete the Upload](https://platform.openai.com/docs/api-reference/uploads/complete).
     */
    create(uploadID, body, options) {
        return this._client.post((0, path_1.path) `/uploads/${uploadID}/parts`, (0, uploads_1.multipartFormRequestOptions)({ body, ...options }, this._client));
    }
}
exports.Parts = Parts;
//# sourceMappingURL=parts.js.map

/***/ },

/***/ "./node_modules/openai/resources/uploads/uploads.js"
/*!**********************************************************!*\
  !*** ./node_modules/openai/resources/uploads/uploads.js ***!
  \**********************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Uploads = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const PartsAPI = tslib_1.__importStar(__webpack_require__(/*! ./parts.js */ "./node_modules/openai/resources/uploads/parts.js"));
const parts_1 = __webpack_require__(/*! ./parts.js */ "./node_modules/openai/resources/uploads/parts.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Uploads extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.parts = new PartsAPI.Parts(this._client);
    }
    /**
     * Creates an intermediate
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object
     * that you can add
     * [Parts](https://platform.openai.com/docs/api-reference/uploads/part-object) to.
     * Currently, an Upload can accept at most 8 GB in total and expires after an hour
     * after you create it.
     *
     * Once you complete the Upload, we will create a
     * [File](https://platform.openai.com/docs/api-reference/files/object) object that
     * contains all the parts you uploaded. This File is usable in the rest of our
     * platform as a regular File object.
     *
     * For certain `purpose` values, the correct `mime_type` must be specified. Please
     * refer to documentation for the
     * [supported MIME types for your use case](https://platform.openai.com/docs/assistants/tools/file-search#supported-files).
     *
     * For guidance on the proper filename extensions for each purpose, please follow
     * the documentation on
     * [creating a File](https://platform.openai.com/docs/api-reference/files/create).
     */
    create(body, options) {
        return this._client.post('/uploads', { body, ...options });
    }
    /**
     * Cancels the Upload. No Parts may be added after an Upload is cancelled.
     */
    cancel(uploadID, options) {
        return this._client.post((0, path_1.path) `/uploads/${uploadID}/cancel`, options);
    }
    /**
     * Completes the
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object).
     *
     * Within the returned Upload object, there is a nested
     * [File](https://platform.openai.com/docs/api-reference/files/object) object that
     * is ready to use in the rest of the platform.
     *
     * You can specify the order of the Parts by passing in an ordered list of the Part
     * IDs.
     *
     * The number of bytes uploaded upon completion must match the number of bytes
     * initially specified when creating the Upload object. No Parts may be added after
     * an Upload is completed.
     */
    complete(uploadID, body, options) {
        return this._client.post((0, path_1.path) `/uploads/${uploadID}/complete`, { body, ...options });
    }
}
exports.Uploads = Uploads;
Uploads.Parts = parts_1.Parts;
//# sourceMappingURL=uploads.js.map

/***/ },

/***/ "./node_modules/openai/resources/vector-stores/file-batches.js"
/*!*********************************************************************!*\
  !*** ./node_modules/openai/resources/vector-stores/file-batches.js ***!
  \*********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FileBatches = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const sleep_1 = __webpack_require__(/*! ../../internal/utils/sleep.js */ "./node_modules/openai/internal/utils/sleep.js");
const Util_1 = __webpack_require__(/*! ../../lib/Util.js */ "./node_modules/openai/lib/Util.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class FileBatches extends resource_1.APIResource {
    /**
     * Create a vector store file batch.
     */
    create(vectorStoreID, body, options) {
        return this._client.post((0, path_1.path) `/vector_stores/${vectorStoreID}/file_batches`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieves a vector store file batch.
     */
    retrieve(batchID, params, options) {
        const { vector_store_id } = params;
        return this._client.get((0, path_1.path) `/vector_stores/${vector_store_id}/file_batches/${batchID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Cancel a vector store file batch. This attempts to cancel the processing of
     * files in this batch as soon as possible.
     */
    cancel(batchID, params, options) {
        const { vector_store_id } = params;
        return this._client.post((0, path_1.path) `/vector_stores/${vector_store_id}/file_batches/${batchID}/cancel`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Create a vector store batch and poll until all files have been processed.
     */
    async createAndPoll(vectorStoreId, body, options) {
        const batch = await this.create(vectorStoreId, body);
        return await this.poll(vectorStoreId, batch.id, options);
    }
    /**
     * Returns a list of vector store files in a batch.
     */
    listFiles(batchID, params, options) {
        const { vector_store_id, ...query } = params;
        return this._client.getAPIList((0, path_1.path) `/vector_stores/${vector_store_id}/file_batches/${batchID}/files`, (pagination_1.CursorPage), { query, ...options, headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]) });
    }
    /**
     * Wait for the given file batch to be processed.
     *
     * Note: this will return even if one of the files failed to process, you need to
     * check batch.file_counts.failed_count to handle this case.
     */
    async poll(vectorStoreID, batchID, options) {
        const headers = (0, headers_1.buildHeaders)([
            options?.headers,
            {
                'X-Stainless-Poll-Helper': 'true',
                'X-Stainless-Custom-Poll-Interval': options?.pollIntervalMs?.toString() ?? undefined,
            },
        ]);
        while (true) {
            const { data: batch, response } = await this.retrieve(batchID, { vector_store_id: vectorStoreID }, {
                ...options,
                headers,
            }).withResponse();
            switch (batch.status) {
                case 'in_progress':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await (0, sleep_1.sleep)(sleepInterval);
                    break;
                case 'failed':
                case 'cancelled':
                case 'completed':
                    return batch;
            }
        }
    }
    /**
     * Uploads the given files concurrently and then creates a vector store file batch.
     *
     * The concurrency limit is configurable using the `maxConcurrency` parameter.
     */
    async uploadAndPoll(vectorStoreId, { files, fileIds = [] }, options) {
        if (files == null || files.length == 0) {
            throw new Error(`No \`files\` provided to process. If you've already uploaded files you should use \`.createAndPoll()\` instead`);
        }
        const configuredConcurrency = options?.maxConcurrency ?? 5;
        // We cap the number of workers at the number of files (so we don't start any unnecessary workers)
        const concurrencyLimit = Math.min(configuredConcurrency, files.length);
        const client = this._client;
        const fileIterator = files.values();
        const allFileIds = [...fileIds];
        // This code is based on this design. The libraries don't accommodate our environment limits.
        // https://stackoverflow.com/questions/40639432/what-is-the-best-way-to-limit-concurrency-when-using-es6s-promise-all
        async function processFiles(iterator) {
            for (let item of iterator) {
                const fileObj = await client.files.create({ file: item, purpose: 'assistants' }, options);
                allFileIds.push(fileObj.id);
            }
        }
        // Start workers to process results
        const workers = Array(concurrencyLimit).fill(fileIterator).map(processFiles);
        // Wait for all processing to complete.
        await (0, Util_1.allSettledWithThrow)(workers);
        return await this.createAndPoll(vectorStoreId, {
            file_ids: allFileIds,
        });
    }
}
exports.FileBatches = FileBatches;
//# sourceMappingURL=file-batches.js.map

/***/ },

/***/ "./node_modules/openai/resources/vector-stores/files.js"
/*!**************************************************************!*\
  !*** ./node_modules/openai/resources/vector-stores/files.js ***!
  \**************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Files = void 0;
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const utils_1 = __webpack_require__(/*! ../../internal/utils.js */ "./node_modules/openai/internal/utils.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Files extends resource_1.APIResource {
    /**
     * Create a vector store file by attaching a
     * [File](https://platform.openai.com/docs/api-reference/files) to a
     * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object).
     */
    create(vectorStoreID, body, options) {
        return this._client.post((0, path_1.path) `/vector_stores/${vectorStoreID}/files`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieves a vector store file.
     */
    retrieve(fileID, params, options) {
        const { vector_store_id } = params;
        return this._client.get((0, path_1.path) `/vector_stores/${vector_store_id}/files/${fileID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Update attributes on a vector store file.
     */
    update(fileID, params, options) {
        const { vector_store_id, ...body } = params;
        return this._client.post((0, path_1.path) `/vector_stores/${vector_store_id}/files/${fileID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of vector store files.
     */
    list(vectorStoreID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/vector_stores/${vectorStoreID}/files`, (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Delete a vector store file. This will remove the file from the vector store but
     * the file itself will not be deleted. To delete the file, use the
     * [delete file](https://platform.openai.com/docs/api-reference/files/delete)
     * endpoint.
     */
    delete(fileID, params, options) {
        const { vector_store_id } = params;
        return this._client.delete((0, path_1.path) `/vector_stores/${vector_store_id}/files/${fileID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Attach a file to the given vector store and wait for it to be processed.
     */
    async createAndPoll(vectorStoreId, body, options) {
        const file = await this.create(vectorStoreId, body, options);
        return await this.poll(vectorStoreId, file.id, options);
    }
    /**
     * Wait for the vector store file to finish processing.
     *
     * Note: this will return even if the file failed to process, you need to check
     * file.last_error and file.status to handle these cases
     */
    async poll(vectorStoreID, fileID, options) {
        const headers = (0, headers_1.buildHeaders)([
            options?.headers,
            {
                'X-Stainless-Poll-Helper': 'true',
                'X-Stainless-Custom-Poll-Interval': options?.pollIntervalMs?.toString() ?? undefined,
            },
        ]);
        while (true) {
            const fileResponse = await this.retrieve(fileID, {
                vector_store_id: vectorStoreID,
            }, { ...options, headers }).withResponse();
            const file = fileResponse.data;
            switch (file.status) {
                case 'in_progress':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = fileResponse.response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await (0, utils_1.sleep)(sleepInterval);
                    break;
                case 'failed':
                case 'completed':
                    return file;
            }
        }
    }
    /**
     * Upload a file to the `files` API and then attach it to the given vector store.
     *
     * Note the file will be asynchronously processed (you can use the alternative
     * polling helper method to wait for processing to complete).
     */
    async upload(vectorStoreId, file, options) {
        const fileInfo = await this._client.files.create({ file: file, purpose: 'assistants' }, options);
        return this.create(vectorStoreId, { file_id: fileInfo.id }, options);
    }
    /**
     * Add a file to a vector store and poll until processing is complete.
     */
    async uploadAndPoll(vectorStoreId, file, options) {
        const fileInfo = await this.upload(vectorStoreId, file, options);
        return await this.poll(vectorStoreId, fileInfo.id, options);
    }
    /**
     * Retrieve the parsed contents of a vector store file.
     */
    content(fileID, params, options) {
        const { vector_store_id } = params;
        return this._client.getAPIList((0, path_1.path) `/vector_stores/${vector_store_id}/files/${fileID}/content`, (pagination_1.Page), { ...options, headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]) });
    }
}
exports.Files = Files;
//# sourceMappingURL=files.js.map

/***/ },

/***/ "./node_modules/openai/resources/vector-stores/vector-stores.js"
/*!**********************************************************************!*\
  !*** ./node_modules/openai/resources/vector-stores/vector-stores.js ***!
  \**********************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.VectorStores = void 0;
const tslib_1 = __webpack_require__(/*! ../../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const resource_1 = __webpack_require__(/*! ../../core/resource.js */ "./node_modules/openai/core/resource.js");
const FileBatchesAPI = tslib_1.__importStar(__webpack_require__(/*! ./file-batches.js */ "./node_modules/openai/resources/vector-stores/file-batches.js"));
const file_batches_1 = __webpack_require__(/*! ./file-batches.js */ "./node_modules/openai/resources/vector-stores/file-batches.js");
const FilesAPI = tslib_1.__importStar(__webpack_require__(/*! ./files.js */ "./node_modules/openai/resources/vector-stores/files.js"));
const files_1 = __webpack_require__(/*! ./files.js */ "./node_modules/openai/resources/vector-stores/files.js");
const pagination_1 = __webpack_require__(/*! ../../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const path_1 = __webpack_require__(/*! ../../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class VectorStores extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.files = new FilesAPI.Files(this._client);
        this.fileBatches = new FileBatchesAPI.FileBatches(this._client);
    }
    /**
     * Create a vector store.
     */
    create(body, options) {
        return this._client.post('/vector_stores', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Retrieves a vector store.
     */
    retrieve(vectorStoreID, options) {
        return this._client.get((0, path_1.path) `/vector_stores/${vectorStoreID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Modifies a vector store.
     */
    update(vectorStoreID, body, options) {
        return this._client.post((0, path_1.path) `/vector_stores/${vectorStoreID}`, {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Returns a list of vector stores.
     */
    list(query = {}, options) {
        return this._client.getAPIList('/vector_stores', (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Delete a vector store.
     */
    delete(vectorStoreID, options) {
        return this._client.delete((0, path_1.path) `/vector_stores/${vectorStoreID}`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
    /**
     * Search a vector store for relevant chunks based on a query and file attributes
     * filter.
     */
    search(vectorStoreID, body, options) {
        return this._client.getAPIList((0, path_1.path) `/vector_stores/${vectorStoreID}/search`, (pagination_1.Page), {
            body,
            method: 'post',
            ...options,
            headers: (0, headers_1.buildHeaders)([{ 'OpenAI-Beta': 'assistants=v2' }, options?.headers]),
        });
    }
}
exports.VectorStores = VectorStores;
VectorStores.Files = files_1.Files;
VectorStores.FileBatches = file_batches_1.FileBatches;
//# sourceMappingURL=vector-stores.js.map

/***/ },

/***/ "./node_modules/openai/resources/videos.js"
/*!*************************************************!*\
  !*** ./node_modules/openai/resources/videos.js ***!
  \*************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Videos = void 0;
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const pagination_1 = __webpack_require__(/*! ../core/pagination.js */ "./node_modules/openai/core/pagination.js");
const headers_1 = __webpack_require__(/*! ../internal/headers.js */ "./node_modules/openai/internal/headers.js");
const uploads_1 = __webpack_require__(/*! ../internal/uploads.js */ "./node_modules/openai/internal/uploads.js");
const path_1 = __webpack_require__(/*! ../internal/utils/path.js */ "./node_modules/openai/internal/utils/path.js");
class Videos extends resource_1.APIResource {
    /**
     * Create a video
     */
    create(body, options) {
        return this._client.post('/videos', (0, uploads_1.maybeMultipartFormRequestOptions)({ body, ...options }, this._client));
    }
    /**
     * Retrieve a video
     */
    retrieve(videoID, options) {
        return this._client.get((0, path_1.path) `/videos/${videoID}`, options);
    }
    /**
     * List videos
     */
    list(query = {}, options) {
        return this._client.getAPIList('/videos', (pagination_1.ConversationCursorPage), { query, ...options });
    }
    /**
     * Delete a video
     */
    delete(videoID, options) {
        return this._client.delete((0, path_1.path) `/videos/${videoID}`, options);
    }
    /**
     * Download video content
     */
    downloadContent(videoID, query = {}, options) {
        return this._client.get((0, path_1.path) `/videos/${videoID}/content`, {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([{ Accept: 'application/binary' }, options?.headers]),
            __binaryResponse: true,
        });
    }
    /**
     * Create a video remix
     */
    remix(videoID, body, options) {
        return this._client.post((0, path_1.path) `/videos/${videoID}/remix`, (0, uploads_1.maybeMultipartFormRequestOptions)({ body, ...options }, this._client));
    }
}
exports.Videos = Videos;
//# sourceMappingURL=videos.js.map

/***/ },

/***/ "./node_modules/openai/resources/webhooks.js"
/*!***************************************************!*\
  !*** ./node_modules/openai/resources/webhooks.js ***!
  \***************************************************/
(__unused_webpack_module, exports, __webpack_require__) {


// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
var _Webhooks_instances, _Webhooks_validateSecret, _Webhooks_getRequiredHeader;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Webhooks = void 0;
const tslib_1 = __webpack_require__(/*! ../internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
const error_1 = __webpack_require__(/*! ../error.js */ "./node_modules/openai/error.js");
const resource_1 = __webpack_require__(/*! ../core/resource.js */ "./node_modules/openai/core/resource.js");
const headers_1 = __webpack_require__(/*! ../internal/headers.js */ "./node_modules/openai/internal/headers.js");
class Webhooks extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        _Webhooks_instances.add(this);
    }
    /**
     * Validates that the given payload was sent by OpenAI and parses the payload.
     */
    async unwrap(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
        await this.verifySignature(payload, headers, secret, tolerance);
        return JSON.parse(payload);
    }
    /**
     * Validates whether or not the webhook payload was sent by OpenAI.
     *
     * An error will be raised if the webhook payload was not sent by OpenAI.
     *
     * @param payload - The webhook payload
     * @param headers - The webhook headers
     * @param secret - The webhook secret (optional, will use client secret if not provided)
     * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
     */
    async verifySignature(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
        if (typeof crypto === 'undefined' ||
            typeof crypto.subtle.importKey !== 'function' ||
            typeof crypto.subtle.verify !== 'function') {
            throw new Error('Webhook signature verification is only supported when the `crypto` global is defined');
        }
        tslib_1.__classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_validateSecret).call(this, secret);
        const headersObj = (0, headers_1.buildHeaders)([headers]).values;
        const signatureHeader = tslib_1.__classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, 'webhook-signature');
        const timestamp = tslib_1.__classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, 'webhook-timestamp');
        const webhookId = tslib_1.__classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, 'webhook-id');
        // Validate timestamp to prevent replay attacks
        const timestampSeconds = parseInt(timestamp, 10);
        if (isNaN(timestampSeconds)) {
            throw new error_1.InvalidWebhookSignatureError('Invalid webhook timestamp format');
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (nowSeconds - timestampSeconds > tolerance) {
            throw new error_1.InvalidWebhookSignatureError('Webhook timestamp is too old');
        }
        if (timestampSeconds > nowSeconds + tolerance) {
            throw new error_1.InvalidWebhookSignatureError('Webhook timestamp is too new');
        }
        // Extract signatures from v1,<base64> format
        // The signature header can have multiple values, separated by spaces.
        // Each value is in the format v1,<base64>. We should accept if any match.
        const signatures = signatureHeader
            .split(' ')
            .map((part) => (part.startsWith('v1,') ? part.substring(3) : part));
        // Decode the secret if it starts with whsec_
        const decodedSecret = secret.startsWith('whsec_') ?
            Buffer.from(secret.replace('whsec_', ''), 'base64')
            : Buffer.from(secret, 'utf-8');
        // Create the signed payload: {webhook_id}.{timestamp}.{payload}
        const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
        // Import the secret as a cryptographic key for HMAC
        const key = await crypto.subtle.importKey('raw', decodedSecret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        // Check if any signature matches using timing-safe WebCrypto verify
        for (const signature of signatures) {
            try {
                const signatureBytes = Buffer.from(signature, 'base64');
                const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(signedPayload));
                if (isValid) {
                    return; // Valid signature found
                }
            }
            catch {
                // Invalid base64 or signature format, continue to next signature
                continue;
            }
        }
        throw new error_1.InvalidWebhookSignatureError('The given webhook signature does not match the expected signature');
    }
}
exports.Webhooks = Webhooks;
_Webhooks_instances = new WeakSet(), _Webhooks_validateSecret = function _Webhooks_validateSecret(secret) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error(`The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function`);
    }
}, _Webhooks_getRequiredHeader = function _Webhooks_getRequiredHeader(headers, name) {
    if (!headers) {
        throw new Error(`Headers are required`);
    }
    const value = headers.get(name);
    if (value === null || value === undefined) {
        throw new Error(`Missing required header: ${name}`);
    }
    return value;
};
//# sourceMappingURL=webhooks.js.map

/***/ },

/***/ "./node_modules/openai/streaming.js"
/*!******************************************!*\
  !*** ./node_modules/openai/streaming.js ***!
  \******************************************/
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const tslib_1 = __webpack_require__(/*! ./internal/tslib.js */ "./node_modules/openai/internal/tslib.js");
/** @deprecated Import from ./core/streaming instead */
tslib_1.__exportStar(__webpack_require__(/*! ./core/streaming.js */ "./node_modules/openai/core/streaming.js"), exports);
//# sourceMappingURL=streaming.js.map

/***/ },

/***/ "./node_modules/openai/version.js"
/*!****************************************!*\
  !*** ./node_modules/openai/version.js ***!
  \****************************************/
(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.VERSION = void 0;
exports.VERSION = '6.21.0'; // x-release-please-version
//# sourceMappingURL=version.js.map

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/main/main.ts");
/******/ 	
/******/ })()
;
//# sourceMappingURL=main.js.map