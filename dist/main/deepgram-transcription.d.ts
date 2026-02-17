/**
 * Deepgram Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Deepgram's WebSocket API.
 * Replaces the batch-based OpenAI Whisper implementation with true streaming.
 */
import { SupportedLanguage, TranscriptionResult } from '../shared/types';
export interface DeepgramTranscriptionCallbacks {
    onTranscript: (result: TranscriptionResult) => void;
    onError: (error: Error) => void;
    onOpen: () => void;
    onClose: () => void;
}
export interface DiagnosticInfo {
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError: string | null;
    audioChunksSent: number;
    audioBytesSent: number;
    transcriptsReceived: number;
    lastTranscriptTime: number | null;
    keepAlivesSent: number;
}
export declare class DeepgramTranscription {
    private connection;
    private apiKey;
    private language;
    private callbacks;
    private keepAliveInterval;
    private isConnected;
    private diagnostics;
    constructor(apiKey: string, language?: SupportedLanguage);
    setApiKey(apiKey: string): void;
    setLanguage(language: SupportedLanguage): void;
    /**
     * Get current diagnostic information
     */
    getDiagnostics(): DiagnosticInfo;
    /**
     * Start the WebSocket connection to Deepgram
     */
    start(callbacks: DeepgramTranscriptionCallbacks): Promise<void>;
    /**
     * Send audio data to Deepgram
     * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
     */
    send(audioBuffer: Buffer): void;
    /**
     * Stop the WebSocket connection
     */
    stop(): Promise<void>;
    /**
     * Check if connected to Deepgram
     */
    get connected(): boolean;
    private handleTranscript;
    private mapLanguage;
    private startKeepAlive;
    private stopKeepAlive;
    private resetDiagnostics;
}
//# sourceMappingURL=deepgram-transcription.d.ts.map