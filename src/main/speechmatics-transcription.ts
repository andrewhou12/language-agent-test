/**
 * Speechmatics Live Streaming Transcription Service
 *
 * Handles real-time audio transcription using Speechmatics' WebSocket API.
 * Known for high-quality diarization capabilities.
 */

import WebSocket from 'ws';
import { SupportedLanguage, TranscriptionResult } from '../shared/types';
import { TranscriptionService, TranscriptionCallbacks, TranscriptionDiagnostics } from './transcription-service';

export interface SpeechmaticsDiagnosticInfo extends TranscriptionDiagnostics {
  sessionId: string | null;
}

// Speechmatics WebSocket endpoint
const SPEECHMATICS_WS_URL = 'wss://eu2.rt.speechmatics.com/v2';

export class SpeechmaticsTranscription implements TranscriptionService {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: SupportedLanguage;
  private diarization: boolean;
  private callbacks: TranscriptionCallbacks | null = null;
  private isConnected: boolean = false;
  private isRecognitionStarted: boolean = false;
  private sessionId: string | null = null;

  // Diagnostic tracking
  private diagnostics: SpeechmaticsDiagnosticInfo = {
    connectionState: 'disconnected',
    lastError: null,
    audioChunksSent: 0,
    audioBytesSent: 0,
    transcriptsReceived: 0,
    lastTranscriptTime: null,
    sessionId: null,
  };

  constructor(apiKey: string, language: SupportedLanguage = 'auto', diarization: boolean = false) {
    this.apiKey = apiKey;
    this.language = language;
    this.diarization = diarization;
    console.log('[Speechmatics] Service initialized with language:', language, 'diarization:', diarization);
    console.log('[Speechmatics] API key length:', apiKey?.length || 0);
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
  getDiagnostics(): SpeechmaticsDiagnosticInfo {
    return { ...this.diagnostics };
  }

  /**
   * Start the WebSocket connection to Speechmatics
   */
  async start(callbacks: TranscriptionCallbacks): Promise<void> {
    if (!this.apiKey) {
      const error = 'Speechmatics API key not set';
      console.error('[Speechmatics]', error);
      this.diagnostics.lastError = error;
      this.diagnostics.connectionState = 'error';
      throw new Error(error);
    }

    if (this.ws) {
      console.log('[Speechmatics] Connection already exists, closing first');
      await this.stop();
    }

    this.callbacks = callbacks;
    this.diagnostics.connectionState = 'connecting';
    this.resetDiagnostics();

    const languageCode = this.mapLanguage(this.language);

    console.log('[Speechmatics] Connecting to WebSocket with config:', {
      language: languageCode,
      diarization: this.diarization ? 'speaker' : 'none',
      sample_rate: 16000,
      encoding: 'pcm_s16le',
    });

    return new Promise((resolve, reject) => {
      // Connect with Authorization header
      this.ws = new WebSocket(SPEECHMATICS_WS_URL, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      this.ws.on('open', () => {
        console.log('[Speechmatics] ✓ WebSocket CONNECTED');
        this.isConnected = true;
        this.diagnostics.connectionState = 'connected';

        // Send StartRecognition message
        this.sendStartRecognition(languageCode);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message, resolve, reject);
        } catch (error) {
          console.error('[Speechmatics] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('[Speechmatics] ✗ WebSocket ERROR:', error.message);
        this.diagnostics.lastError = error.message;
        this.diagnostics.connectionState = 'error';
        this.callbacks?.onError(error);
        if (!this.isRecognitionStarted) {
          reject(error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log('[Speechmatics] WebSocket CLOSED, code:', code, 'reason:', reason.toString());
        this.isConnected = false;
        this.isRecognitionStarted = false;
        this.diagnostics.connectionState = 'disconnected';
        this.callbacks?.onClose();
      });

      // Timeout for connection
      const timeout = setTimeout(() => {
        if (!this.isRecognitionStarted) {
          const error = 'Connection timeout after 15 seconds';
          console.error('[Speechmatics]', error);
          this.diagnostics.lastError = error;
          this.diagnostics.connectionState = 'error';
          reject(new Error(error));
          this.stop();
        }
      }, 15000);

      // Store timeout to clear it later
      (this as any)._connectionTimeout = timeout;
    });
  }

  private sendStartRecognition(languageCode: string): void {
    if (!this.ws) return;

    const startMessage: any = {
      message: 'StartRecognition',
      transcription_config: {
        language: languageCode,
        operating_point: 'enhanced',
        enable_partials: true,
        max_delay: 2,
      },
      audio_format: {
        type: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 16000,
      },
    };

    // Add diarization config if enabled
    if (this.diarization) {
      startMessage.transcription_config.diarization = 'speaker';
      startMessage.transcription_config.speaker_diarization_config = {
        max_speakers: 10,
      };
    }

    console.log('[Speechmatics] Sending StartRecognition:', JSON.stringify(startMessage, null, 2));
    this.ws.send(JSON.stringify(startMessage));
  }

  /**
   * Send audio data to Speechmatics
   * @param audioBuffer - Raw PCM audio data (16-bit, 24kHz, mono)
   */
  send(audioBuffer: Buffer): void {
    if (!this.ws) {
      console.warn('[Speechmatics] Cannot send audio: no WebSocket connection');
      return;
    }

    if (!this.isConnected || !this.isRecognitionStarted) {
      console.warn('[Speechmatics] Cannot send audio: not ready (connected:', this.isConnected, ', recognition started:', this.isRecognitionStarted, ')');
      return;
    }

    try {
      // Resample from 24kHz to 16kHz
      const resampledBuffer = this.resample24kTo16k(audioBuffer);

      // Send as binary data (AddAudio is implicit for binary messages)
      this.ws.send(resampledBuffer);

      this.diagnostics.audioChunksSent++;
      this.diagnostics.audioBytesSent += resampledBuffer.byteLength;

      // Log every 50 chunks
      if (this.diagnostics.audioChunksSent % 50 === 0) {
        console.log(`[Speechmatics] Audio stats: ${this.diagnostics.audioChunksSent} chunks, ${(this.diagnostics.audioBytesSent / 1024).toFixed(1)} KB sent`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Speechmatics] Error sending audio:', errorMsg);
      this.diagnostics.lastError = errorMsg;
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    console.log('[Speechmatics] Stopping connection...');

    if (this.ws) {
      try {
        // Send EndOfStream message
        if (this.isConnected && this.isRecognitionStarted) {
          this.ws.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.diagnostics.audioChunksSent }));
          console.log('[Speechmatics] EndOfStream sent');
        }

        // Close with normal closure code
        this.ws.close(1000, 'Session ended');
        console.log('[Speechmatics] WebSocket close requested');
      } catch (error) {
        console.error('[Speechmatics] Error closing connection:', error);
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.isRecognitionStarted = false;
    this.diagnostics.connectionState = 'disconnected';
    this.callbacks = null;

    console.log('[Speechmatics] Final stats:', {
      sessionId: this.sessionId,
      audioChunksSent: this.diagnostics.audioChunksSent,
      audioBytesSent: this.diagnostics.audioBytesSent,
      transcriptsReceived: this.diagnostics.transcriptsReceived,
    });
  }

  /**
   * Check if connected to Speechmatics
   */
  get connected(): boolean {
    return this.isConnected && this.isRecognitionStarted;
  }

  private handleMessage(message: any, resolveStart?: (value: void) => void, rejectStart?: (reason: Error) => void): void {
    const messageType = message.message;

    switch (messageType) {
      case 'RecognitionStarted':
        console.log('[Speechmatics] Recognition started, session ID:', message.id);
        this.sessionId = message.id;
        this.diagnostics.sessionId = message.id;
        this.isRecognitionStarted = true;

        // Clear connection timeout
        if ((this as any)._connectionTimeout) {
          clearTimeout((this as any)._connectionTimeout);
        }

        this.callbacks?.onOpen();
        if (resolveStart) resolveStart();
        break;

      case 'AddPartialTranscript':
        this.handleTranscript(message, false);
        break;

      case 'AddTranscript':
        this.handleTranscript(message, true);
        break;

      case 'EndOfTranscript':
        console.log('[Speechmatics] End of transcript received');
        break;

      case 'AudioAdded':
        // Acknowledgment of audio receipt - can ignore
        break;

      case 'Info':
        console.log('[Speechmatics] Info:', message.reason, message.message);
        break;

      case 'Warning':
        console.warn('[Speechmatics] Warning:', message.reason, message.message);
        break;

      case 'Error':
        const errorMsg = message.reason || message.message || 'Unknown error';
        console.error('[Speechmatics] Error:', errorMsg);
        this.diagnostics.lastError = errorMsg;
        this.callbacks?.onError(new Error(errorMsg));
        if (rejectStart && !this.isRecognitionStarted) {
          rejectStart(new Error(errorMsg));
        }
        break;

      default:
        console.log('[Speechmatics] Unknown message type:', messageType, message);
    }
  }

  private handleTranscript(message: any, isFinal: boolean): void {
    this.diagnostics.transcriptsReceived++;
    this.diagnostics.lastTranscriptTime = Date.now();

    const metadata = message.metadata;
    const results = message.results || [];

    // Build transcript text from results
    let text = '';
    let speaker: number | undefined = undefined;

    // Track speaker occurrences for this segment
    const speakerCounts = new Map<string, number>();

    for (const result of results) {
      if (result.alternatives && result.alternatives.length > 0) {
        const alt = result.alternatives[0];
        text += alt.content;

        // Track speaker from each word/result
        if (alt.speaker && this.diarization) {
          speakerCounts.set(alt.speaker, (speakerCounts.get(alt.speaker) || 0) + 1);
        }
      }

      // Add space between words (Speechmatics doesn't include spaces in content)
      if (result.type === 'word') {
        text += ' ';
      }
    }

    // Determine dominant speaker
    if (speakerCounts.size > 0) {
      let maxCount = 0;
      let dominantSpeaker = '';
      for (const [spk, count] of speakerCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantSpeaker = spk;
        }
      }

      // Convert speaker label (S1, S2, etc.) to number
      if (dominantSpeaker.startsWith('S')) {
        speaker = parseInt(dominantSpeaker.substring(1), 10) - 1; // S1 -> 0, S2 -> 1, etc.
      }

      console.log(`[Speechmatics] Diarization: detected speaker ${dominantSpeaker} (${speakerCounts.size} unique speaker(s), counts: ${JSON.stringify([...speakerCounts])})`);
    }

    text = text.trim();

    console.log(`[Speechmatics] Transcript: "${text}" (final: ${isFinal}, speaker: ${speaker ?? 'N/A'})`);

    // Skip empty transcripts
    if (!text) {
      console.log('[Speechmatics] Skipping empty transcript');
      return;
    }

    const result: TranscriptionResult = {
      text,
      timestamp: Date.now(),
      confidence: 1.0, // Speechmatics provides per-word confidence but we simplify here
      language: this.language === 'auto' ? undefined : this.language,
      isFinal,
      speechFinal: isFinal,
      speaker,
    };

    console.log('[Speechmatics] Sending transcript to overlay:', result.text);
    this.callbacks?.onTranscript(result);
  }

  private mapLanguage(language: SupportedLanguage): string {
    // Speechmatics uses standard language codes
    const languageMap: Record<SupportedLanguage, string> = {
      ja: 'ja',
      ko: 'ko',
      zh: 'cmn', // Speechmatics uses 'cmn' for Mandarin Chinese
      es: 'es',
      fr: 'fr',
      de: 'de',
      en: 'en',
      auto: 'en', // Default to English for auto
    };

    return languageMap[language] || 'en';
  }

  /**
   * Resample 24kHz audio to 16kHz using linear interpolation
   * Input: 16-bit PCM mono at 24kHz
   * Output: 16-bit PCM mono at 16kHz
   */
  private resample24kTo16k(input: Buffer): Buffer {
    const inputSamples = input.length / 2;
    const outputSamples = Math.floor(inputSamples * 16000 / 24000);
    const output = Buffer.alloc(outputSamples * 2);

    const ratio = 24000 / 16000; // 1.5

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
      const fraction = srcIndex - srcIndexFloor;

      const sample1 = input.readInt16LE(srcIndexFloor * 2);
      const sample2 = input.readInt16LE(srcIndexCeil * 2);

      const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);
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
