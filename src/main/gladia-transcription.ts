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
  private translationEnabled: boolean;
  private translationTargetLanguage: SupportedLanguage;
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

  // Store pending transcripts waiting for translation
  private pendingTranslations: Map<string, TranscriptionResult> = new Map();

  // Translation tracking for summary
  private translationStats = {
    messagesReceived: 0,
    translationsMatched: 0,
    translationsTimedOut: 0,
    lastTranslationText: '',
  };

  constructor(
    apiKey: string,
    language: SupportedLanguage = 'auto',
    translationEnabled: boolean = false,
    translationTargetLanguage: SupportedLanguage = 'en'
  ) {
    this.apiKey = apiKey;
    this.language = language;
    this.translationEnabled = translationEnabled;
    this.translationTargetLanguage = translationTargetLanguage;
    console.log('[Gladia] Service initialized with language:', language, 'translation:', translationEnabled ? translationTargetLanguage : 'disabled');
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
      translation: this.translationEnabled ? this.translationTargetLanguage : 'disabled',
    });

    try {
      // Build request body
      const requestBody: any = {
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
      };

      // Add translation config if enabled
      if (this.translationEnabled) {
        const targetLang = this.mapLanguageCode(this.translationTargetLanguage);
        requestBody.realtime_processing = {
          translation: true,
          translation_config: {
            target_languages: [targetLang],
            model: 'base',  // Use base for lower latency
            match_original_utterances: true,
          },
        };
        // Must enable these to receive translation events
        requestBody.messages_config.receive_realtime_processing_events = true;
        requestBody.messages_config.receive_final_transcripts = true;
        console.log('[Gladia] Translation enabled, target:', targetLang);
      }

      console.log('[Gladia] Request body:', JSON.stringify(requestBody, null, 2));

      // Step 1: POST to get WebSocket URL
      const initResponse = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: {
          'x-gladia-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        throw new Error(`Gladia API error: ${initResponse.status} - ${errorText}`);
      }

      const initData = await initResponse.json();
      console.log('[Gladia] Init response:', JSON.stringify(initData, null, 2));
      const { id, url } = initData;
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
    this.pendingTranslations.clear();

    // Print comprehensive summary
    console.log('\n========================================');
    console.log('[Gladia] SESSION SUMMARY');
    console.log('========================================');
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Language: ${this.language}`);
    console.log(`Translation enabled: ${this.translationEnabled}`);
    if (this.translationEnabled) {
      console.log(`Translation target: ${this.translationTargetLanguage}`);
    }
    console.log('----------------------------------------');
    console.log('AUDIO STATS:');
    console.log(`  Chunks sent: ${this.diagnostics.audioChunksSent}`);
    console.log(`  Bytes sent: ${(this.diagnostics.audioBytesSent / 1024).toFixed(1)} KB`);
    console.log('----------------------------------------');
    console.log('TRANSCRIPTION STATS:');
    console.log(`  Transcripts received: ${this.diagnostics.transcriptsReceived}`);
    console.log('----------------------------------------');
    console.log('TRANSLATION STATS:');
    console.log(`  Translation messages received: ${this.translationStats.messagesReceived}`);
    console.log(`  Translations matched: ${this.translationStats.translationsMatched}`);
    console.log(`  Translations timed out: ${this.translationStats.translationsTimedOut}`);
    if (this.translationStats.lastTranslationText) {
      console.log(`  Last translation: "${this.translationStats.lastTranslationText.substring(0, 80)}..."`);
    }
    console.log('----------------------------------------');
    if (this.translationEnabled && this.translationStats.messagesReceived === 0) {
      console.log('⚠️  WARNING: Translation was enabled but NO translation messages were received!');
      console.log('    Possible causes:');
      console.log('    - Translation not properly configured in request');
      console.log('    - receive_realtime_processing_events not set to true');
      console.log('    - API key may not have translation access');
    }
    if (this.translationStats.messagesReceived > 0 && this.translationStats.translationsMatched === 0) {
      console.log('⚠️  WARNING: Translation messages received but NONE matched transcripts!');
      console.log('    Possible causes:');
      console.log('    - Utterance ID mismatch between transcript and translation');
      console.log('    - Target language not found in translation results');
    }
    console.log('========================================\n');
  }

  /**
   * Check if connected to Gladia
   */
  get connected(): boolean {
    return this.isConnected;
  }

  private handleMessage(message: any): void {
    const type = message.type;

    // Log all non-audio_chunk messages to see what's coming
    if (type !== 'audio_chunk') {
      console.log(`[Gladia] Message type "${type}":`, JSON.stringify(message, null, 2));
    }

    if (type === 'transcript') {
      this.diagnostics.transcriptsReceived++;
      this.diagnostics.lastTranscriptTime = Date.now();

      const data = message.data;
      const isFinal = data?.is_final || false;
      const utterance = data?.utterance;
      const text = utterance?.text || '';
      const language = utterance?.language;

      // Get transcript ID - try multiple fields and extract numeric part
      const rawId = data?.id || data?.utterance_id || utterance?.id;
      // Extract just the numeric part if ID is like "00_00000001" and convert to integer string
      // This normalizes "00_00000001" -> "1" to match translation's utterance_id
      const numericPart = rawId ? String(rawId).replace(/^.*_/, '') : String(this.diagnostics.transcriptsReceived);
      const transcriptId = String(parseInt(numericPart, 10)); // "00000001" -> "1"

      console.log(`[Gladia] Transcript: "${text}" (final: ${isFinal}, rawId: ${rawId}, parsedId: ${transcriptId})`);

      // Skip empty transcripts
      if (!text.trim()) {
        console.log('[Gladia] Skipping empty transcript');
        return;
      }

      const result: TranscriptionResult = {
        text,
        timestamp: Date.now(),
        confidence: 1.0,
        language: language || (this.language === 'auto' ? undefined : this.language),
        isFinal,
        speechFinal: isFinal,
      };

      // If translation is enabled and this is a final transcript, wait briefly for translation
      if (this.translationEnabled && isFinal && transcriptId) {
        // Store the transcript for matching with translation
        this.pendingTranslations.set(transcriptId, result);
        console.log(`[Gladia] Stored transcript "${transcriptId}" waiting for translation. Pending: [${Array.from(this.pendingTranslations.keys()).join(', ')}]`);

        // Set a timeout to send the transcript even if translation doesn't arrive
        setTimeout(() => {
          const pending = this.pendingTranslations.get(transcriptId);
          if (pending) {
            console.log(`[Gladia] Timeout: sending transcript ${transcriptId} without translation`);
            this.pendingTranslations.delete(transcriptId);
            this.translationStats.translationsTimedOut++;
            this.callbacks?.onTranscript(pending);
          }
        }, 2000); // 2 second timeout for translation
      } else {
        // Send immediately for non-final or when translation is disabled
        console.log('[Gladia] Sending transcript to overlay:', result.text);
        this.callbacks?.onTranscript(result);
      }

    } else if (type === 'translation') {
      // Handle translation messages - these come separately from transcripts
      this.translationStats.messagesReceived++;
      const data = message.data;
      console.log(`[Gladia] TRANSLATION MESSAGE RECEIVED (#${this.translationStats.messagesReceived})`);

      const rawUtteranceId = data?.utterance_id;
      const utteranceId = rawUtteranceId ? String(rawUtteranceId) : null;
      const expectedTargetLang = this.mapLanguageCode(this.translationTargetLanguage);

      // Gladia structure: translated_utterance contains the translation
      // {
      //   utterance_id: "3",
      //   utterance: { text: "原文", language: "ja" },
      //   translated_utterance: { text: "Translation", language: "en" }
      // }
      const translatedUtterance = data?.translated_utterance;
      const translatedText = translatedUtterance?.text;
      const translatedLang = translatedUtterance?.language || data?.target_language;

      console.log(`[Gladia] utteranceId=${utteranceId}, targetLang=${translatedLang}, expected=${expectedTargetLang}`);
      console.log(`[Gladia] Translation text: "${translatedText}"`);

      if (!translatedText) {
        console.log(`[Gladia] No translated_utterance.text found in message`);
        return;
      }

      if (translatedLang !== expectedTargetLang) {
        console.log(`[Gladia] Language mismatch: got ${translatedLang}, expected ${expectedTargetLang}`);
        return;
      }

      this.processTranslation(utteranceId, translatedText);

    } else if (type === 'error') {
      const errorMsg = message.data?.message || message.message || 'Unknown error';
      console.error('[Gladia] Error message received:', errorMsg);
      this.diagnostics.lastError = errorMsg;
      this.callbacks?.onError(new Error(errorMsg));
    } else if (type === 'connected') {
      console.log('[Gladia] Connected message received');
    } else {
      console.log('[Gladia] Other message type:', type, JSON.stringify(message, null, 2));
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
   * Map SupportedLanguage to Gladia's language code for translation
   */
  private mapLanguageCode(language: SupportedLanguage): string {
    const codeMap: Record<SupportedLanguage, string> = {
      ja: 'ja',
      ko: 'ko',
      zh: 'zh',
      es: 'es',
      fr: 'fr',
      de: 'de',
      en: 'en',
      auto: 'en', // Default to English for auto
    };
    return codeMap[language] || 'en';
  }

  /**
   * Process a translation and match it with pending transcript
   */
  private processTranslation(utteranceId: string | null, translatedText: string): void {
    console.log(`[Gladia] Processing translation for utteranceId=${utteranceId}: "${translatedText}"`);
    console.log(`[Gladia] Pending transcripts: [${Array.from(this.pendingTranslations.keys()).join(', ')}]`);

    if (utteranceId && translatedText) {
      // Find the matching pending transcript
      const pending = this.pendingTranslations.get(utteranceId);
      if (pending) {
        // Add translation and send
        pending.translation = translatedText;
        this.pendingTranslations.delete(utteranceId);
        this.translationStats.translationsMatched++;
        this.translationStats.lastTranslationText = translatedText;
        console.log(`[Gladia] Sending transcript with translation: "${pending.text}" -> "${translatedText}"`);
        this.callbacks?.onTranscript(pending);
      } else {
        // No matching transcript found - might have already been sent due to timeout
        console.log(`[Gladia] Translation received but no pending transcript for ${utteranceId}`);
      }
    }
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
