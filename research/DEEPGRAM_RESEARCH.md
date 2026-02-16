# Deepgram Live Streaming Transcription - Research Document

## Overview

This document outlines how to integrate Deepgram's live streaming speech-to-text API into the Language Agent Electron desktop application, replacing the current OpenAI Whisper implementation.

## Why Deepgram Over OpenAI Whisper?

| Aspect | OpenAI Whisper (Current) | Deepgram Live Streaming |
|--------|--------------------------|-------------------------|
| **Connection Type** | HTTP REST API (batch) | WebSocket (real-time) |
| **Latency** | 2+ seconds (batch processing) | ~150ms first-word latency |
| **Audio Handling** | Requires WAV file creation | Direct raw PCM streaming |
| **Real-time** | No (chunk-and-send every 2s) | Yes (true streaming) |
| **Interim Results** | Not available | Available (see words as spoken) |
| **Cost Model** | Per-audio-minute | Per-audio-minute |

## Deepgram API Architecture

### WebSocket Connection

```
Endpoint: wss://api.deepgram.com/v1/listen
Protocol: WebSocket Secure (WSS)
Authentication: API key in URL query params or headers
```

### Connection Flow

```
1. Client opens WebSocket connection with configuration params
2. Server sends "Open" event
3. Client streams raw audio data via send()
4. Server sends transcription results in real-time
5. Client can send KeepAlive to maintain idle connections
6. Client sends CloseStream or Finalize to end session
```

## Audio Format Requirements

Deepgram supports multiple audio formats. For our use case (system audio capture):

**Recommended Configuration:**
- **Encoding**: `linear16` (16-bit signed PCM) - matches our current capture
- **Sample Rate**: `24000` Hz - matches our current SAMPLE_RATE constant
- **Channels**: `1` (mono) - we already convert stereo to mono

No format conversion needed - our existing audio pipeline is already compatible.

## SDK Installation

```bash
npm install @deepgram/sdk
```

## Basic Implementation

### 1. Initialize Client

```typescript
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const deepgram = createClient(DEEPGRAM_API_KEY);
```

### 2. Create Live Connection

```typescript
const connection = deepgram.listen.live({
  model: "nova-3",           // Latest model with best accuracy
  language: "en-US",         // Or "ja", "ko", "zh", etc.
  smart_format: true,        // Format numbers, currency, etc.
  punctuate: true,           // Add punctuation
  interim_results: true,     // Get partial results as user speaks
  endpointing: 300,          // Milliseconds of silence to detect end of speech
  encoding: "linear16",      // 16-bit PCM
  sample_rate: 24000,        // Our audio sample rate
  channels: 1,               // Mono audio
});
```

### 3. Handle Events

```typescript
connection.on(LiveTranscriptionEvents.Open, () => {
  console.log("WebSocket connected");
});

connection.on(LiveTranscriptionEvents.Transcript, (data) => {
  const transcript = data.channel.alternatives[0]?.transcript;
  const isFinal = data.is_final;
  const speechFinal = data.speech_final;

  if (transcript) {
    // Update UI with transcription
    sendTranscriptionToOverlay({
      text: transcript,
      timestamp: Date.now(),
      confidence: data.channel.alternatives[0]?.confidence || 1.0,
      isFinal,
      speechFinal,
    });
  }
});

connection.on(LiveTranscriptionEvents.Error, (error) => {
  console.error("Deepgram error:", error);
});

connection.on(LiveTranscriptionEvents.Close, () => {
  console.log("WebSocket closed");
});
```

### 4. Stream Audio

```typescript
// Send raw PCM audio data (Buffer or Uint8Array)
connection.send(audioBuffer);
```

### 5. Graceful Shutdown

```typescript
// Option 1: Flush remaining audio and close
connection.requestClose();

// Option 2: Send KeepAlive to pause without closing
connection.keepAlive();
```

## Response Format

```json
{
  "type": "Results",
  "channel_index": [0, 1],
  "duration": 1.5,
  "start": 0.0,
  "is_final": true,
  "speech_final": true,
  "channel": {
    "alternatives": [{
      "transcript": "Hello world",
      "confidence": 0.98,
      "words": [
        {"word": "hello", "start": 0.1, "end": 0.4, "confidence": 0.99},
        {"word": "world", "start": 0.5, "end": 0.9, "confidence": 0.97}
      ]
    }]
  }
}
```

### Key Response Fields

- **`is_final`**: Whether this is the final transcription for this audio segment (vs interim)
- **`speech_final`**: Whether the user has finished speaking (natural pause detected)
- **`transcript`**: The transcribed text
- **`confidence`**: Overall confidence score (0-1)
- **`words`**: Array of individual words with timing and confidence

## Implementation Strategy for Language Agent

### Architecture Changes

```
Current Architecture:
─────────────────────
Audio Capture → Buffer (2s) → Create WAV → HTTP POST → OpenAI → Response → Overlay

New Architecture:
─────────────────────
Audio Capture → WebSocket → Deepgram → Real-time Response → Overlay
```

### Key Changes Required

1. **Remove OpenAI transcription service** (`openai-transcription.ts`)
2. **Create Deepgram transcription service** with WebSocket management
3. **Modify audio pipeline** - send chunks immediately instead of buffering
4. **Update IPC handlers** - remove batch transcription, add stream events
5. **Update types** - replace `openaiApiKey` with `deepgramApiKey`

### Handling Connection Lifecycle

```typescript
class DeepgramTranscription {
  private connection: ListenLiveClient | null = null;

  async start(apiKey: string, language: string) {
    const deepgram = createClient(apiKey);
    this.connection = deepgram.listen.live({
      model: "nova-3",
      language: language === "auto" ? "en" : language,
      smart_format: true,
      punctuate: true,
      interim_results: true,
      encoding: "linear16",
      sample_rate: 24000,
      channels: 1,
    });

    // Setup event handlers...
    return new Promise((resolve) => {
      this.connection.on(LiveTranscriptionEvents.Open, resolve);
    });
  }

  send(audioData: Buffer) {
    this.connection?.send(audioData);
  }

  stop() {
    this.connection?.requestClose();
    this.connection = null;
  }
}
```

### Interim Results Strategy

For live captions, we should display interim results immediately but update them as final results arrive:

```typescript
let currentInterim = "";

connection.on(LiveTranscriptionEvents.Transcript, (data) => {
  const transcript = data.channel.alternatives[0]?.transcript || "";

  if (data.is_final) {
    // Final result - add to permanent transcript
    addFinalTranscript(transcript);
    currentInterim = "";
  } else {
    // Interim result - show temporarily
    currentInterim = transcript;
    showInterimTranscript(transcript);
  }
});
```

## Language Support

Deepgram supports our target languages:

| Language | Code | Model Recommendation |
|----------|------|---------------------|
| English | `en`, `en-US`, `en-GB` | nova-3 (best) |
| Japanese | `ja` | nova-3 |
| Korean | `ko` | nova-3 |
| Chinese | `zh`, `zh-CN`, `zh-TW` | nova-3 |
| Spanish | `es` | nova-3 |
| French | `fr` | nova-3 |
| German | `de` | nova-3 |

Note: For auto-detection, Deepgram requires specifying `detect_language: true` parameter.

## Error Handling

Common errors and handling strategies:

| Error | Cause | Solution |
|-------|-------|----------|
| Connection refused | Invalid API key | Validate key before connecting |
| WebSocket timeout | No audio sent | Send KeepAlive messages |
| Rate limit | Too many connections | Implement exponential backoff |
| Audio format error | Wrong encoding params | Ensure linear16/24000/mono |

## KeepAlive for Idle Periods

When no audio is being sent but we want to maintain the connection:

```typescript
// Send every 10 seconds during idle periods
setInterval(() => {
  if (connection && !isReceivingAudio) {
    connection.keepAlive();
  }
}, 10000);
```

## Cost Considerations

- Deepgram charges per audio minute transcribed
- KeepAlive messages don't incur charges
- Consider closing connection during extended idle periods
- Nova-3 model provides best accuracy-to-cost ratio

## Security Notes

- **Never expose API key in renderer process** (browser context)
- Keep API key in main process only
- Use environment variables or electron-store for key storage
- Connection should be managed from main process

## References

- [Deepgram Live Streaming Docs](https://developers.deepgram.com/docs/live-streaming-audio)
- [Deepgram API Reference](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [Deepgram JavaScript SDK](https://github.com/deepgram/deepgram-js-sdk)
- [Deepgram Node.js Live Example](https://github.com/deepgram-devs/node-live-example)
