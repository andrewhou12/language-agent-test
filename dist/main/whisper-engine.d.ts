/**
 * Whisper Engine Module
 *
 * Handles speech-to-text transcription using OpenAI Whisper model.
 * Uses whisper.cpp via Node.js bindings for local inference.
 */
import { TranscriptionResult, WhisperModel, SupportedLanguage } from '../shared/types';
export interface WhisperEngineOptions {
    model: WhisperModel;
    language: SupportedLanguage;
    useGpu: boolean;
}
export declare class WhisperEngine {
    private options;
    private isInitialized;
    private modelPath;
    constructor(options: WhisperEngineOptions);
    initialize(): Promise<void>;
    private simulateModelLoading;
    transcribe(audioData: Float32Array): Promise<TranscriptionResult | null>;
    private hasVoiceActivity;
    private mockTranscribe;
    cleanup(): Promise<void>;
    /**
     * Download Whisper model if not present
     */
    static downloadModel(model: WhisperModel, progressCallback?: (progress: number) => void): Promise<string>;
    /**
     * Check GPU availability for Whisper inference
     */
    static checkGpuAvailability(): {
        available: boolean;
        type: 'cuda' | 'metal' | 'none';
        deviceName?: string;
    };
}
//# sourceMappingURL=whisper-engine.d.ts.map