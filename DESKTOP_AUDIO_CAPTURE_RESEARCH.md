# Desktop Audio Capture Research Document

This document explains how to capture desktop/system audio in an Electron application on macOS and Windows.

## Overview

Desktop audio capture requires platform-specific implementations:
- **macOS**: Requires a native binary using CoreAudio (ScreenCaptureKit)
- **Windows**: Uses Electron's built-in WASAPI loopback via `getDisplayMedia()`
- **Linux**: No reliable method available

---

## macOS Implementation

### Architecture
macOS does not expose system audio through web APIs. You need a **native Swift/Objective-C binary** that uses Apple's `ScreenCaptureKit` framework to capture system audio, then pipes the raw PCM data to your Electron app via stdout.

### Native Binary (Swift)
Create a command-line tool called `SystemAudioDump` that:
1. Uses `ScreenCaptureKit` to capture system audio
2. Outputs raw PCM audio to stdout (16-bit signed integers, little-endian)
3. Format: 24kHz sample rate, stereo (2 channels)

Key ScreenCaptureKit classes:
- `SCShareableContent` - enumerate audio sources
- `SCStreamConfiguration` - configure audio capture settings
- `SCStream` - the actual capture stream

### Node.js Integration (Main Process)

```javascript
const { spawn } = require('child_process');
const path = require('path');

// Audio format constants
const SAMPLE_RATE = 24000;
const CHANNELS = 2;  // stereo from native binary
const BYTES_PER_SAMPLE = 2;  // 16-bit
const CHUNK_DURATION = 0.1;  // 100ms chunks
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

let systemAudioProc = null;

function startMacOSAudioCapture() {
    if (process.platform !== 'darwin') return;

    // Path to native binary (adjust for packaged app)
    const { app } = require('electron');
    const binaryPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'SystemAudioDump')
        : path.join(app.getAppPath(), 'assets', 'SystemAudioDump');

    // Spawn the native binary
    systemAudioProc = spawn(binaryPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let audioBuffer = Buffer.alloc(0);

    // Process audio data from stdout
    systemAudioProc.stdout.on('data', (data) => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        // Process in chunks
        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            // Convert stereo to mono (take left channel only)
            const monoChunk = convertStereoToMono(chunk);

            // Convert to base64 for IPC transmission
            const base64Data = monoChunk.toString('base64');

            // Send to renderer or STT service
            mainWindow.webContents.send('system-audio-data', { data: base64Data });
        }
    });

    systemAudioProc.stderr.on('data', (data) => {
        console.error('SystemAudioDump error:', data.toString());
    });

    systemAudioProc.on('close', (code) => {
        console.log('SystemAudioDump closed with code:', code);
        systemAudioProc = null;
    });
}

function convertStereoToMono(stereoBuffer) {
    // Input: interleaved stereo (L R L R...), 16-bit samples
    // Output: mono (L L L...), 16-bit samples
    const samples = stereoBuffer.length / 4;  // 4 bytes per stereo sample pair
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}
```

### Building the Native Binary
1. Create a new Swift command-line project in Xcode
2. Add `ScreenCaptureKit` framework
3. Request screen recording permission in your Electron app's entitlements
4. Build as a universal binary (arm64 + x86_64)
5. Place in your app's assets folder and ensure it's unpacked from asar

### Required Permissions (Info.plist / Entitlements)
```xml
<key>NSScreenCaptureUsageDescription</key>
<string>This app needs screen capture permission to capture system audio.</string>
```

---

## Windows Implementation

### Architecture
Windows is simpler - Electron provides native WASAPI loopback audio through the `getDisplayMedia()` API when configured properly.

### Main Process Setup (index.js)

```javascript
const { app, session, desktopCapturer } = require('electron');

app.whenReady().then(() => {
    // Setup native loopback audio capture handler
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            // Grant access to first screen with loopback audio
            callback({ video: sources[0], audio: 'loopback' });
        }).catch((error) => {
            console.error('Failed to get sources:', error);
            callback({});
        });
    });
});
```

### Renderer Process Usage

```javascript
async function startWindowsAudioCapture() {
    // Request display media with audio - Electron's handler provides loopback
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // Required, but can use minimal settings
        audio: true    // This triggers the loopback audio from our handler
    });

    // Extract audio track
    const audioTrack = mediaStream.getAudioTracks()[0];
    if (!audioTrack) {
        throw new Error('No audio track in loopback stream');
    }

    // Process with Web Audio API
    const audioContext = new AudioContext({ sampleRate: 24000 });
    const source = audioContext.createMediaStreamSource(
        new MediaStream([audioTrack])
    );

    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
        const float32Data = event.inputBuffer.getChannelData(0);
        // Convert to Int16 and process...
        const int16Data = convertFloat32ToInt16(float32Data);
        // Send to main process or STT service
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
}

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}
```

---

## Audio Processing (Both Platforms)

### Web Audio API Processing (Renderer)

```javascript
const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

async function setupAudioProcessing(mediaStream) {
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert Float32 to Int16
        const int16Data = convertFloat32ToInt16(inputData);

        // Convert to base64 for IPC
        const base64Data = arrayBufferToBase64(int16Data.buffer);

        // Send to main process
        window.api.sendAudioData(base64Data);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    return { audioContext, processor };
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
```

### IPC Bridge (preload.js)

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    sendAudioData: (data) => ipcRenderer.invoke('audio:send', data),
    onSystemAudioData: (callback) => ipcRenderer.on('system-audio-data', callback),
    startMacosSystemAudio: () => ipcRenderer.invoke('audio:startMacosCapture'),
    stopMacosSystemAudio: () => ipcRenderer.invoke('audio:stopMacosCapture'),
});
```

---

## Audio Format Summary

| Property | Value |
|----------|-------|
| Sample Rate | 24,000 Hz |
| Bit Depth | 16-bit signed integer (Int16) |
| Channels | 1 (mono) after conversion |
| Chunk Duration | 100ms (2,400 samples) |
| Chunk Size | 4,800 bytes (mono) |
| Encoding | Base64 for IPC, raw PCM for processing |

---

## Platform Detection

```javascript
function startDesktopAudioCapture() {
    if (process.platform === 'darwin') {
        // macOS: spawn native binary
        startMacOSAudioCapture();
    } else if (process.platform === 'win32') {
        // Windows: use Electron loopback in renderer
        // (handled via getDisplayMedia with our custom handler)
    } else {
        // Linux: no reliable system audio capture
        console.warn('System audio capture not supported on Linux');
    }
}
```

---

## Key Files to Create

1. **Native binary** (macOS only): `assets/SystemAudioDump` - Swift CLI using ScreenCaptureKit
2. **Main process**: Setup `setDisplayMediaRequestHandler` for Windows loopback
3. **Renderer process**: Audio processing with Web Audio API
4. **Preload script**: IPC bridge for audio data transmission
5. **IPC handlers**: In main process to receive audio from renderer and native binary

---

## Additional Considerations

### Echo Cancellation
If capturing both mic and system audio, implement Acoustic Echo Cancellation (AEC) to remove speaker output from mic input. Consider using:
- Speex AEC (WASM port available)
- WebRTC's built-in AEC (limited effectiveness for system audio)

### Permissions
- **macOS**: Screen Recording permission required (System Preferences > Privacy)
- **Windows**: No special permissions needed for loopback audio
- **Microphone**: Separate permission via `getUserMedia()`

### Packaging
For macOS native binary in Electron:
```json
// package.json
{
  "build": {
    "asarUnpack": ["assets/SystemAudioDump"]
  }
}
```
