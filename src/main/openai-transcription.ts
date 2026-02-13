/**
 * OpenAI Whisper Transcription Service
 *
 * Handles audio transcription using OpenAI's Whisper API.
 */

// Polyfill File for Node.js/Electron environments (required by OpenAI SDK)
import { File as NodeFile } from 'node:buffer';
if (typeof globalThis.File === 'undefined') {
  (globalThis as any).File = NodeFile;
}

import OpenAI from 'openai';
import { SupportedLanguage, TranscriptionResult } from '../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class OpenAITranscription {
  private client: OpenAI | null = null;
  private language: SupportedLanguage;

  constructor(apiKey: string, language: SupportedLanguage = 'auto') {
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
    this.language = language;
  }

  setApiKey(apiKey: string): void {
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.client = null;
    }
  }

  setLanguage(language: SupportedLanguage): void {
    this.language = language;
  }

  /**
   * Transcribe audio data using OpenAI Whisper API
   * @param audioBuffer - WAV audio data as Buffer
   * @returns Transcription result or null if failed
   */
  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult | null> {
    if (!this.client) {
      console.error('OpenAI client not initialized - missing API key');
      return null;
    }

    console.log('OpenAI transcribe called, buffer size:', audioBuffer.length);

    try {
      // Write audio to a temporary file (OpenAI API requires a file)
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `whisper-${Date.now()}.wav`);

      fs.writeFileSync(tempFile, audioBuffer);
      console.log('Wrote temp file:', tempFile);

      try {
        console.log('Calling OpenAI API with language:', this.language);
        const response = await this.client.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: 'whisper-1',
          language: this.language === 'auto' ? undefined : this.language,
          response_format: 'verbose_json',  // Get detailed response with no_speech_prob
        });

        console.log('OpenAI response:', JSON.stringify(response, null, 2));

        // Clean up temp file
        fs.unlinkSync(tempFile);

        // Check if there's actual speech using Whisper's detection
        const segments = (response as any).segments || [];

        if (segments.length > 0) {
          // Filter segments with high no_speech_prob (likely hallucinations)
          const validSegments = segments.filter((seg: any) => {
            const noSpeechProb = seg.no_speech_prob || 0;
            if (noSpeechProb > 0.5) {
              console.log('Filtered low-confidence segment:', seg.text, 'no_speech_prob:', noSpeechProb);
              return false;
            }
            return true;
          });

          const text = validSegments.map((seg: any) => seg.text).join(' ').trim();

          if (text) {
            return {
              text: text,
              timestamp: Date.now(),
              confidence: 1.0 - (segments[0]?.no_speech_prob || 0),
              language: (response as any).language || (this.language === 'auto' ? undefined : this.language),
            };
          }
        }

        // Fallback to simple text check
        const text = (response as any).text?.trim();
        if (text) {
          return {
            text: text,
            timestamp: Date.now(),
            confidence: 1.0,
            language: this.language === 'auto' ? undefined : this.language,
          };
        }

        console.log('No text in response');
        return null;
      } catch (error) {
        // Clean up temp file on error
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        throw error;
      }
    } catch (error) {
      console.error('Transcription error:', error);
      return null;
    }
  }
}
