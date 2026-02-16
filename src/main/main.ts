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
import Store from 'electron-store';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  TranscriptionState,
  TranscriptionResult,
  IPC_CHANNELS,
} from '../shared/types';
import { DeepgramTranscription, DiagnosticInfo } from './deepgram-transcription';

// Initialize settings store
const store = new Store<{ settings: AppSettings }>({
  defaults: {
    settings: DEFAULT_SETTINGS,
  },
});

// Window references
let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// State
let transcriptionState: TranscriptionState = 'idle';
let transcriptionService: DeepgramTranscription | null = null;

// macOS system audio capture
let systemAudioProc: ChildProcess | null = null;

// Audio diagnostics
let audioStats = {
  chunksReceived: 0,
  bytesReceived: 0,
  chunksSentToDeepgram: 0,
  lastChunkTime: 0,
};

// Audio format constants (matching DESKTOP_AUDIO_CAPTURE_RESEARCH.md)
const SAMPLE_RATE = 24000;
const CHANNELS = 2; // stereo from native binary
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHUNK_DURATION = 0.1; // 100ms chunks
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

function convertStereoToMono(stereoBuffer: Buffer): Buffer {
  const samples = stereoBuffer.length / 4; // 4 bytes per stereo sample pair
  const monoBuffer = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i++) {
    const leftSample = stereoBuffer.readInt16LE(i * 4);
    monoBuffer.writeInt16LE(leftSample, i * 2);
  }

  return monoBuffer;
}

function startMacOSAudioCapture(): boolean {
  if (process.platform !== 'darwin') return false;

  // Path to native binary
  const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'SystemAudioDump')
    : path.join(app.getAppPath(), 'assets', 'SystemAudioDump');

  console.log('Starting macOS audio capture, binary path:', binaryPath);

  // Check if binary exists
  const fs = require('fs');
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

      // Process in chunks
      while (audioBuffer.length >= CHUNK_SIZE) {
        const chunk = audioBuffer.slice(0, CHUNK_SIZE);
        audioBuffer = audioBuffer.slice(CHUNK_SIZE);

        // Convert stereo to mono
        const monoChunk = convertStereoToMono(chunk);
        audioStats.chunksReceived++;
        audioStats.lastChunkTime = Date.now();

        // Send directly to Deepgram if connected
        if (transcriptionService?.connected) {
          transcriptionService.send(monoChunk);
          audioStats.chunksSentToDeepgram++;

          // Log every 50 chunks
          if (audioStats.chunksSentToDeepgram % 50 === 0) {
            console.log(`[AudioCapture] Sent ${audioStats.chunksSentToDeepgram} chunks to Deepgram`);
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

function createOverlayWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
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

    console.log('[Main] Settings loaded, API key length:', settings.deepgramApiKey?.length || 0);
    console.log('[Main] Language:', settings.language);

    // Check for API key
    if (!settings.deepgramApiKey) {
      console.error('[Main] No API key set');
      updateState('idle');
      return { success: false, error: 'Please set your Deepgram API key in settings' };
    }

    // Reset audio stats
    audioStats = {
      chunksReceived: 0,
      bytesReceived: 0,
      chunksSentToDeepgram: 0,
      lastChunkTime: 0,
    };

    // Initialize transcription service
    console.log('[Main] Creating DeepgramTranscription service...');
    transcriptionService = new DeepgramTranscription(settings.deepgramApiKey, settings.language);

    // Start Deepgram WebSocket connection
    console.log('[Main] Starting Deepgram connection...');
    await transcriptionService.start({
      onTranscript: (result) => {
        console.log('[Main] Received transcript, sending to overlay:', result.text);
        sendTranscriptionToOverlay(result);
      },
      onError: (error) => {
        console.error('[Main] Deepgram error callback:', error.message);
        controlWindow?.webContents.send(IPC_CHANNELS.ERROR_OCCURRED, error.message);
      },
      onOpen: () => {
        console.log('[Main] Deepgram onOpen callback - connection established');
      },
      onClose: () => {
        console.log('[Main] Deepgram onClose callback - connection closed');
      },
    });

    console.log('[Main] Deepgram connection started successfully');

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

  try {
    // Stop Deepgram connection
    if (transcriptionService) {
      await transcriptionService.stop();
      transcriptionService = null;
    }

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
