# Language Agent Architecture

This document provides a high-level overview of the Language Agent application architecture, Electron conventions, and how the various components interact.

## Table of Contents

1. [Electron Fundamentals](#electron-fundamentals)
2. [Process Architecture](#process-architecture)
3. [Project Structure](#project-structure)
4. [IPC Communication](#ipc-communication)
5. [Application Flow](#application-flow)
6. [Key Components](#key-components)
7. [Data Flow](#data-flow)

---

## Electron Fundamentals

Electron is a framework for building cross-platform desktop applications using web technologies (HTML, CSS, JavaScript/TypeScript). It combines Chromium (for rendering) and Node.js (for system access) into a single runtime.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Main Process** | The "backend" of your app. Has full Node.js access, can use native APIs, manages windows. Only ONE main process exists. |
| **Renderer Process** | The "frontend" of your app. Runs in a Chromium browser context. Each window is a separate renderer process. |
| **Preload Script** | A bridge between main and renderer. Runs in renderer context but can access some Node.js APIs. Used for secure IPC. |
| **Context Isolation** | Security feature that separates the preload script's context from the renderer's context. |
| **IPC** | Inter-Process Communication. How main and renderer processes talk to each other. |

### Why This Architecture?

```
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - Full Node.js access (file system, native modules)        ││
│  │  - System-level APIs (audio capture, global shortcuts)      ││
│  │  - Window management (create, position, show/hide)          ││
│  │  - Application lifecycle (startup, shutdown)                ││
│  │  - Persistent storage (electron-store)                      ││
│  │  - External service connections (Deepgram WebSocket)        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ IPC (Inter-Process Communication)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      RENDERER PROCESSES                          │
│  ┌───────────────────────┐    ┌───────────────────────────────┐│
│  │    Control Window     │    │       Overlay Window          ││
│  │  ┌─────────────────┐  │    │  ┌─────────────────────────┐  ││
│  │  │ React Components│  │    │  │   React Components      │  ││
│  │  │ - ControlPanel  │  │    │  │   - SubtitleOverlay     │  ││
│  │  │ - History       │  │    │  │                         │  ││
│  │  └─────────────────┘  │    │  └─────────────────────────┘  ││
│  │  - User interface     │    │  - Transparent window         ││
│  │  - User interactions  │    │  - Displays transcriptions    ││
│  │  - Settings UI        │    │  - Always on top              ││
│  └───────────────────────┘    └───────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Security**: Renderer processes are sandboxed and don't have direct access to Node.js APIs. This prevents malicious web content from accessing your file system.

**Stability**: If a renderer crashes, it doesn't take down the entire app.

---

## Process Architecture

### Main Process (`src/main/main.ts`)

The main process is the entry point of the application. It:

1. **Creates Windows**: Spawns BrowserWindow instances for control panel and overlay
2. **Manages State**: Tracks transcription state (idle, starting, active, stopping)
3. **Handles Audio**: Spawns native audio capture process, processes audio data
4. **Connects to Services**: Manages WebSocket connection to Deepgram
5. **Stores Data**: Persists settings and transcripts using electron-store
6. **Registers Shortcuts**: Global keyboard shortcuts that work even when app isn't focused

```typescript
// Simplified main process structure
app.whenReady().then(() => {
  createControlWindow();    // User interface window
  createOverlayWindow();    // Transparent subtitle overlay
  createTray();             // System tray icon
  registerShortcuts();      // Global hotkeys
  setupIpcHandlers();       // IPC message handlers
});
```

### Renderer Processes

Each window runs in its own renderer process:

**Control Window** (`src/renderer/control/`)
- React-based UI for controlling the app
- Settings management
- Transcript history viewing
- Start/stop transcription

**Overlay Window** (`src/renderer/overlay/`)
- Transparent, always-on-top window
- Displays real-time subtitles
- No user interaction (click-through)

### Preload Scripts (`src/main/preload-*.ts`)

Preload scripts are the secure bridge between main and renderer:

```typescript
// preload-control.ts - Exposes safe API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  startTranscription: () => ipcRenderer.invoke('start-transcription'),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  // ... more methods
});
```

The renderer can then use these methods:

```typescript
// In React component
const result = await window.electronAPI.startTranscription();
```

---

## Project Structure

```
language-agent/
├── src/
│   ├── main/                    # Main process code
│   │   ├── main.ts              # Entry point, window creation, IPC handlers
│   │   ├── preload-control.ts   # Preload for control window
│   │   ├── preload-overlay.ts   # Preload for overlay window
│   │   └── deepgram-transcription.ts  # Deepgram WebSocket client
│   │
│   ├── renderer/                # Renderer process code
│   │   ├── control/             # Control panel window
│   │   │   ├── index.html       # HTML entry point
│   │   │   ├── index.tsx        # React entry point
│   │   │   ├── ControlPanel.tsx # Main UI component
│   │   │   ├── TranscriptHistory.tsx
│   │   │   ├── useSystemAudio.ts # Audio capture hook
│   │   │   └── styles.css       # Styles (with Tailwind)
│   │   │
│   │   └── overlay/             # Overlay window
│   │       ├── index.html
│   │       ├── index.tsx
│   │       ├── SubtitleOverlay.tsx
│   │       └── styles.css
│   │
│   └── shared/                  # Shared between main and renderer
│       └── types.ts             # TypeScript types, constants, IPC channels
│
├── assets/                      # Native binaries, icons
│   └── SystemAudioDump          # macOS audio capture binary
│
├── dist/                        # Compiled output (webpack)
├── research/                    # Documentation
├── webpack.main.config.js       # Main process bundling
├── webpack.renderer.config.js   # Renderer process bundling
├── tailwind.config.js           # Tailwind CSS config
└── package.json
```

---

## IPC Communication

IPC (Inter-Process Communication) is how the main and renderer processes communicate.

### Communication Patterns

#### 1. Invoke/Handle (Request-Response)

Used when renderer needs data from main or wants to trigger an action:

```typescript
// Main process - handle the request
ipcMain.handle('get-settings', () => {
  return store.get('settings');
});

// Renderer process - invoke and await response
const settings = await window.electronAPI.getSettings();
```

#### 2. Send/On (One-way, Main → Renderer)

Used when main needs to push updates to renderer:

```typescript
// Main process - send to specific window
controlWindow.webContents.send('state-changed', newState);

// Renderer process (via preload) - listen for events
ipcRenderer.on('state-changed', (event, state) => {
  callback(state);
});
```

### IPC Channels in This App

All channel names are defined in `src/shared/types.ts`:

```typescript
export const IPC_CHANNELS = {
  // Control → Main (actions)
  START_TRANSCRIPTION: 'start-transcription',
  STOP_TRANSCRIPTION: 'stop-transcription',
  GET_SETTINGS: 'get-settings',
  UPDATE_SETTINGS: 'update-settings',

  // Main → Overlay (updates)
  TRANSCRIPTION_UPDATE: 'transcription-update',
  CLEAR_TRANSCRIPTION: 'clear-transcription',

  // Main → Control (state updates)
  STATE_CHANGED: 'state-changed',
  ERROR_OCCURRED: 'error-occurred',

  // Audio
  START_SYSTEM_AUDIO: 'start-system-audio',
  STOP_SYSTEM_AUDIO: 'stop-system-audio',

  // Transcripts
  GET_TRANSCRIPTS: 'get-transcripts',
  DELETE_TRANSCRIPT: 'delete-transcript',
  // ...
};
```

---

## Application Flow

### Startup Sequence

```
1. Electron starts → main.ts executes
2. app.whenReady() fires
3. Create control window (BrowserWindow)
   └── Loads index.html → React app mounts
   └── Preload script exposes electronAPI
4. Create overlay window (transparent, always-on-top)
5. Create system tray icon
6. Register global shortcuts
7. Set up IPC handlers
```

### Transcription Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Control    │     │     Main     │     │   Overlay    │
│   Window     │     │   Process    │     │   Window     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ startTranscription │                    │
       │───────────────────>│                    │
       │                    │                    │
       │                    │ Connect to Deepgram│
       │                    │ (WebSocket)        │
       │                    │                    │
       │                    │ Spawn SystemAudioDump
       │                    │ (native binary)    │
       │                    │                    │
       │    state: active   │                    │
       │<───────────────────│                    │
       │                    │                    │
       │                    │ Audio chunks flow  │
       │                    │ ┌────────────────┐ │
       │                    │ │Native Binary   │ │
       │                    │ │→ Main Process  │ │
       │                    │ │→ Deepgram WS   │ │
       │                    │ └────────────────┘ │
       │                    │                    │
       │                    │ Transcript received│
       │                    │───────────────────>│
       │                    │                    │
       │                    │                    │ Display subtitle
       │                    │                    │
```

### Audio Data Flow

```
┌─────────────────┐
│ System Audio    │  macOS: ScreenCaptureKit via native Swift binary
│ (Speaker Output)│  Windows: WASAPI loopback via Electron
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SystemAudioDump │  Outputs: Int16, 24kHz, Stereo, raw PCM
│ (Native Binary) │  Writes to stdout
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Main Process    │  1. Reads from child process stdout
│ Audio Handler   │  2. Converts stereo → mono
│                 │  3. Buffers into 100ms chunks
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Deepgram        │  Real-time WebSocket streaming
│ Transcription   │  Returns transcripts with is_final flag
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Overlay Window  │  Displays subtitle text
└─────────────────┘
```

---

## Key Components

### DeepgramTranscription (`src/main/deepgram-transcription.ts`)

Manages the WebSocket connection to Deepgram's streaming API:

```typescript
class DeepgramTranscription {
  // Connection lifecycle
  async start(callbacks): Promise<void>
  async stop(): Promise<void>

  // Audio streaming
  send(audioBuffer: Buffer): void

  // Connection status
  get connected(): boolean

  // Diagnostics
  getDiagnostics(): DiagnosticInfo
}
```

Key features:
- Configures Nova-3 model with streaming settings
- Handles interim and final transcripts
- Sends keepalive messages to prevent timeout
- Tracks diagnostic information

### ControlPanel (`src/renderer/control/ControlPanel.tsx`)

Main React component for user interface:

- State management with React hooks
- Settings persistence via IPC
- System audio capture control
- Real-time diagnostics display

### TranscriptHistory (`src/renderer/control/TranscriptHistory.tsx`)

Displays saved transcription sessions:

- Lists all past transcripts
- Preview selected transcript
- Delete/export functionality

### SubtitleOverlay (`src/renderer/overlay/SubtitleOverlay.tsx`)

Displays real-time transcriptions:

- Receives updates via IPC
- Manages subtitle display timing
- Handles different languages/fonts

---

## Data Flow

### Settings Storage

Settings are persisted using `electron-store`:

```typescript
const store = new Store<{
  settings: AppSettings;
  transcripts: SavedTranscript[]
}>({
  defaults: {
    settings: DEFAULT_SETTINGS,
    transcripts: [],
  },
});
```

Data is stored in:
- macOS: `~/Library/Application Support/language-agent/config.json`
- Windows: `%APPDATA%/language-agent/config.json`

### Transcript Saving

When a transcription session ends:

```typescript
// During session - collect transcripts
onTranscript: (result) => {
  if (result.isFinal && result.text.trim()) {
    currentSessionTranscripts.push(result.text.trim());
  }
}

// On stop - save complete transcript
const transcript: SavedTranscript = {
  id: randomUUID(),
  title: generateTranscriptTitle(...),
  content: currentSessionTranscripts.join(' '),
  duration: endTime - startTime,
  wordCount: ...,
  // ...
};
saveTranscript(transcript);
```

---

## Build System

### Webpack Configuration

Two webpack configs handle different targets:

**webpack.main.config.js**
- Target: `electron-main`
- Bundles main process code
- Output: `dist/main/main.js`

**webpack.renderer.config.js**
- Target: `electron-renderer`
- Bundles React apps for each window
- Handles CSS with PostCSS/Tailwind
- Output: `dist/renderer/{control,overlay}/`

### Build Commands

```bash
npm run build        # Build everything
npm run build:main   # Build main process only
npm run build:renderer  # Build renderer processes only
npm run dev          # Development mode with watch
npm start            # Build and run
```

---

## Security Considerations

1. **Context Isolation**: Enabled by default, prevents renderer from accessing Node.js
2. **Preload Scripts**: Only expose necessary APIs via `contextBridge`
3. **No Remote Module**: Disabled (deprecated and insecure)
4. **Content Security Policy**: Should be added for production

```typescript
// Secure window creation
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,      // Don't expose Node.js to renderer
    contextIsolation: true,      // Isolate preload from renderer
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

---

## Summary

The Language Agent app follows standard Electron patterns:

1. **Main process** handles system-level operations (audio, windows, storage)
2. **Renderer processes** handle UI (React components)
3. **Preload scripts** provide secure bridge via IPC
4. **Shared types** ensure type safety across processes

The audio flows from system → native binary → main process → Deepgram → overlay, with all coordination happening in the main process.
