import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  globalShortcut,
  screen,
  nativeImage,
  desktopCapturer,
  session,
} from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  DEFAULT_BUBBLE_STATE,
  BubbleState,
  TranscriptionState,
  TranscriptionResult,
  SavedTranscript,
  IPC_CHANNELS,
} from '../shared/types';
import { randomUUID } from 'crypto';
import { TranscriptionService, TranscriptionDiagnostics } from './transcription-service';
import { DeepgramTranscription, DiagnosticInfo } from './deepgram-transcription';
import { GladiaTranscription } from './gladia-transcription';

// Initialize settings store
const store = new Store<{ settings: AppSettings; transcripts: SavedTranscript[] }>({
  defaults: {
    settings: DEFAULT_SETTINGS,
    transcripts: [],
  },
});

// Window references
let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// State
let transcriptionState: TranscriptionState = 'idle';
let transcriptionService: TranscriptionService | null = null;
let activeProvider: 'deepgram' | 'gladia' | null = null;

// Current session tracking
let currentSessionStartTime: number | null = null;
let currentSessionTranscripts: string[] = [];

// macOS system audio capture
let systemAudioProc: ChildProcess | null = null;

// Audio diagnostics
let audioStats = {
  chunksReceived: 0,
  bytesReceived: 0,
  chunksSentToDeepgram: 0,
  lastChunkTime: 0,
};

// Timing diagnostics
let firstAudioChunkTime: number | null = null;
let firstTranscriptTime: number | null = null;

// Debug: Write audio to file for analysis
const DEBUG_SAVE_AUDIO = true;
let debugAudioFile: fs.WriteStream | null = null;

// Audio format constants
// Native binary outputs 24kHz stereo with identical L/R channels
const CAPTURE_SAMPLE_RATE = 24000;  // From native binary
const DEEPGRAM_SAMPLE_RATE = 16000; // Deepgram optimal rate
const CHANNELS = 2; // Native binary outputs stereo
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHUNK_DURATION = 0.02; // 20ms chunks for lowest latency
const CHUNK_SIZE = CAPTURE_SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

// Transcription provider pricing (per minute)
const DEEPGRAM_COST_PER_MINUTE = 0.0043;  // nova-3 Pay-as-you-go
const GLADIA_COST_PER_MINUTE = 0.000611;   // Gladia standard rate

// Cumulative session cost tracking
let totalTranscriptionCost = 0;

function convertStereoToMono(stereoBuffer: Buffer): Buffer {
  // Native binary outputs PLANAR stereo: [L0, L1, L2..., R0, R1, R2...]
  // NOT interleaved: [L0, R0, L1, R1...]
  // Just take the first half (left channel)
  const halfSize = stereoBuffer.length / 2;
  return stereoBuffer.slice(0, halfSize);
}

/**
 * Resample audio from one sample rate to another using linear interpolation
 * This matches Deepgram's expected 16kHz sample rate (as used in their example app)
 */
function resampleAudio(inputBuffer: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return inputBuffer;

  const inputSamples = inputBuffer.length / 2; // 16-bit = 2 bytes per sample
  const ratio = fromRate / toRate;
  const outputSamples = Math.floor(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation between samples
    const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
    const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);
    const interpolated = Math.round(sample1 * (1 - fraction) + sample2 * fraction);

    outputBuffer.writeInt16LE(interpolated, i * 2);
  }

  return outputBuffer;
}

function startMacOSAudioCapture(): boolean {
  if (process.platform !== 'darwin') return false;

  // Path to native binary
  const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'SystemAudioDump')
    : path.join(app.getAppPath(), 'assets', 'SystemAudioDump');

  console.log('Starting macOS audio capture, binary path:', binaryPath);

  // Debug: Create audio file for analysis
  if (DEBUG_SAVE_AUDIO) {
    const debugPath = path.join(app.getPath('desktop'), 'debug-audio-16khz.pcm');
    debugAudioFile = fs.createWriteStream(debugPath);
    console.log('[DEBUG] Saving processed audio to:', debugPath);
  }

  // Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    console.error('SystemAudioDump binary not found at:', binaryPath);
    return false;
  }
  console.log('Binary exists, spawning...');

  try {
    systemAudioProc = spawn(binaryPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let audioBuffer = Buffer.alloc(0);
    let totalBytesReceived = 0;

    systemAudioProc.stdout?.on('data', (data: Buffer) => {
      totalBytesReceived += data.length;
      audioStats.bytesReceived = totalBytesReceived;

      if (totalBytesReceived % 50000 < data.length) {
        console.log('[AudioCapture] Data received, total bytes:', totalBytesReceived);
      }

      audioBuffer = Buffer.concat([audioBuffer, data]);

      // Log buffer size to detect backlog
      if (audioBuffer.length > CHUNK_SIZE * 10) {
        console.warn(`[BACKLOG] Audio buffer size: ${audioBuffer.length} bytes (${(audioBuffer.length / CHUNK_SIZE).toFixed(1)} chunks pending)`);
      }

      // Process in chunks
      while (audioBuffer.length >= CHUNK_SIZE) {
        const chunk = audioBuffer.slice(0, CHUNK_SIZE);
        audioBuffer = audioBuffer.slice(CHUNK_SIZE);

        // Convert stereo to mono (extract left channel - L and R are identical)
        const monoChunk = convertStereoToMono(chunk);
        // Send at 24kHz directly (Deepgram is configured for 24kHz)
        const resampledChunk = monoChunk;
        audioStats.chunksReceived++;
        audioStats.lastChunkTime = Date.now();

        // Diagnostic: Log audio sample stats every 100 chunks
        if (audioStats.chunksReceived % 100 === 1) {
          let maxSample = 0;
          let minSample = 0;
          for (let i = 0; i < resampledChunk.length; i += 2) {
            const sample = resampledChunk.readInt16LE(i);
            if (sample > maxSample) maxSample = sample;
            if (sample < minSample) minSample = sample;
          }
          console.log(`[AudioDiag] Chunk #${audioStats.chunksReceived}: samples=${resampledChunk.length / 2}, min=${minSample}, max=${maxSample}, range=${maxSample - minSample}`);
        }

        // Debug: Save audio to file for analysis
        if (DEBUG_SAVE_AUDIO && debugAudioFile) {
          debugAudioFile.write(resampledChunk);
        }

        // Send directly to Deepgram if connected
        if (transcriptionService?.connected) {
          // Log first chunk timing
          if (audioStats.chunksSentToDeepgram === 0) {
            firstAudioChunkTime = Date.now();
            console.log(`[TIMING] First audio chunk sent to Deepgram at ${firstAudioChunkTime}`);
          }

          transcriptionService.send(resampledChunk);
          audioStats.chunksSentToDeepgram++;

          // Log every 50 chunks
          if (audioStats.chunksSentToDeepgram % 50 === 0) {
            console.log(`[AudioCapture] Sent ${audioStats.chunksSentToDeepgram} chunks to Deepgram, chunk size: ${resampledChunk.length} bytes`);
          }
        } else {
          // Log when we can't send - this helps diagnose connection issues
          if (audioStats.chunksReceived % 100 === 1) {
            console.warn('[AudioCapture] Cannot send to Deepgram - not connected. Service exists:', !!transcriptionService, 'Connected:', transcriptionService?.connected);
          }
        }
      }
    });

    systemAudioProc.stderr?.on('data', (data: Buffer) => {
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
  } catch (error) {
    console.error('Failed to spawn SystemAudioDump:', error);
    return false;
  }
}

function stopMacOSAudioCapture(): void {
  if (systemAudioProc) {
    systemAudioProc.kill('SIGTERM');
    systemAudioProc = null;
    console.log('macOS audio capture stopped');
  }

  // Close debug audio file
  if (debugAudioFile) {
    debugAudioFile.end();
    debugAudioFile = null;
    console.log('[DEBUG] Audio file saved to desktop');
  }
}

function setupWindowsLoopbackHandler(): void {
  if (process.platform !== 'win32') return;

  // Setup native loopback audio capture handler for Windows
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Grant access to first screen with loopback audio
      callback({ video: sources[0], audio: 'loopback' });
    }).catch((error) => {
      console.error('Failed to get sources:', error);
      callback({});
    });
  });

  console.log('Windows loopback handler configured');
}

function getSettings(): AppSettings {
  return store.get('settings');
}

// Transcript storage functions
function getTranscripts(): SavedTranscript[] {
  return store.get('transcripts') || [];
}

function saveTranscript(transcript: SavedTranscript): void {
  const transcripts = getTranscripts();
  transcripts.unshift(transcript); // Add to beginning (most recent first)
  store.set('transcripts', transcripts);
}

function deleteTranscript(id: string): boolean {
  const transcripts = getTranscripts();
  const index = transcripts.findIndex(t => t.id === id);
  if (index !== -1) {
    transcripts.splice(index, 1);
    store.set('transcripts', transcripts);
    return true;
  }
  return false;
}

function getTranscriptById(id: string): SavedTranscript | null {
  const transcripts = getTranscripts();
  return transcripts.find(t => t.id === id) || null;
}

function generateTranscriptTitle(content: string, language: string): string {
  const date = new Date();
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}

function updateSettings(newSettings: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...newSettings };
  store.set('settings', updated);
  return updated;
}

function createControlWindow(): void {
  const settings = getSettings();

  controlWindow = new BrowserWindow({
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
  // controlWindow.webContents.openDevTools();

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

function createOverlayWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const settings = getSettings();
  const bubbleState = settings.bubbleState || DEFAULT_BUBBLE_STATE;
  const overlayMode = settings.overlayMode || 'bubble';

  // Determine window dimensions based on overlay mode
  let windowWidth: number;
  let windowHeight: number;
  let windowX: number;
  let windowY: number;
  let isResizable: boolean;

  if (overlayMode === 'subtitle') {
    // Classic subtitle: fullscreen, CSS handles positioning
    windowWidth = screenWidth;
    windowHeight = screenHeight;
    windowX = 0;
    windowY = 0;
    isResizable = false;
  } else {
    // Bubble mode: use saved bubble state
    windowWidth = bubbleState.width;
    windowHeight = bubbleState.height;
    windowX = bubbleState.x === -1
      ? Math.floor((screenWidth - windowWidth) / 2)
      : bubbleState.x;
    // Position lower on screen (like classic captions)
    windowY = bubbleState.y === -1
      ? Math.floor(screenHeight * 0.85 - windowHeight)
      : bubbleState.y;
    isResizable = true;
  }

  overlayWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 150,
    minHeight: 60,
    x: windowX,
    y: windowY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,  // Allow focus for interaction
    hasShadow: false,
    resizable: isResizable,
    movable: overlayMode === 'bubble',
    show: false,      // Don't show on creation
    backgroundColor: '#00000000', // Fully transparent background
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-overlay.js'),
    },
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay/index.html'));

  // Set mouse event handling based on mode
  if (overlayMode === 'subtitle') {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // Set window level to float above other windows
  overlayWindow.setAlwaysOnTop(true, 'floating');

  // Save position/size when window moves or resizes (only relevant for bubble mode)
  overlayWindow.on('moved', () => {
    saveBubblePosition();
  });

  overlayWindow.on('resized', () => {
    saveBubblePosition();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function saveBubblePosition(): void {
  if (!overlayWindow) return;

  // Only save position when in bubble mode, not when fullscreen in subtitle mode
  const settings = getSettings();
  if (settings.overlayMode !== 'bubble') return;

  const bounds = overlayWindow.getBounds();
  const updatedBubbleState: BubbleState = {
    ...settings.bubbleState,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };

  store.set('settings', { ...settings, bubbleState: updatedBubbleState });
}

function createTray(): void {
  // Create a simple tray icon (16x16 transparent PNG would be ideal)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
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
        app.quit();
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

function registerShortcuts(): void {
  const settings = getSettings();

  // Toggle transcription shortcut
  globalShortcut.register(settings.toggleShortcut, () => {
    toggleTranscription();
  });

  // Show/hide overlay shortcut
  globalShortcut.register(settings.showHideShortcut, () => {
    if (overlayWindow?.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow?.show();
    }
  });
}

async function toggleTranscription(): Promise<void> {
  if (transcriptionState === 'active') {
    await stopTranscription();
  } else if (transcriptionState === 'idle') {
    await startTranscription();
  }
}

async function startTranscription(): Promise<{ success: boolean; error?: string }> {
  console.log('[Main] startTranscription called, current state:', transcriptionState);

  if (transcriptionState !== 'idle') {
    console.log('[Main] Cannot start - not idle');
    return { success: false, error: 'Already running or transitioning' };
  }

  try {
    updateState('starting');
    const settings = getSettings();
    const provider = settings.transcriptionProvider || 'deepgram';

    console.log('[Main] Selected provider:', provider);
    console.log('[Main] Language:', settings.language);

    // Check for API key based on provider
    if (provider === 'deepgram') {
      if (!settings.deepgramApiKey) {
        console.error('[Main] No Deepgram API key set');
        updateState('idle');
        return { success: false, error: 'Please set your Deepgram API key in settings' };
      }
      console.log('[Main] Deepgram API key length:', settings.deepgramApiKey?.length || 0);
    } else if (provider === 'gladia') {
      if (!settings.gladiaApiKey) {
        console.error('[Main] No Gladia API key set');
        updateState('idle');
        return { success: false, error: 'Please set your Gladia API key in settings' };
      }
      console.log('[Main] Gladia API key length:', settings.gladiaApiKey?.length || 0);
    }

    // Reset audio stats and timing
    audioStats = {
      chunksReceived: 0,
      bytesReceived: 0,
      chunksSentToDeepgram: 0,
      lastChunkTime: 0,
    };
    firstAudioChunkTime = null;
    firstTranscriptTime = null;

    // Initialize session tracking
    currentSessionStartTime = Date.now();
    currentSessionTranscripts = [];
    activeProvider = provider;

    // Initialize transcription service based on provider
    if (provider === 'deepgram') {
      console.log('[Main] Creating DeepgramTranscription service...');
      transcriptionService = new DeepgramTranscription(settings.deepgramApiKey, settings.language);
    } else if (provider === 'gladia') {
      console.log('[Main] Creating GladiaTranscription service...');
      transcriptionService = new GladiaTranscription(settings.gladiaApiKey, settings.language);
    }

    if (!transcriptionService) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // Start transcription connection
    console.log(`[Main] Starting ${provider} connection...`);
    await transcriptionService.start({
      onTranscript: (result) => {
        // Log first transcript timing
        if (!firstTranscriptTime) {
          firstTranscriptTime = Date.now();
          const latency = firstAudioChunkTime ? firstTranscriptTime - firstAudioChunkTime : 'N/A';
          console.log(`[TIMING] First transcript received at ${firstTranscriptTime}`);
          console.log(`[TIMING] Latency from first audio to first transcript: ${latency}ms`);
        }
        console.log('[Main] Received transcript, sending to overlay:', result.text);
        sendTranscriptionToOverlay(result);
        // Track final transcripts for saving
        if (result.isFinal && result.text.trim()) {
          currentSessionTranscripts.push(result.text.trim());
        }
      },
      onError: (error) => {
        console.error(`[Main] ${activeProvider} error callback:`, error.message);
        controlWindow?.webContents.send(IPC_CHANNELS.ERROR_OCCURRED, error.message);
      },
      onOpen: () => {
        console.log(`[Main] ${activeProvider} onOpen callback - connection established`);
      },
      onClose: () => {
        console.log(`[Main] ${activeProvider} onClose callback - connection closed`);
      },
    });

    console.log(`[Main] ${activeProvider} connection started successfully`);

    // Show overlay
    overlayWindow?.show();
    console.log('[Main] Overlay shown');

    updateState('active');
    console.log('[Main] State updated to active');
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Main] Failed to start transcription:', errorMsg);
    updateState('idle');
    return {
      success: false,
      error: errorMsg,
    };
  }
}

async function stopTranscription(): Promise<{ success: boolean }> {
  if (transcriptionState !== 'active') {
    return { success: false };
  }

  updateState('stopping');

  // Log session statistics
  const sessionDuration = currentSessionStartTime ? (Date.now() - currentSessionStartTime) / 1000 : 0;
  const audioSeconds = (audioStats.chunksSentToDeepgram * CHUNK_DURATION);
  const audioMinutes = audioSeconds / 60;

  // Calculate cost based on active provider
  const costPerMinute = activeProvider === 'gladia' ? GLADIA_COST_PER_MINUTE : DEEPGRAM_COST_PER_MINUTE;
  const providerName = activeProvider === 'gladia' ? 'Gladia' : 'Deepgram (nova-3)';
  const sessionCost = audioMinutes * costPerMinute;
  totalTranscriptionCost += sessionCost;

  console.log(`[STATS] Provider: ${activeProvider}`);
  console.log(`[STATS] Session duration: ${sessionDuration.toFixed(1)}s`);
  console.log(`[STATS] Audio sent: ${audioSeconds.toFixed(1)}s (${audioStats.chunksSentToDeepgram} chunks)`);
  console.log(`[STATS] Real-time ratio: ${(audioSeconds / sessionDuration).toFixed(2)}x`);
  console.log(`[STATS] Chunks received from native: ${audioStats.chunksReceived}`);
  console.log(`[COST] Session cost (${providerName}): $${sessionCost.toFixed(6)} (${audioMinutes.toFixed(2)} minutes @ $${costPerMinute}/min)`);
  console.log(`[COST] Total cumulative cost this app session: $${totalTranscriptionCost.toFixed(6)}`);

  try {
    // Stop transcription connection
    if (transcriptionService) {
      await transcriptionService.stop();
      transcriptionService = null;
    }

    // Save transcript if we have content
    if (currentSessionTranscripts.length > 0 && currentSessionStartTime) {
      const settings = getSettings();
      const endTime = Date.now();
      const content = currentSessionTranscripts.join(' ');
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

      const transcript: SavedTranscript = {
        id: randomUUID(),
        title: generateTranscriptTitle(content, settings.language),
        content,
        language: settings.language,
        startTime: currentSessionStartTime,
        endTime,
        duration: Math.round((endTime - currentSessionStartTime) / 1000),
        wordCount,
        createdAt: Date.now(),
      };

      saveTranscript(transcript);
      console.log('[Main] Saved transcript:', transcript.id, 'with', wordCount, 'words');
    }

    // Reset session tracking
    currentSessionStartTime = null;
    currentSessionTranscripts = [];
    activeProvider = null;

    // Hide overlay
    overlayWindow?.hide();

    // Clear overlay
    overlayWindow?.webContents.send(IPC_CHANNELS.CLEAR_TRANSCRIPTION);

    updateState('idle');
    return { success: true };
  } catch (error) {
    console.error('Failed to stop transcription:', error);
    updateState('idle');
    return { success: false };
  }
}

function updateState(newState: TranscriptionState): void {
  transcriptionState = newState;
  controlWindow?.webContents.send(IPC_CHANNELS.STATE_CHANGED, newState);
}

function sendTranscriptionToOverlay(result: TranscriptionResult): void {
  overlayWindow?.webContents.send(IPC_CHANNELS.TRANSCRIPTION_UPDATE, result);
}

// IPC Handlers
function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.START_TRANSCRIPTION, async () => {
    return startTranscription();
  });

  ipcMain.handle(IPC_CHANNELS.STOP_TRANSCRIPTION, async () => {
    return stopTranscription();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_, newSettings: Partial<AppSettings>) => {
    const updated = updateSettings(newSettings);

    // Update overlay style if changed
    if (newSettings.overlayStyle) {
      overlayWindow?.webContents.send(IPC_CHANNELS.UPDATE_OVERLAY_STYLE, updated.overlayStyle);
    }

    // Update overlay mode if changed
    if (newSettings.overlayMode && overlayWindow) {
      const mode = newSettings.overlayMode;
      overlayWindow.webContents.send(IPC_CHANNELS.SET_OVERLAY_MODE, mode);

      // Adjust window behavior based on mode
      if (mode === 'subtitle') {
        // Classic subtitle: fullscreen window, CSS handles positioning
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;
        overlayWindow.setSize(width, height);
        overlayWindow.setPosition(0, 0);
        overlayWindow.setResizable(false);
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        // Bubble mode: restore bubble state
        const bubbleState = updated.bubbleState || DEFAULT_BUBBLE_STATE;
        overlayWindow.setSize(bubbleState.width, bubbleState.height);
        overlayWindow.setResizable(true);
        overlayWindow.setIgnoreMouseEvents(false);

        // Position centered-lower if not set, otherwise use saved position
        if (bubbleState.x === -1 || bubbleState.y === -1) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width: sw, height: sh } = primaryDisplay.workAreaSize;
          const x = Math.floor((sw - bubbleState.width) / 2);
          const y = Math.floor(sh * 0.85 - bubbleState.height);
          overlayWindow.setPosition(x, y);
        } else {
          overlayWindow.setPosition(bubbleState.x, bubbleState.y);
        }
      }
    }

    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return transcriptionState;
  });

  ipcMain.handle(IPC_CHANNELS.GET_DESKTOP_SOURCES, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: false,
    });
    return sources;
  });

  // Stream audio chunk directly to Deepgram (for Windows/renderer-side capture)
  ipcMain.handle(IPC_CHANNELS.STREAM_AUDIO_CHUNK, async (_, base64Data: string) => {
    if (!transcriptionService?.connected || transcriptionState !== 'active') {
      return { success: false };
    }

    try {
      const audioBuffer = Buffer.from(base64Data, 'base64');
      transcriptionService.send(audioBuffer);
      return { success: true };
    } catch (error) {
      console.error('Error streaming audio chunk:', error);
      return { success: false };
    }
  });

  // System audio capture handlers
  ipcMain.handle(IPC_CHANNELS.START_SYSTEM_AUDIO, async () => {
    if (process.platform === 'darwin') {
      const success = startMacOSAudioCapture();
      return { success, platform: 'darwin' };
    } else if (process.platform === 'win32') {
      // Windows uses renderer-side capture via getDisplayMedia
      return { success: true, platform: 'win32' };
    } else {
      return { success: false, error: 'Platform not supported' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SYSTEM_AUDIO, async () => {
    if (process.platform === 'darwin') {
      stopMacOSAudioCapture();
    }
    return { success: true };
  });

  // Diagnostics handler
  ipcMain.handle(IPC_CHANNELS.GET_DIAGNOSTICS, () => {
    const deepgramDiagnostics = transcriptionService?.getDiagnostics() || null;
    return {
      platform: process.platform,
      transcriptionState,
      deepgram: deepgramDiagnostics,
      audio: {
        ...audioStats,
        systemAudioProcRunning: !!systemAudioProc,
        systemAudioProcPid: systemAudioProc?.pid || null,
      },
    };
  });

  // Transcript history handlers
  ipcMain.handle(IPC_CHANNELS.GET_TRANSCRIPTS, () => {
    return getTranscripts();
  });

  ipcMain.handle(IPC_CHANNELS.GET_TRANSCRIPT, (_, id: string) => {
    return getTranscriptById(id);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_TRANSCRIPT, (_, id: string) => {
    return deleteTranscript(id);
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_TRANSCRIPT, async (_, id: string) => {
    const transcript = getTranscriptById(id);
    if (!transcript) return { success: false, error: 'Transcript not found' };

    const { dialog } = require('electron');

    const result = await dialog.showSaveDialog(controlWindow!, {
      defaultPath: `transcript-${transcript.id.slice(0, 8)}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Export cancelled' };
    }

    try {
      const exportContent = [
        `Transcript: ${transcript.title}`,
        `Date: ${new Date(transcript.createdAt).toLocaleString()}`,
        `Duration: ${formatDuration(transcript.duration)}`,
        `Word Count: ${transcript.wordCount}`,
        `Language: ${transcript.language}`,
        '',
        '---',
        '',
        transcript.content,
      ].join('\n');

      fs.writeFileSync(result.filePath, exportContent, 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: 'Failed to write file' };
    }
  });

  // Bubble state handlers
  ipcMain.handle(IPC_CHANNELS.GET_BUBBLE_STATE, () => {
    const settings = getSettings();
    return settings.bubbleState || DEFAULT_BUBBLE_STATE;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_BUBBLE_STATE, (_, bubbleState: BubbleState) => {
    const settings = getSettings();
    store.set('settings', { ...settings, bubbleState });

    // Update window size if collapsed state changed
    if (overlayWindow) {
      if (bubbleState.collapsed) {
        overlayWindow.setSize(80, 32);
      } else {
        overlayWindow.setSize(bubbleState.width, bubbleState.height);
      }
    }

    return bubbleState;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_BUBBLE_COLLAPSE, () => {
    const settings = getSettings();
    const currentState = settings.bubbleState || DEFAULT_BUBBLE_STATE;
    const newCollapsed = !currentState.collapsed;

    const newState: BubbleState = {
      ...currentState,
      collapsed: newCollapsed,
    };

    store.set('settings', { ...settings, bubbleState: newState });

    // Update window size
    if (overlayWindow) {
      if (newCollapsed) {
        overlayWindow.setSize(80, 32);
        overlayWindow.setResizable(false);
      } else {
        overlayWindow.setSize(newState.width, newState.height);
        overlayWindow.setResizable(true);
      }
    }

    return newState;
  });

  // Overlay mode handlers
  ipcMain.handle(IPC_CHANNELS.GET_OVERLAY_MODE, () => {
    const settings = getSettings();
    return settings.overlayMode || 'bubble';
  });

  ipcMain.handle(IPC_CHANNELS.SET_OVERLAY_MODE, (_, mode: 'bubble' | 'subtitle') => {
    const settings = getSettings();
    store.set('settings', { ...settings, overlayMode: mode });

    // Notify the overlay window of the mode change
    if (overlayWindow) {
      overlayWindow.webContents.send(IPC_CHANNELS.SET_OVERLAY_MODE, mode);

      // Adjust window behavior based on mode
      if (mode === 'subtitle') {
        // Classic subtitle: fullscreen window, CSS handles positioning
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;
        overlayWindow.setSize(width, height);
        overlayWindow.setPosition(0, 0);
        overlayWindow.setResizable(false);
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        // Bubble mode: restore bubble state
        const bubbleState = settings.bubbleState || DEFAULT_BUBBLE_STATE;
        overlayWindow.setSize(bubbleState.width, bubbleState.height);
        overlayWindow.setResizable(true);
        overlayWindow.setIgnoreMouseEvents(false);

        // Position centered-lower if not set, otherwise use saved position
        if (bubbleState.x === -1 || bubbleState.y === -1) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width: sw, height: sh } = primaryDisplay.workAreaSize;
          const x = Math.floor((sw - bubbleState.width) / 2);
          const y = Math.floor(sh * 0.85 - bubbleState.height);
          overlayWindow.setPosition(x, y);
        } else {
          overlayWindow.setPosition(bubbleState.x, bubbleState.y);
        }
      }
    }

    return mode;
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// App lifecycle
app.whenReady().then(() => {
  setupWindowsLoopbackHandler();
  createControlWindow();
  createOverlayWindow();
  createTray();
  registerShortcuts();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
      createOverlayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', async () => {
  if (transcriptionState === 'active') {
    await stopTranscription();
  }
  stopMacOSAudioCapture();
});
