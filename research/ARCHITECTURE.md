# Language Agent Architecture

This document provides a high-level overview of the Language Agent application architecture, Electron conventions, and how the various components interact.

## Table of Contents

1. [Overview](#overview)
2. [Electron Fundamentals](#electron-fundamentals)
3. [Process Architecture](#process-architecture)
4. [Project Structure](#project-structure)
5. [Audio Pipeline](#audio-pipeline)
6. [IPC Communication](#ipc-communication)
7. [Application Flow](#application-flow)
8. [Key Components](#key-components)
9. [Data Flow](#data-flow)
10. [Configuration](#configuration)

---

## Overview

**Language Agent** is a cross-platform desktop application that provides real-time speech-to-text transcription with a floating subtitle overlay. It captures system audio (speaker output) and transcribes it using Deepgram's Nova-3 streaming API.

**Primary Use Case**: Display live subtitles for any audio playing on your computer (videos, meetings, streams, etc.)

**Tech Stack:**
- **Framework**: Electron (Chromium + Node.js)
- **Frontend**: React + TypeScript + Tailwind CSS
- **Transcription**: Deepgram Nova-3 WebSocket API
- **Audio Capture**: macOS ScreenCaptureKit (native Swift binary)
- **Storage**: electron-store (JSON-based persistence)

---

## Electron Fundamentals

Electron combines Chromium (for rendering) and Node.js (for system access) into a single runtime.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Main Process** | The "backend" of your app. Has full Node.js access, can use native APIs, manages windows. Only ONE main process exists. |
| **Renderer Process** | The "frontend" of your app. Runs in a Chromium browser context. Each window is a separate renderer process. |
| **Preload Script** | A bridge between main and renderer. Runs in renderer context but can access some Node.js APIs. Used for secure IPC. |
| **Context Isolation** | Security feature that separates the preload script's context from the renderer's context. |
| **IPC** | Inter-Process Communication. How main and renderer processes talk to each other. |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - Full Node.js access (file system, native modules)        ││
│  │  - System-level APIs (audio capture, global shortcuts)      ││
│  │  - Window management (create, position, show/hide)          ││
│  │  - Application lifecycle (startup, shutdown)                ││
│  │  - Persistent storage (electron-store)                      ││
│  │  - Deepgram WebSocket connection                            ││
│  │  - Native binary management (SystemAudioDump)               ││
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
│  │  │ - TranscriptHist│  │    │  │                         │  ││
│  │  └─────────────────┘  │    │  └─────────────────────────┘  ││
│  │  - User interface     │    │  - Transparent window         ││
│  │  - Settings management│    │  - Displays transcriptions    ││
│  │  - Start/stop control │    │  - Always on top              ││
│  └───────────────────────┘    └───────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Process Architecture

### Main Process (`src/main/main.ts`)

The main process is the entry point of the application. It:

1. **Creates Windows**: Spawns BrowserWindow instances for control panel and overlay
2. **Manages State**: Tracks transcription state (idle, starting, active, stopping)
3. **Handles Audio**: Spawns native audio capture binary, processes audio data
4. **Connects to Deepgram**: Manages WebSocket connection for real-time transcription
5. **Stores Data**: Persists settings and transcripts using electron-store
6. **Registers Shortcuts**: Global keyboard shortcuts that work even when app isn't focused

### Renderer Processes

Each window runs in its own renderer process:

**Control Window** (`src/renderer/control/`)
- React-based UI for controlling the app
- Settings management (API key, language, overlay style)
- Transcript history viewing
- Start/stop transcription controls

**Overlay Window** (`src/renderer/overlay/`)
- Transparent, always-on-top window
- Displays real-time subtitles
- Click-through (doesn't capture mouse events)
- Positioned at bottom of screen

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

---

## Project Structure

```
language-agent/
├── src/
│   ├── main/                      # Main process code
│   │   ├── main.ts                # Entry point, window creation, IPC handlers
│   │   ├── preload-control.ts     # Preload for control window
│   │   ├── preload-overlay.ts     # Preload for overlay window
│   │   ├── deepgram-transcription.ts  # Deepgram WebSocket client
│   │   └── audio-capture.ts       # Audio capture utilities (unused)
│   │
│   ├── renderer/                  # Renderer process code
│   │   ├── control/               # Control panel window
│   │   │   ├── index.html         # HTML entry point
│   │   │   ├── index.tsx          # React entry point
│   │   │   ├── ControlPanel.tsx   # Main UI component
│   │   │   ├── TranscriptHistory.tsx  # Saved transcripts viewer
│   │   │   ├── useSystemAudio.ts  # Audio capture hook (Windows)
│   │   │   └── styles.css         # Tailwind styles
│   │   │
│   │   └── overlay/               # Overlay window
│   │       ├── index.html
│   │       ├── index.tsx
│   │       ├── SubtitleOverlay.tsx
│   │       └── styles.css
│   │
│   └── shared/                    # Shared between main and renderer
│       └── types.ts               # TypeScript types, IPC channels, constants
│
├── assets/                        # Native binaries and resources
│   ├── SystemAudioDump            # Compiled macOS audio capture binary
│   ├── SystemAudioDump.swift      # Swift source for audio capture
│   └── build-macos-binary.sh      # Build script for Swift binary
│
├── research/                      # Documentation
│   ├── ARCHITECTURE.md            # This file
│   └── audio-debugging-notes.md   # Audio pipeline debugging notes
│
├── dist/                          # Compiled output (webpack)
├── webpack.main.config.js         # Main process bundling
├── webpack.renderer.config.js     # Renderer process bundling
├── tailwind.config.js             # Tailwind CSS config
├── tsconfig.json                  # TypeScript config
└── package.json
```

---

## Audio Pipeline

### macOS System Audio Capture

The application uses a native Swift binary (`SystemAudioDump`) built with ScreenCaptureKit to capture system audio output.

```
┌─────────────────────────────────────────────────────────────────┐
│  macOS System Audio                                              │
│  (Any app playing audio: browser, media player, etc.)           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  SystemAudioDump (Native Swift Binary)                           │
│  - Uses ScreenCaptureKit API                                     │
│  - Captures system audio output                                  │
│  - Converts Float32 → Int16                                      │
│  - Outputs to stdout                                             │
│                                                                  │
│  Output Format:                                                  │
│  - Sample Rate: 24 kHz                                           │
│  - Channels: 2 (Stereo, PLANAR format)                          │
│  - Bit Depth: 16-bit signed integer                             │
│  - Layout: [L0,L1,L2...Ln, R0,R1,R2...Rn] (NOT interleaved)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ stdout (raw PCM bytes)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Main Process Audio Handler                                      │
│                                                                  │
│  1. Buffer incoming data                                         │
│  2. Process in 20ms chunks (1920 bytes stereo)                  │
│  3. Convert PLANAR stereo → mono (take first half)              │
│  4. Result: 960 bytes mono per chunk                            │
└────────────────────────────┬────────────────────────────────────┘
                             │ 24kHz mono Int16
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Deepgram WebSocket                                              │
│  wss://api.deepgram.com/v1/listen                               │
│                                                                  │
│  Configuration:                                                  │
│  - model: nova-3                                                │
│  - encoding: linear16                                           │
│  - sample_rate: 24000                                           │
│  - channels: 1                                                  │
│  - interim_results: true                                        │
│  - punctuate: true                                              │
│  - smart_format: true                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │ JSON transcription results
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Overlay Window                                                  │
│  - Displays interim results (updates in real-time)              │
│  - Finalizes text when is_final=true                            │
│  - Fades out after displayDuration                              │
└─────────────────────────────────────────────────────────────────┘
```

### Audio Format Constants

```typescript
const CAPTURE_SAMPLE_RATE = 24000;  // From native binary
const CHANNELS = 2;                  // Stereo (planar format)
const BYTES_PER_SAMPLE = 2;          // 16-bit
const CHUNK_DURATION = 0.02;         // 20ms for low latency
const CHUNK_SIZE = 1920;             // bytes per stereo chunk
```

### Stereo to Mono Conversion

The native binary outputs **planar stereo** (all left samples, then all right samples), not interleaved stereo. The conversion simply takes the first half of each chunk:

```typescript
function convertStereoToMono(stereoBuffer: Buffer): Buffer {
  // Planar: [L0, L1, L2..., R0, R1, R2...]
  // Just take the first half (left channel)
  return stereoBuffer.slice(0, stereoBuffer.length / 2);
}
```

---

## IPC Communication

### Communication Patterns

#### 1. Invoke/Handle (Request-Response)

Used when renderer needs data from main or wants to trigger an action:

```typescript
// Main process
ipcMain.handle('get-settings', () => store.get('settings'));

// Renderer process
const settings = await window.electronAPI.getSettings();
```

#### 2. Send/On (One-way, Main → Renderer)

Used when main needs to push updates to renderer:

```typescript
// Main process
overlayWindow.webContents.send('transcription-update', result);

// Renderer process (via preload)
ipcRenderer.on('transcription-update', (event, result) => {
  callback(result);
});
```

### IPC Channels

All channel names are defined in `src/shared/types.ts`:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `start-transcription` | Control → Main | Start transcription session |
| `stop-transcription` | Control → Main | Stop transcription session |
| `get-settings` | Control → Main | Retrieve app settings |
| `update-settings` | Control → Main | Save app settings |
| `start-system-audio` | Control → Main | Start native audio capture |
| `stop-system-audio` | Control → Main | Stop native audio capture |
| `transcription-update` | Main → Overlay | Send transcript to display |
| `clear-transcription` | Main → Overlay | Clear subtitle display |
| `state-changed` | Main → Control | Notify state transitions |
| `get-transcripts` | Control → Main | Get saved transcript history |
| `delete-transcript` | Control → Main | Delete a saved transcript |

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
       │                    │ 1. Connect to Deepgram (WebSocket)
       │                    │                    │
       │                    │ 2. Spawn SystemAudioDump
       │                    │    (native binary)  │
       │                    │                    │
       │    state: active   │                    │
       │<───────────────────│                    │
       │                    │                    │
       │                    │ 3. Audio chunks flow
       │                    │ ┌────────────────┐ │
       │                    │ │Native Binary   │ │
       │                    │ │→ Main Process  │ │
       │                    │ │→ Deepgram WS   │ │
       │                    │ └────────────────┘ │
       │                    │                    │
       │                    │ 4. Transcript received
       │                    │───────────────────>│
       │                    │                    │
       │                    │                    │ Display subtitle
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
- Tracks diagnostic information (chunks sent, transcripts received)

### ControlPanel (`src/renderer/control/ControlPanel.tsx`)

Main React component for user interface:
- Start/stop transcription button
- API key configuration
- Language selection
- Overlay style settings
- Real-time diagnostic display

### SubtitleOverlay (`src/renderer/overlay/SubtitleOverlay.tsx`)

Displays real-time transcriptions:
- Receives updates via IPC
- Shows interim results (updates in place)
- Finalizes and fades out completed segments
- Supports CJK fonts for Asian languages

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

1. All final transcripts collected during session are joined
2. Metadata generated (title, duration, word count)
3. Saved to electron-store
4. Available in transcript history view

---

## Configuration

### Environment Requirements

- **macOS**: 12.3+ (for ScreenCaptureKit)
- **Node.js**: 18+
- **Deepgram API Key**: Required for transcription

### Build Commands

```bash
npm run build         # Build everything
npm run build:main    # Build main process only
npm run build:renderer  # Build renderer processes only
npm run dev           # Development mode with watch
npm start             # Build and run
```

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+S` | Toggle transcription on/off |
| `Cmd+Shift+H` | Show/hide overlay |

---

## Security Considerations

1. **Context Isolation**: Enabled by default, prevents renderer from accessing Node.js
2. **Preload Scripts**: Only expose necessary APIs via `contextBridge`
3. **API Key Storage**: Stored locally in electron-store (not transmitted except to Deepgram)
4. **No Remote Content**: App doesn't load external web content

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

Language Agent follows standard Electron patterns:

1. **Main process** handles system-level operations (audio capture, Deepgram connection, storage)
2. **Renderer processes** handle UI (React components)
3. **Preload scripts** provide secure bridge via IPC
4. **Native binary** captures system audio via ScreenCaptureKit
5. **Shared types** ensure type safety across processes

The audio flows from system → native binary → main process (stereo→mono conversion) → Deepgram → overlay, with all coordination happening in the main process.
