/**
 * Common interface for transcription services (Deepgram, Gladia, etc.)
 *
 * This abstraction allows switching between different transcription providers
 * while maintaining a consistent API for the main application.
 */

import { TranscriptionResult } from '../shared/types';

export interface TranscriptionCallbacks {
  onTranscript: (result: TranscriptionResult) => void;
  onError: (error: Error) => void;
  onOpen: () => void;
  onClose: () => void;
}

export interface TranscriptionDiagnostics {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError: string | null;
  audioChunksSent: number;
  audioBytesSent: number;
  transcriptsReceived: number;
  lastTranscriptTime: number | null;
}

export interface TranscriptionService {
  /**
   * Start the transcription service and connect to the provider
   */
  start(callbacks: TranscriptionCallbacks): Promise<void>;

  /**
   * Send audio data to the transcription service
   * @param audioBuffer - Raw PCM audio data (16-bit, 16kHz or 24kHz depending on provider, mono)
   */
  send(audioBuffer: Buffer): void;

  /**
   * Stop the transcription service and close the connection
   */
  stop(): Promise<void>;

  /**
   * Get current diagnostic information
   */
  getDiagnostics(): TranscriptionDiagnostics;

  /**
   * Check if connected to the transcription service
   */
  readonly connected: boolean;
}
