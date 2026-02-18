/**
 * Gladia Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Gladia's WebSocket API.
 * Alternative to Deepgram for testing and comparison purposes.
 */
import { SupportedLanguage } from '../shared/types';
import { TranscriptionService, TranscriptionCallbacks, TranscriptionDiagnostics } from './transcription-service';
export interface GladiaDiagnosticInfo extends TranscriptionDiagnostics {
    sessionId: string | null;
}
export declare class GladiaTranscription implements TranscriptionService {
    private ws;
    private apiKey;
    private language;
    private translationEnabled;
    private translationTargetLanguage;
    private callbacks;
    private isConnected;
    private sessionId;
    private diagnostics;
    private pendingTranslations;
    private translationStats;
    constructor(apiKey: string, language?: SupportedLanguage, translationEnabled?: boolean, translationTargetLanguage?: SupportedLanguage);
    setApiKey(apiKey: string): void;
    setLanguage(language: SupportedLanguage): void;
    /**
     * Get current diagnostic information
     */
    getDiagnostics(): GladiaDiagnosticInfo;
    /**
     * Start the WebSocket connection to Gladia
     */
    start(callbacks: TranscriptionCallbacks): Promise<void>;
    /**
     * Send audio data to Gladia
     * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
     */
    send(audioBuffer: Buffer): void;
    /**
     * Stop the WebSocket connection
     */
    stop(): Promise<void>;
    /**
     * Check if connected to Gladia
     */
    get connected(): boolean;
    private handleMessage;
    private mapLanguage;
    /**
     * Map SupportedLanguage to Gladia's language code for translation
     */
    private mapLanguageCode;
    /**
     * Process a translation and match it with pending transcript
     */
    private processTranslation;
    /**
     * Resample 24kHz audio to 16kHz using linear interpolation
     * Input: 16-bit PCM mono at 24kHz
     * Output: 16-bit PCM mono at 16kHz
     */
    private resample24kTo16k;
    private resetDiagnostics;
}
//# sourceMappingURL=gladia-transcription.d.ts.map