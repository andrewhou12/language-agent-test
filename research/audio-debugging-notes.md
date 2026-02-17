# Audio Processing Debugging Notes

## Problem Summary

Real-time transcription had two issues:
1. **2x real-time ratio** - Sending twice as much audio data as expected
2. **Pitched up audio** - Debug PCM files sounded high-pitched when played at the expected sample rate

## Native Binary Output Format

The macOS `SystemAudioDump` binary (using ScreenCaptureKit) outputs:
```
Audio format: 1819304813, bits: 32, flags: 41, rate: 24000.0, channels: 2
```

- **Sample rate**: 24kHz
- **Channels**: 2 (stereo)
- **Format**: Originally Float32, converted to Int16 in Swift before output

## The Debugging Journey

### Symptom 1: 2x Real-Time Ratio

With `CHANNELS = 1` (mono assumption):
- `CHUNK_SIZE = 24000 * 2 * 1 * 0.02 = 960 bytes` per 20ms
- But native binary outputs stereo: 1920 bytes per 20ms
- Result: We processed 2 chunks per 20ms instead of 1
- **Real-time ratio: 1.97x**

**Fix**: Set `CHANNELS = 2` to correctly calculate chunk size for stereo input.

### Symptom 2: Pitched Up Audio

After fixing the real-time ratio, audio was still pitched up. The key insight:

**We assumed INTERLEAVED stereo:**
```
[L0, R0, L1, R1, L2, R2, ...]
```

**But native binary outputs PLANAR stereo:**
```
[L0, L1, L2, ..., L959, R0, R1, R2, ..., R959]
```

Our original conversion function read at `i * 4` byte offsets, expecting interleaved format:
```javascript
// WRONG - assumes interleaved
for (let i = 0; i < stereoFrames; i++) {
    const leftSample = stereoBuffer.readInt16LE(i * 4);
    monoBuffer.writeInt16LE(leftSample, i * 2);
}
```

With planar data, this skipped every other left sample:
- i=0: offset 0 → L0
- i=1: offset 4 → L2 (skipped L1!)
- i=2: offset 8 → L4 (skipped L3!)

Result: Half the samples → audio pitched up by one octave.

**Fix**: For planar stereo, just take the first half of the buffer:
```javascript
function convertStereoToMono(stereoBuffer: Buffer): Buffer {
    // Native binary outputs PLANAR stereo: [L0, L1, L2..., R0, R1, R2...]
    // Just take the first half (left channel)
    const halfSize = stereoBuffer.length / 2;
    return stereoBuffer.slice(0, halfSize);
}
```

## Key Learnings

### 1. Stereo Format Matters
There are two common stereo layouts:
- **Interleaved**: `[L, R, L, R, ...]` - Common in real-time audio APIs
- **Planar**: `[L, L, L, ..., R, R, R, ...]` - Common in video/media frameworks

ScreenCaptureKit on macOS uses **planar** format.

### 2. Real-Time Ratio as a Diagnostic
The real-time ratio (`audio_sent / session_duration`) is a powerful diagnostic:
- **~1.0x**: Correct data rate
- **~2.0x**: Likely treating stereo as mono (double the expected data)
- **~0.5x**: Likely missing half the data or wrong sample rate

### 3. Debug Audio Files Are Essential
Saving raw PCM to disk and playing at different sample rates quickly reveals:
- Pitched up = sample rate too high or samples being skipped
- Pitched down/slow = sample rate too low
- Garbled = wrong byte order or channel interpretation

### 4. L/R Channels Can Be Identical
System audio capture often has identical L and R channels (mono source playing to stereo output). This means either channel works for mono conversion.

## Final Configuration

```javascript
// Audio format constants
const CAPTURE_SAMPLE_RATE = 24000;  // From native binary
const DEEPGRAM_SAMPLE_RATE = 16000; // Deepgram optimal (not used - sending 24kHz)
const CHANNELS = 2;                  // Native binary outputs stereo
const BYTES_PER_SAMPLE = 2;          // 16-bit
const CHUNK_DURATION = 0.02;         // 20ms chunks
const CHUNK_SIZE = CAPTURE_SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;
// = 24000 * 2 * 2 * 0.02 = 1920 bytes per chunk

// Deepgram configured for 24kHz mono input
sample_rate: 24000,
channels: 1,
```

## Audio Pipeline

```
SystemAudioDump (macOS native)
    ↓
24kHz, Stereo, Int16, PLANAR format
    ↓
convertStereoToMono() - take first half of buffer
    ↓
24kHz, Mono, Int16
    ↓
Deepgram WebSocket (configured for 24kHz)
    ↓
Transcription results
```

## Test Results (Final)

```
[STATS] Session duration: 28.0s
[STATS] Audio sent: 27.4s (1369 chunks)
[STATS] Real-time ratio: 0.98x
[STATS] Transcription quality: Excellent
[STATS] Debug audio at 24kHz: Sounds correct
```
