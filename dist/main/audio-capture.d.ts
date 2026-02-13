/**
 * Audio Capture Module
 *
 * Handles system audio capture with platform-specific implementations.
 * Provides a unified interface for capturing system audio output.
 */
export interface AudioCaptureOptions {
    chunkSize: number;
    sampleRate?: number;
    onAudioChunk: (audioData: Float32Array) => void;
}
export declare class AudioCapture {
    private options;
    private isCapturing;
    private audioBuffer;
    private bufferDuration;
    private captureInterval;
    private mockAudioInterval;
    constructor(options: AudioCaptureOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    private initMacOSCapture;
    private initWindowsCapture;
    private initLinuxCapture;
    private startMockCapture;
    private cleanup;
    /**
     * Convert audio buffer to the format required by Whisper
     * - Mono channel
     * - 16kHz sample rate
     * - Float32 normalized to [-1, 1]
     */
    static preprocessAudio(audioData: Float32Array, inputSampleRate: number, outputSampleRate?: number): Float32Array;
    /**
     * Convert stereo audio to mono by averaging channels
     */
    static stereoToMono(stereoData: Float32Array): Float32Array;
    /**
     * Normalize audio to prevent clipping
     */
    static normalizeAudio(audioData: Float32Array): Float32Array;
    /**
     * Simple Voice Activity Detection
     * Returns true if the audio chunk contains speech
     */
    static detectVoiceActivity(audioData: Float32Array, threshold?: number): boolean;
}
//# sourceMappingURL=audio-capture.d.ts.map