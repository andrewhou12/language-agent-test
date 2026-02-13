# WhisperLive Integration: Architectural Research Document

## Executive Summary

WhisperLive is a real-time speech-to-text transcription system built on OpenAI's Whisper model. It uses a client-server architecture with WebSocket communication to stream audio and receive transcription results with near-live latency. This document outlines how to integrate or replicate this technology in an Electron application.

---

## 1. WhisperLive Architecture Overview

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ Audio Input │ →  │ Audio       │ →  │ WebSocket Client    │  │
│  │ (Mic/File)  │    │ Processing  │    │ (Binary Streaming)  │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ WebSocket (ws://)
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ Connection  │ →  │ VAD Filter  │ →  │ Whisper Backend     │  │
│  │ Manager     │    │ (Optional)  │    │ (Transcription)     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                               ↓                  │
│                              ┌─────────────────────────────────┐ │
│                              │ Translation Backend (Optional)  │ │
│                              └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Key Technical Details

| Aspect | Specification |
|--------|---------------|
| Audio Format | Float32, Mono, 16kHz sample rate |
| Protocol | WebSocket (binary audio, JSON control messages) |
| Backends | Faster-Whisper, TensorRT, OpenVINO |
| VAD | Silero VAD (ONNX) |
| Buffer | 45-second sliding window |
| Default Port | 9090 |

---

## 2. Integration Strategies for Electron

### Option A: Remote Server (Recommended for Most Use Cases)

Run WhisperLive server separately; Electron app acts as a client.

```
┌──────────────────────────┐         ┌──────────────────────────┐
│     ELECTRON APP         │         │    WHISPERLIVE SERVER    │
│  ┌────────────────────┐  │   WS    │  ┌────────────────────┐  │
│  │ Renderer Process   │  │ ──────► │  │ Python Server      │  │
│  │ (Audio Capture)    │  │         │  │ (Whisper Model)    │  │
│  └────────────────────┘  │ ◄────── │  └────────────────────┘  │
│                          │  JSON   │                          │
└──────────────────────────┘         └──────────────────────────┘
```

**Pros:**
- GPU acceleration on server
- Simpler Electron app (no ML dependencies)
- Supports multiple model sizes
- Easy scaling

**Cons:**
- Requires network connectivity
- Server infrastructure needed
- Latency over network

### Option B: Local Embedded Server

Spawn WhisperLive server as a child process from Electron.

```
┌─────────────────────────────────────────────────────────────────┐
│                      ELECTRON APP                                │
│  ┌────────────────────┐       ┌───────────────────────────────┐ │
│  │ Main Process       │ spawn │ Python Child Process          │ │
│  │ (Node.js)          │ ────► │ (WhisperLive Server)          │ │
│  └────────────────────┘       └───────────────────────────────┘ │
│           ↑                              ↑                       │
│           │ IPC                          │ WebSocket             │
│           ↓                              ↓                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Renderer Process (Audio Capture + WebSocket Client)        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Works offline
- No external server needed
- Full control over lifecycle

**Cons:**
- Requires bundled Python + dependencies
- Large app size (~2-5GB with models)
- Complex packaging

### Option C: WebAssembly / Pure JS (Alternative)

Use whisper.cpp compiled to WASM or onnxruntime-web.

**Pros:**
- No Python dependency
- Smaller package size
- Pure web stack

**Cons:**
- Slower than native
- Limited model sizes (tiny/small)
- No GPU acceleration in browser context

---

## 3. Recommended Electron Implementation

### Architecture for Option A (Remote Server)

```typescript
// Main architectural components needed in Electron

ElectronApp/
├── main/
│   ├── index.ts              // Main process entry
│   └── preload.ts            // Secure bridge to renderer
├── renderer/
│   ├── audio/
│   │   ├── AudioCapture.ts   // Web Audio API microphone capture
│   │   └── AudioProcessor.ts // Resampling & format conversion
│   ├── websocket/
│   │   ├── WhisperClient.ts  // WebSocket management
│   │   └── Protocol.ts       // Message type definitions
│   └── components/
│       └── Transcription.tsx // UI components
└── shared/
    └── types.ts              // Shared TypeScript types
```

### Core Implementation Components

#### 3.1 Audio Capture (Renderer Process)

```typescript
// AudioCapture.ts - Web Audio API based capture

interface AudioCaptureConfig {
  sampleRate: number;      // Target: 16000 Hz
  channels: number;        // 1 (mono)
  chunkSize: number;       // Samples per chunk (e.g., 4096)
}

class AudioCapture {
  private audioContext: AudioContext;
  private mediaStream: MediaStream;
  private processor: ScriptProcessorNode | AudioWorkletNode;

  async start(onChunk: (audioData: Float32Array) => void): Promise<void> {
    // 1. Get microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    // 2. Create audio context at 16kHz
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // 3. Connect microphone to processor
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 4. Use AudioWorklet for modern approach (or ScriptProcessor fallback)
    await this.audioContext.audioWorklet.addModule('audio-processor.js');
    this.processor = new AudioWorkletNode(this.audioContext, 'audio-processor');

    this.processor.port.onmessage = (event) => {
      const audioData = new Float32Array(event.data);
      onChunk(audioData);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop(): void {
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close();
  }
}
```

#### 3.2 Audio Processor Worklet

```javascript
// audio-processor.js - AudioWorklet processor

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Send buffer to main thread
        this.port.postMessage(this.buffer.slice());
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
```

#### 3.3 WebSocket Client

```typescript
// WhisperClient.ts - WebSocket communication with WhisperLive server

interface WhisperConfig {
  host: string;
  port: number;
  language?: string;
  model?: string;
  useVad?: boolean;
  enableTranslation?: boolean;
  targetLanguage?: string;
}

interface TranscriptionSegment {
  start: string;
  end: string;
  text: string;
  completed: boolean;
}

interface ServerMessage {
  uid: string;
  message?: string;
  segments?: TranscriptionSegment[];
  translated_segments?: TranscriptionSegment[];
  language?: string;
  language_prob?: number;
  status?: 'WAIT' | 'ERROR' | 'WARNING';
}

class WhisperClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private uid: string;
  private config: WhisperConfig;

  constructor(config: WhisperConfig) {
    super();
    this.config = config;
    this.uid = crypto.randomUUID();
  }

  connect(): void {
    const url = `ws://${this.config.host}:${this.config.port}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => this.sendInitialConfig();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = (error) => this.emit('error', error);
    this.ws.onclose = () => this.emit('disconnected');
  }

  private sendInitialConfig(): void {
    const config = {
      uid: this.uid,
      language: this.config.language || null,
      task: 'transcribe',
      model: this.config.model || 'small',
      use_vad: this.config.useVad ?? true,
      send_last_n_segments: 10,
      no_speech_thresh: 0.45,
      enable_translation: this.config.enableTranslation ?? false,
      target_language: this.config.targetLanguage,
    };

    this.ws?.send(JSON.stringify(config));
  }

  private handleMessage(event: MessageEvent): void {
    const data: ServerMessage = JSON.parse(event.data);

    if (data.message === 'SERVER_READY') {
      this.emit('ready', data);
      return;
    }

    if (data.status === 'WAIT') {
      this.emit('waiting', data.message);
      return;
    }

    if (data.segments) {
      this.emit('transcription', data.segments);
    }

    if (data.translated_segments) {
      this.emit('translation', data.translated_segments);
    }

    if (data.language) {
      this.emit('language-detected', {
        language: data.language,
        probability: data.language_prob,
      });
    }
  }

  sendAudio(audioData: Float32Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send as binary (Float32Array buffer)
      this.ws.send(audioData.buffer);
    }
  }

  endStream(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Signal end of audio stream
      const encoder = new TextEncoder();
      this.ws.send(encoder.encode('END_OF_AUDIO'));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
```

#### 3.4 Integration Example

```typescript
// TranscriptionService.ts - Putting it all together

class TranscriptionService {
  private audioCapture: AudioCapture;
  private whisperClient: WhisperClient;
  private isRunning = false;

  constructor(serverConfig: WhisperConfig) {
    this.audioCapture = new AudioCapture();
    this.whisperClient = new WhisperClient(serverConfig);

    // Set up event handlers
    this.whisperClient.on('ready', () => {
      console.log('Connected to WhisperLive server');
    });

    this.whisperClient.on('transcription', (segments) => {
      // Process transcription segments
      this.onTranscription(segments);
    });

    this.whisperClient.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    // 1. Connect to server
    this.whisperClient.connect();

    // 2. Wait for server ready
    await new Promise<void>((resolve) => {
      this.whisperClient.once('ready', resolve);
    });

    // 3. Start audio capture and stream
    await this.audioCapture.start((audioData) => {
      this.whisperClient.sendAudio(audioData);
    });

    this.isRunning = true;
  }

  stop(): void {
    if (!this.isRunning) return;

    this.whisperClient.endStream();
    this.audioCapture.stop();
    this.whisperClient.disconnect();

    this.isRunning = false;
  }

  private onTranscription(segments: TranscriptionSegment[]): void {
    // Get the latest segment
    const latest = segments[segments.length - 1];
    if (latest) {
      // Emit to UI or process further
      console.log(`[${latest.start} → ${latest.end}] ${latest.text}`);
    }
  }
}
```

---

## 4. Protocol Specification

### Connection Handshake

```
Client                                  Server
   |                                       |
   |  ──── WebSocket Connect ────────────► |
   |                                       |
   |  ──── JSON Config ──────────────────► |
   |  {                                    |
   |    "uid": "uuid",                     |
   |    "language": "en",                  |
   |    "model": "small",                  |
   |    "use_vad": true,                   |
   |    "task": "transcribe"               |
   |  }                                    |
   |                                       |
   |  ◄──── SERVER_READY ─────────────────|
   |  {                                    |
   |    "uid": "uuid",                     |
   |    "message": "SERVER_READY",         |
   |    "backend": "faster_whisper"        |
   |  }                                    |
   |                                       |
```

### Audio Streaming

```
Client                                  Server
   |                                       |
   |  ──── Binary Float32 Audio ────────► |
   |       (16kHz, mono, chunks)           |
   |                                       |
   |  ◄──── Transcription JSON ───────────|
   |  {                                    |
   |    "uid": "uuid",                     |
   |    "segments": [{                     |
   |      "start": "0.000",                |
   |      "end": "2.500",                  |
   |      "text": "Hello world",           |
   |      "completed": true                |
   |    }]                                 |
   |  }                                    |
   |                                       |
   |  ──── "END_OF_AUDIO" ───────────────►|
   |                                       |
   |  ◄──── Final segments ───────────────|
   |                                       |
   |  ──── WebSocket Close ──────────────►|
   |                                       |
```

### Message Types Summary

| Direction | Type | Format | Purpose |
|-----------|------|--------|---------|
| C→S | Config | JSON | Initial configuration |
| C→S | Audio | Binary Float32 | Audio stream chunks |
| C→S | End | "END_OF_AUDIO" | Signal stream end |
| S→C | Ready | JSON | Server ready confirmation |
| S→C | Segments | JSON | Transcription results |
| S→C | Language | JSON | Detected language |
| S→C | Status | JSON | Wait/Error/Warning |
| S→C | Translation | JSON | Translated segments |

---

## 5. Audio Processing Requirements

### Format Specifications

```typescript
const AUDIO_CONFIG = {
  sampleRate: 16000,        // 16 kHz required
  channels: 1,              // Mono
  bitDepth: 32,             // Float32
  chunkDuration: 0.256,     // ~256ms per chunk (4096 samples)
  minBufferDuration: 1.0,   // Server needs ≥1 second to transcribe
};
```

### Resampling (if needed)

If capturing at a different sample rate (e.g., 44.1kHz or 48kHz), resample to 16kHz:

```typescript
// Using OfflineAudioContext for resampling
async function resampleAudio(
  audioData: Float32Array,
  fromRate: number,
  toRate: number
): Promise<Float32Array> {
  const duration = audioData.length / fromRate;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(duration * toRate),
    toRate
  );

  const buffer = offlineCtx.createBuffer(1, audioData.length, fromRate);
  buffer.getChannelData(0).set(audioData);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
```

---

## 6. Server Deployment Options

### Option 1: Docker (Recommended for Production)

```bash
# GPU-enabled server
docker run -d \
  --gpus all \
  -p 9090:9090 \
  --name whisperlive \
  ghcr.io/collabora/whisperlive-gpu:latest

# CPU-only server
docker run -d \
  -p 9090:9090 \
  --name whisperlive \
  ghcr.io/collabora/whisperlive-cpu:latest
```

### Option 2: Local Python Server

```bash
# Install
pip install whisper-live

# Run
python3 run_server.py \
  --port 9090 \
  --backend faster_whisper \
  --max_clients 4
```

### Option 3: Electron-Spawned Server

```typescript
// main/server-manager.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

class WhisperServerManager {
  private serverProcess: ChildProcess | null = null;
  private pythonPath: string;
  private serverScript: string;

  constructor() {
    // Path to bundled Python and server script
    this.pythonPath = path.join(process.resourcesPath, 'python', 'python');
    this.serverScript = path.join(process.resourcesPath, 'whisper', 'run_server.py');
  }

  async start(port: number = 9090): Promise<void> {
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn(this.pythonPath, [
        this.serverScript,
        '--port', String(port),
        '--backend', 'faster_whisper',
        '--max_clients', '1',
      ]);

      this.serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server is running')) {
          resolve();
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      this.serverProcess.on('error', reject);
    });
  }

  stop(): void {
    this.serverProcess?.kill();
    this.serverProcess = null;
  }
}
```

---

## 7. Electron-Specific Considerations

### Permissions

```json
// package.json - Electron permissions
{
  "build": {
    "mac": {
      "entitlements": "entitlements.plist",
      "extendInfo": {
        "NSMicrophoneUsageDescription": "Required for speech transcription"
      }
    }
  }
}
```

### Preload Script Security

```typescript
// preload.ts - Secure IPC bridge
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('transcription', {
  start: (config: WhisperConfig) => ipcRenderer.invoke('transcription:start', config),
  stop: () => ipcRenderer.invoke('transcription:stop'),
  onSegment: (callback: (segment: TranscriptionSegment) => void) => {
    ipcRenderer.on('transcription:segment', (_, segment) => callback(segment));
  },
});
```

### Main Process Handlers

```typescript
// main/index.ts
import { ipcMain } from 'electron';

ipcMain.handle('transcription:start', async (event, config) => {
  // Start transcription service
  await transcriptionService.start(config);
});

ipcMain.handle('transcription:stop', async () => {
  transcriptionService.stop();
});
```

---

## 8. Performance Considerations

### Latency Budget

| Component | Typical Latency |
|-----------|-----------------|
| Audio capture | ~10ms |
| Network (local) | ~1-5ms |
| Server buffering | ~256ms (min chunk) |
| Whisper inference | ~100-500ms (depends on model) |
| Network response | ~1-5ms |
| **Total** | **~400-800ms** |

### Optimization Strategies

1. **Use smaller models** for faster inference (tiny/small)
2. **Enable VAD** to reduce unnecessary processing
3. **Local server** eliminates network latency
4. **GPU acceleration** (CUDA/TensorRT) for faster inference
5. **Streaming chunks** (256ms) rather than larger buffers

### Memory Usage

| Model Size | VRAM/RAM Required |
|------------|-------------------|
| tiny | ~1GB |
| small | ~2GB |
| medium | ~5GB |
| large-v3 | ~10GB |

---

## 9. Error Handling

### Connection Failures

```typescript
class ResilientWhisperClient extends WhisperClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(config: WhisperConfig) {
    super(config);

    this.on('disconnected', () => this.handleDisconnect());
    this.on('error', (error) => this.handleError(error));
  }

  private async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      await this.delay(this.reconnectDelay * this.reconnectAttempts);
      this.connect();
    } else {
      this.emit('connection-failed');
    }
  }

  private handleError(error: Error): void {
    console.error('WebSocket error:', error);
    // Log to error tracking service
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Server Capacity

Handle "WAIT" status when server is at capacity:

```typescript
this.whisperClient.on('waiting', (waitTime: string) => {
  const minutes = parseFloat(waitTime);
  this.emit('server-busy', { estimatedWaitMinutes: minutes });
  // Show UI notification to user
});
```

---

## 10. Testing Strategy

### Unit Tests

```typescript
describe('WhisperClient', () => {
  it('should connect and receive SERVER_READY', async () => {
    const client = new WhisperClient({ host: 'localhost', port: 9090 });
    const readyPromise = new Promise(r => client.once('ready', r));
    client.connect();
    await expect(readyPromise).resolves.toBeDefined();
  });

  it('should send audio and receive transcription', async () => {
    // Test with sample audio file
  });
});
```

### Integration Tests

```typescript
describe('TranscriptionService', () => {
  it('should transcribe microphone input', async () => {
    // Use mock audio input
    // Verify transcription segments received
  });
});
```

---

## 11. Summary & Recommendations

### For Quick Integration

1. **Deploy WhisperLive server** (Docker recommended)
2. **Implement WebSocket client** in Electron renderer
3. **Use Web Audio API** for microphone capture
4. **Stream Float32 audio** at 16kHz to server
5. **Handle JSON transcription responses**

### For Offline Capability

1. **Bundle Python + WhisperLive** with Electron
2. **Spawn server as child process**
3. **Use smaller models** (tiny/small) to reduce size
4. **Consider whisper.cpp** alternatives for pure native solution

### Model Selection Guide

| Use Case | Recommended Model | Accuracy | Speed |
|----------|-------------------|----------|-------|
| Real-time captioning | tiny/small | Good | Fast |
| Professional transcription | medium | Better | Moderate |
| Maximum accuracy | large-v3 | Best | Slow |
| Multilingual | large-v3 | Best | Slow |

---

## References

- [WhisperLive GitHub](https://github.com/collabora/WhisperLive)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Electron Documentation](https://www.electronjs.org/docs)
