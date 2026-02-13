/**
 * WhisperLive WebSocket Client
 *
 * Connects to a WhisperLive server for real-time speech-to-text transcription.
 * Protocol: WebSocket with binary audio (Float32, 16kHz, mono) and JSON responses.
 */
import { EventEmitter } from 'events';
export interface WhisperLiveConfig {
    host: string;
    port: number;
    language?: string;
    model?: string;
    useVad?: boolean;
    task?: 'transcribe' | 'translate';
}
export interface TranscriptionSegment {
    start: number;
    end: number;
    text: string;
    completed: boolean;
}
export declare class WhisperLiveClient extends EventEmitter {
    private ws;
    private config;
    private uid;
    private isConnected;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    constructor(config: WhisperLiveConfig);
    private generateUid;
    connect(): Promise<void>;
    private sendInitialConfig;
    private handleMessage;
    private handleReconnect;
    /**
     * Send audio data to the server as Float32
     * @param audioData Float32Array of audio samples (16kHz, mono)
     */
    sendAudio(audioData: Float32Array): void;
    /**
     * Send audio data as Int16 PCM bytes (recommended for non-Python clients)
     * @param audioData Int16Array of audio samples (16kHz, mono)
     */
    sendAudioInt16(audioData: Int16Array): void;
    /**
     * Signal end of audio stream
     */
    endStream(): void;
    /**
     * Disconnect from the server
     */
    disconnect(): void;
    /**
     * Check if connected to server
     */
    get connected(): boolean;
}
//# sourceMappingURL=whisper-live-client.d.ts.map