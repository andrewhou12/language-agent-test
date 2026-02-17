/**
 * Gladia Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Gladia's WebSocket API.
 * Alternative to Deepgram for testing and comparison purposes.
 */

import WebSocket from 'ws';
import { SupportedLanguage, TranscriptionResult } from '../shared/types';
import { TranscriptionService, TranscriptionCallbacks, TranscriptionDiagnostics } from './transcription-service';

export interface GladiaDiagnosticInfo extends TranscriptionDiagnostics {
  sessionId: string | null;
}

export class GladiaTranscription implements TranscriptionService {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: SupportedLanguage;
  private callbacks: TranscriptionCallbacks | null = null;
  private isConnected: boolean = false;
  private sessionId: string | null = null;

  // Diagnostic tracking
  private diagnostics: GladiaDiagnosticInfo = {
    connectionState: 'disconnected',
    lastError: null,
    audioChunksSent: 0,
    audioBytesSent: 0,
    transcriptsReceived: 0,
    lastTranscriptTime: null,
    sessionId: null,
  };

  constructor(apiKey: string, language: SupportedLanguage = 'auto') {
    this.apiKey = apiKey;
    this.language = language;
    console.log('[Gladia] Service initialized with language:', language);
    console.log('[Gladia] API key length:', apiKey?.length || 0);
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
  getDiagnostics(): GladiaDiagnosticInfo {
    return { ...this.diagnostics };
  }

  /**
   * Start the WebSocket connection to Gladia
   */
  async start(callbacks: TranscriptionCallbacks): Promise<void> {
    if (!this.apiKey) {
      const error = 'Gladia API key not set';
      console.error('[Gladia]', error);
      this.diagnostics.lastError = error;
      this.diagnostics.connectionState = 'error';
      throw new Error(error);
    }

    if (this.ws) {
      console.log('[Gladia] Connection already exists, closing first');
      await this.stop();
    }

    this.callbacks = callbacks;
    this.diagnostics.connectionState = 'connecting';
    this.resetDiagnostics();

    // Map language to Gladia format
    const languages = this.mapLanguage(this.language);

    // Gladia only supports: 8000, 16000, 32000, 44100, 48000
    // We receive 24kHz audio and resample to 16kHz
    console.log('[Gladia] Initializing session with config:', {
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      languages,
    });

    try {
      // Step 1: POST to get WebSocket URL
      const initResponse = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: {
          'x-gladia-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          encoding: 'wav/pcm',
          sample_rate: 16000,
          bit_depth: 16,
          channels: 1,
          language_config: {
            languages: languages,
            code_switching: this.language === 'auto',
          },
          messages_config: {
            receive_partial_transcripts: true,
          },
        }),
      });

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        throw new Error(`Gladia API error: ${initResponse.status} - ${errorText}`);
      }

      const { id, url } = await initResponse.json();
      this.sessionId = id;
      this.diagnostics.sessionId = id;
      console.log('[Gladia] Session initialized, ID:', id);
      console.log('[Gladia] WebSocket URL:', url);

      // Step 2: Connect to WebSocket
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          console.log('[Gladia] ✓ WebSocket CONNECTED');
          this.isConnected = true;
          this.diagnostics.connectionState = 'connected';
          this.callbacks?.onOpen();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error('[Gladia] Failed to parse message:', error);
          }
        });

        this.ws.on('error', (error: Error) => {
          console.error('[Gladia] ✗ WebSocket ERROR:', error.message);
          this.diagnostics.lastError = error.message;
          this.diagnostics.connectionState = 'error';
          this.callbacks?.onError(error);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          console.log('[Gladia] WebSocket CLOSED, code:', code, 'reason:', reason.toString());
          this.isConnected = false;
          this.diagnostics.connectionState = 'disconnected';
          this.callbacks?.onClose();
        });

        // Timeout for connection
        const timeout = setTimeout(() => {
          if (!this.isConnected) {
            const error = 'Connection timeout after 10 seconds';
            console.error('[Gladia]', error);
            this.diagnostics.lastError = error;
            this.diagnostics.connectionState = 'error';
            reject(new Error(error));
            this.stop();
          }
        }, 10000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Gladia] Failed to initialize session:', errorMsg);
      this.diagnostics.lastError = errorMsg;
      this.diagnostics.connectionState = 'error';
      throw error;
    }
  }

  /**
   * Send audio data to Gladia
   * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
   */
  send(audioBuffer: Buffer): void {
    if (!this.ws) {
      console.warn('[Gladia] Cannot send audio: no WebSocket connection');
      return;
    }

    if (!this.isConnected) {
      console.warn('[Gladia] Cannot send audio: not connected (state:', this.diagnostics.connectionState, ')');
      return;
    }

    try {
      // Resample from 24kHz to 16kHz (ratio 2:3)
      const resampledBuffer = this.resample24kTo16k(audioBuffer);

      // Send as binary data
      this.ws.send(resampledBuffer);

      this.diagnostics.audioChunksSent++;
      this.diagnostics.audioBytesSent += resampledBuffer.byteLength;

      // Log every 50 chunks
      if (this.diagnostics.audioChunksSent % 50 === 0) {
        console.log(`[Gladia] Audio stats: ${this.diagnostics.audioChunksSent} chunks, ${(this.diagnostics.audioBytesSent / 1024).toFixed(1)} KB sent`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Gladia] Error sending audio:', errorMsg);
      this.diagnostics.lastError = errorMsg;
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    console.log('[Gladia] Stopping connection...');

    if (this.ws) {
      try {
        // Send stop_recording message
        if (this.isConnected) {
          this.ws.send(JSON.stringify({ type: 'stop_recording' }));
          console.log('[Gladia] Stop recording signal sent');
        }

        // Close with normal closure code
        this.ws.close(1000, 'Session ended');
        console.log('[Gladia] WebSocket close requested');
      } catch (error) {
        console.error('[Gladia] Error closing connection:', error);
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.diagnostics.connectionState = 'disconnected';
    this.callbacks = null;

    console.log('[Gladia] Final stats:', {
      sessionId: this.sessionId,
      audioChunksSent: this.diagnostics.audioChunksSent,
      audioBytesSent: this.diagnostics.audioBytesSent,
      transcriptsReceived: this.diagnostics.transcriptsReceived,
    });
  }

  /**
   * Check if connected to Gladia
   */
  get connected(): boolean {
    return this.isConnected;
  }

  private handleMessage(message: any): void {
    const type = message.type;

    if (type === 'transcript') {
      this.diagnostics.transcriptsReceived++;
      this.diagnostics.lastTranscriptTime = Date.now();

      const data = message.data;
      const isFinal = data?.is_final || false;
      const utterance = data?.utterance;
      const text = utterance?.text || '';
      const language = utterance?.language;

      console.log(`[Gladia] Transcript: "${text}" (final: ${isFinal})`);

      // Skip empty transcripts
      if (!text.trim()) {
        console.log('[Gladia] Skipping empty transcript');
        return;
      }

      const result: TranscriptionResult = {
        text,
        timestamp: Date.now(),
        confidence: 1.0, // Gladia doesn't provide confidence in the same way
        language: language || (this.language === 'auto' ? undefined : this.language),
        isFinal,
        speechFinal: isFinal, // Gladia uses is_final for both
      };

      console.log('[Gladia] Sending transcript to overlay:', result.text);
      this.callbacks?.onTranscript(result);
    } else if (type === 'error') {
      const errorMsg = message.data?.message || message.message || 'Unknown error';
      console.error('[Gladia] Error message received:', errorMsg);
      this.diagnostics.lastError = errorMsg;
      this.callbacks?.onError(new Error(errorMsg));
    } else if (type === 'connected') {
      console.log('[Gladia] Connected message received');
    } else {
      console.log('[Gladia] Unknown message type:', type, message);
    }
  }

  private mapLanguage(language: SupportedLanguage): string[] {
    // Gladia uses language arrays
    const languageMap: Record<SupportedLanguage, string[]> = {
      ja: ['ja'],
      ko: ['ko'],
      zh: ['zh'],
      es: ['es'],
      fr: ['fr'],
      de: ['de'],
      en: ['en'],
      auto: ['en', 'ja', 'ko', 'zh', 'es', 'fr', 'de'], // Multi-language support
    };

    return languageMap[language] || ['en'];
  }

  /**
   * Resample 24kHz audio to 16kHz using linear interpolation
   * Input: 16-bit PCM mono at 24kHz
   * Output: 16-bit PCM mono at 16kHz
   */
  private resample24kTo16k(input: Buffer): Buffer {
    // 24kHz to 16kHz is a 3:2 ratio (every 3 input samples become 2 output samples)
    const inputSamples = input.length / 2; // 16-bit = 2 bytes per sample
    const outputSamples = Math.floor(inputSamples * 16000 / 24000);
    const output = Buffer.alloc(outputSamples * 2);

    const ratio = 24000 / 16000; // 1.5

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
      const fraction = srcIndex - srcIndexFloor;

      // Read input samples (16-bit signed little-endian)
      const sample1 = input.readInt16LE(srcIndexFloor * 2);
      const sample2 = input.readInt16LE(srcIndexCeil * 2);

      // Linear interpolation
      const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);

      // Write output sample
      output.writeInt16LE(interpolated, i * 2);
    }

    return output;
  }

  private resetDiagnostics(): void {
    this.diagnostics = {
      connectionState: 'connecting',
      lastError: null,
      audioChunksSent: 0,
      audioBytesSent: 0,
      transcriptsReceived: 0,
      lastTranscriptTime: null,
      sessionId: this.sessionId,
    };
  }
}
