/**
 * Deepgram Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Deepgram's WebSocket API.
 * Replaces the batch-based OpenAI Whisper implementation with true streaming.
 */

import { createClient, LiveTranscriptionEvents, ListenLiveClient } from '@deepgram/sdk';
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

export class DeepgramTranscription {
  private connection: ListenLiveClient | null = null;
  private apiKey: string;
  private language: SupportedLanguage;
  private callbacks: DeepgramTranscriptionCallbacks | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  // Diagnostic tracking
  private diagnostics: DiagnosticInfo = {
    connectionState: 'disconnected',
    lastError: null,
    audioChunksSent: 0,
    audioBytesSent: 0,
    transcriptsReceived: 0,
    lastTranscriptTime: null,
    keepAlivesSent: 0,
  };

  constructor(apiKey: string, language: SupportedLanguage = 'auto') {
    this.apiKey = apiKey;
    this.language = language;
    console.log('[Deepgram] Service initialized with language:', language);
    console.log('[Deepgram] API key length:', apiKey?.length || 0);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setLanguage(language: SupportedLanguage): void {
    this.language = language;
  }

  /**
   * Get current diagnostic information
   */
  getDiagnostics(): DiagnosticInfo {
    return { ...this.diagnostics };
  }

  /**
   * Start the WebSocket connection to Deepgram
   */
  async start(callbacks: DeepgramTranscriptionCallbacks): Promise<void> {
    if (!this.apiKey) {
      const error = 'Deepgram API key not set';
      console.error('[Deepgram]', error);
      this.diagnostics.lastError = error;
      this.diagnostics.connectionState = 'error';
      throw new Error(error);
    }

    if (this.connection) {
      console.log('[Deepgram] Connection already exists, closing first');
      await this.stop();
    }

    this.callbacks = callbacks;
    this.diagnostics.connectionState = 'connecting';
    this.resetDiagnostics();

    console.log('[Deepgram] Creating client...');
    const deepgram = createClient(this.apiKey);

    // Map our language codes to Deepgram's format
    const languageCode = this.mapLanguage(this.language);

    console.log('[Deepgram] Starting connection with config:', {
      model: 'nova-3',
      language: languageCode,
      encoding: 'linear16',
      sample_rate: 16000,  // Match Deepgram example app (16kHz optimal)
      channels: 1,
    });

    try {
      this.connection = deepgram.listen.live({
        model: 'nova-3',
        language: languageCode,
        // Disabled for lower latency - these add processing overhead
        smart_format: false,
        punctuate: false,
        interim_results: true,
        // Aggressive endpointing for real-time subtitles
        endpointing: 100,
        vad_events: false,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Deepgram] Failed to create live connection:', errorMsg);
      this.diagnostics.lastError = errorMsg;
      this.diagnostics.connectionState = 'error';
      throw error;
    }

    return new Promise((resolve, reject) => {
      if (!this.connection) {
        const error = 'Failed to create connection object';
        console.error('[Deepgram]', error);
        this.diagnostics.lastError = error;
        this.diagnostics.connectionState = 'error';
        reject(new Error(error));
        return;
      }

      console.log('[Deepgram] Setting up event handlers...');

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('[Deepgram] ✓ WebSocket CONNECTED');
        this.isConnected = true;
        this.diagnostics.connectionState = 'connected';
        this.startKeepAlive();
        this.callbacks?.onOpen();
        resolve();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        console.log('[Deepgram] Received transcript event:', JSON.stringify(data, null, 2));
        this.diagnostics.transcriptsReceived++;
        this.diagnostics.lastTranscriptTime = Date.now();
        this.handleTranscript(data);
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (data) => {
        console.log('[Deepgram] Received metadata:', JSON.stringify(data, null, 2));
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        // Log full error details for debugging
        console.error('[Deepgram] ✗ ERROR - Full object:', error);
        console.error('[Deepgram] ✗ ERROR - Type:', typeof error);
        console.error('[Deepgram] ✗ ERROR - Keys:', error ? Object.keys(error) : 'null');
        if (error?.message) console.error('[Deepgram] ✗ ERROR - Message:', error.message);
        if (error?.code) console.error('[Deepgram] ✗ ERROR - Code:', error.code);
        if (error?.error) console.error('[Deepgram] ✗ ERROR - Inner error:', error.error);

        const errorMsg = error instanceof Error
          ? error.message
          : (error?.message || error?.error || JSON.stringify(error) || 'Unknown error');
        this.diagnostics.lastError = errorMsg;
        this.diagnostics.connectionState = 'error';
        this.callbacks?.onError(error instanceof Error ? error : new Error(errorMsg));
      });

      this.connection.on(LiveTranscriptionEvents.Close, (event: any) => {
        console.log('[Deepgram] WebSocket CLOSED');
        console.log('[Deepgram] Close event:', event);
        if (event?.code) console.log('[Deepgram] Close code:', event.code);
        if (event?.reason) console.log('[Deepgram] Close reason:', event.reason);
        this.isConnected = false;
        this.diagnostics.connectionState = 'disconnected';
        this.stopKeepAlive();
        this.callbacks?.onClose();
      });

      // Timeout for connection
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          const error = 'Connection timeout after 10 seconds';
          console.error('[Deepgram]', error);
          this.diagnostics.lastError = error;
          this.diagnostics.connectionState = 'error';
          reject(new Error(error));
          this.stop();
        }
      }, 10000);

      // Clear timeout on successful connection
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Send audio data to Deepgram
   * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
   */
  send(audioBuffer: Buffer): void {
    if (!this.connection) {
      console.warn('[Deepgram] Cannot send audio: no connection object');
      return;
    }

    if (!this.isConnected) {
      console.warn('[Deepgram] Cannot send audio: not connected (state:', this.diagnostics.connectionState, ')');
      return;
    }

    try {
      // Convert Buffer to ArrayBuffer for Deepgram SDK
      const arrayBuffer = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength
      );

      this.connection.send(arrayBuffer);

      this.diagnostics.audioChunksSent++;
      this.diagnostics.audioBytesSent += audioBuffer.byteLength;

      // Log every 50 chunks (roughly every 5 seconds at 100ms chunks)
      if (this.diagnostics.audioChunksSent % 50 === 0) {
        console.log(`[Deepgram] Audio stats: ${this.diagnostics.audioChunksSent} chunks, ${(this.diagnostics.audioBytesSent / 1024).toFixed(1)} KB sent`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Deepgram] Error sending audio:', errorMsg);
      this.diagnostics.lastError = errorMsg;
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    console.log('[Deepgram] Stopping connection...');
    this.stopKeepAlive();

    if (this.connection) {
      try {
        this.connection.requestClose();
        console.log('[Deepgram] Close requested');
      } catch (error) {
        console.error('[Deepgram] Error closing connection:', error);
      }
      this.connection = null;
    }

    this.isConnected = false;
    this.diagnostics.connectionState = 'disconnected';
    this.callbacks = null;

    console.log('[Deepgram] Final stats:', {
      audioChunksSent: this.diagnostics.audioChunksSent,
      audioBytesSent: this.diagnostics.audioBytesSent,
      transcriptsReceived: this.diagnostics.transcriptsReceived,
      keepAlivesSent: this.diagnostics.keepAlivesSent,
    });
  }

  /**
   * Check if connected to Deepgram
   */
  get connected(): boolean {
    return this.isConnected;
  }

  private handleTranscript(data: any): void {
    const channel = data.channel;
    const alternative = channel?.alternatives?.[0];

    if (!alternative) {
      console.log('[Deepgram] No alternatives in transcript data');
      return;
    }

    const transcript = alternative.transcript || '';
    const confidence = alternative.confidence || 1.0;
    const isFinal = data.is_final || false;
    const speechFinal = data.speech_final || false;

    // Log all transcripts, even empty ones for debugging
    console.log(`[Deepgram] Transcript: "${transcript}" (final: ${isFinal}, speech_final: ${speechFinal}, confidence: ${confidence.toFixed(2)})`);

    // Skip empty transcripts
    if (!transcript.trim()) {
      console.log('[Deepgram] Skipping empty transcript');
      return;
    }

    const result: TranscriptionResult = {
      text: transcript,
      timestamp: Date.now(),
      confidence,
      language: this.language === 'auto' ? undefined : this.language,
      isFinal,
      speechFinal,
    };

    console.log('[Deepgram] Sending transcript to overlay:', result.text);
    this.callbacks?.onTranscript(result);
  }

  private mapLanguage(language: SupportedLanguage): string {
    const languageMap: Record<SupportedLanguage, string> = {
      ja: 'ja',
      ko: 'ko',
      zh: 'zh',
      es: 'es',
      fr: 'fr',
      de: 'de',
      en: 'en',
      auto: 'en',
    };

    return languageMap[language] || 'en';
  }

  private startKeepAlive(): void {
    console.log('[Deepgram] Starting keepalive interval');
    this.keepAliveInterval = setInterval(() => {
      if (this.connection && this.isConnected) {
        try {
          this.connection.keepAlive();
          this.diagnostics.keepAlivesSent++;
          console.log('[Deepgram] KeepAlive sent (#' + this.diagnostics.keepAlivesSent + ')');
        } catch (error) {
          console.error('[Deepgram] KeepAlive error:', error);
        }
      }
    }, 8000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('[Deepgram] Stopped keepalive interval');
    }
  }

  private resetDiagnostics(): void {
    this.diagnostics = {
      connectionState: 'connecting',
      lastError: null,
      audioChunksSent: 0,
      audioBytesSent: 0,
      transcriptsReceived: 0,
      lastTranscriptTime: null,
      keepAlivesSent: 0,
    };
  }
}
