/**
 * Speechmatics Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Speechmatics' WebSocket API.
 * Known for high-quality diarization capabilities.
 */
import { SupportedLanguage } from '../shared/types';
import { TranscriptionService, TranscriptionCallbacks, TranscriptionDiagnostics } from './transcription-service';
export interface SpeechmaticsDiagnosticInfo extends TranscriptionDiagnostics {
    sessionId: string | null;
}
export declare class SpeechmaticsTranscription implements TranscriptionService {
    private ws;
    private apiKey;
    private language;
    private diarization;
    private callbacks;
    private isConnected;
    private isRecognitionStarted;
    private sessionId;
    private diagnostics;
    constructor(apiKey: string, language?: SupportedLanguage, diarization?: boolean);
    setApiKey(apiKey: string): void;
    setLanguage(language: SupportedLanguage): void;
    /**
     * Get current diagnostic information
     */
    getDiagnostics(): SpeechmaticsDiagnosticInfo;
    /**
     * Start the WebSocket connection to Speechmatics
     */
    start(callbacks: TranscriptionCallbacks): Promise<void>;
    private sendStartRecognition;
    /**
     * Send audio data to Speechmatics
     * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
     */
    send(audioBuffer: Buffer): void;
    /**
     * Stop the WebSocket connection
     */
    stop(): Promise<void>;
    /**
     * Check if connected to Speechmatics
     */
    get connected(): boolean;
    private handleMessage;
    private handleTranscript;
    private mapLanguage;
    /**
     * Resample 24kHz audio to 16kHz using linear interpolation
     * Input: 16-bit PCM mono at 24kHz
     * Output: 16-bit PCM mono at 16kHz
     */
    private resample24kTo16k;
    private resetDiagnostics;
}
//# sourceMappingURL=speechmatics-transcription.d.ts.map