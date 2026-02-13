/**
 * Audio Capture Module
 *
 * Handles system audio capture with platform-specific implementations.
 * Provides a unified interface for capturing system audio output.
 */

export interface AudioCaptureOptions {
  chunkSize: number; // Duration of each audio chunk in seconds
  sampleRate?: number; // Target sample rate (default: 16000 for Whisper)
  onAudioChunk: (audioData: Float32Array) => void;
}

export class AudioCapture {
  private options: AudioCaptureOptions;
  private isCapturing: boolean = false;
  private audioBuffer: Float32Array[] = [];
  private bufferDuration: number = 0;
  private captureInterval: NodeJS.Timeout | null = null;
  private mockAudioInterval: NodeJS.Timeout | null = null;

  constructor(options: AudioCaptureOptions) {
    this.options = {
      sampleRate: 16000, // Whisper requires 16kHz
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this.isCapturing) {
      throw new Error('Audio capture already running');
    }

    this.isCapturing = true;
    this.audioBuffer = [];
    this.bufferDuration = 0;

    // Platform-specific initialization would go here
    // For now, we'll set up a mock audio capture that generates silence
    // This will be replaced with actual platform implementations

    const platform = process.platform;

    switch (platform) {
      case 'darwin':
        await this.initMacOSCapture();
        break;
      case 'win32':
        await this.initWindowsCapture();
        break;
      case 'linux':
        await this.initLinuxCapture();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    console.log(`Audio capture started on ${platform}`);
  }

  async stop(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    this.isCapturing = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    if (this.mockAudioInterval) {
      clearInterval(this.mockAudioInterval);
      this.mockAudioInterval = null;
    }

    // Platform-specific cleanup
    await this.cleanup();

    console.log('Audio capture stopped');
  }

  private async initMacOSCapture(): Promise<void> {
    // macOS implementation using ScreenCaptureKit or virtual audio device
    // For MVP, we'll use a mock implementation
    // Real implementation would use:
    // 1. ScreenCaptureKit API (requires macOS 13+) for system audio
    // 2. BlackHole virtual audio device as fallback
    // 3. Or node-addon using CoreAudio APIs

    console.log('Initializing macOS audio capture (mock)');
    this.startMockCapture();
  }

  private async initWindowsCapture(): Promise<void> {
    // Windows implementation using WASAPI loopback
    // Real implementation would use:
    // 1. naudiodon with WASAPI loopback
    // 2. Or node-addon using Windows Audio Session API

    console.log('Initializing Windows audio capture (mock)');
    this.startMockCapture();
  }

  private async initLinuxCapture(): Promise<void> {
    // Linux implementation using PulseAudio/PipeWire
    // Real implementation would use:
    // 1. PulseAudio monitor source
    // 2. PipeWire capture
    // 3. Or ALSA loopback

    console.log('Initializing Linux audio capture (mock)');
    this.startMockCapture();
  }

  private startMockCapture(): void {
    // Generate mock audio data for testing
    // This simulates receiving audio chunks at regular intervals
    const samplesPerChunk = Math.floor(this.options.sampleRate! * this.options.chunkSize);
    const intervalMs = this.options.chunkSize * 1000;

    // Simulate audio capture by sending chunks at regular intervals
    this.captureInterval = setInterval(() => {
      if (!this.isCapturing) return;

      // Create a mock audio buffer (silence for now)
      // In real implementation, this would be actual captured audio
      const mockAudio = new Float32Array(samplesPerChunk);

      // Add some very quiet noise to simulate real audio capture
      for (let i = 0; i < mockAudio.length; i++) {
        mockAudio[i] = (Math.random() - 0.5) * 0.001;
      }

      this.options.onAudioChunk(mockAudio);
    }, intervalMs);
  }

  private async cleanup(): Promise<void> {
    // Platform-specific cleanup
    this.audioBuffer = [];
    this.bufferDuration = 0;
  }

  /**
   * Convert audio buffer to the format required by Whisper
   * - Mono channel
   * - 16kHz sample rate
   * - Float32 normalized to [-1, 1]
   */
  static preprocessAudio(
    audioData: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number = 16000
  ): Float32Array {
    // If sample rates match, return as-is
    if (inputSampleRate === outputSampleRate) {
      return audioData;
    }

    // Resample using linear interpolation
    // For production, use a higher-quality resampling algorithm
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(audioData.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      // Linear interpolation
      output[i] =
        audioData[srcIndexFloor] * (1 - fraction) + audioData[srcIndexCeil] * fraction;
    }

    return output;
  }

  /**
   * Convert stereo audio to mono by averaging channels
   */
  static stereoToMono(stereoData: Float32Array): Float32Array {
    const monoLength = stereoData.length / 2;
    const mono = new Float32Array(monoLength);

    for (let i = 0; i < monoLength; i++) {
      mono[i] = (stereoData[i * 2] + stereoData[i * 2 + 1]) / 2;
    }

    return mono;
  }

  /**
   * Normalize audio to prevent clipping
   */
  static normalizeAudio(audioData: Float32Array): Float32Array {
    let maxVal = 0;
    for (let i = 0; i < audioData.length; i++) {
      const absVal = Math.abs(audioData[i]);
      if (absVal > maxVal) maxVal = absVal;
    }

    if (maxVal === 0 || maxVal <= 1) {
      return audioData;
    }

    const normalized = new Float32Array(audioData.length);
    const scale = 1 / maxVal;

    for (let i = 0; i < audioData.length; i++) {
      normalized[i] = audioData[i] * scale;
    }

    return normalized;
  }

  /**
   * Simple Voice Activity Detection
   * Returns true if the audio chunk contains speech
   */
  static detectVoiceActivity(audioData: Float32Array, threshold: number = 0.01): boolean {
    // Calculate RMS energy
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      sumSquares += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSquares / audioData.length);

    return rms > threshold;
  }
}
