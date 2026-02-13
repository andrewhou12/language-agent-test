/**
 * OpenAI Whisper Transcription Service
 *
 * Handles audio transcription using OpenAI's Whisper API.
 */
import { SupportedLanguage, TranscriptionResult } from '../shared/types';
export declare class OpenAITranscription {
    private client;
    private language;
    constructor(apiKey: string, language?: SupportedLanguage);
    setApiKey(apiKey: string): void;
    setLanguage(language: SupportedLanguage): void;
    /**
     * Transcribe audio data using OpenAI Whisper API
     * @param audioBuffer - WAV audio data as Buffer
     * @returns Transcription result or null if failed
     */
    transcribe(audioBuffer: Buffer): Promise<TranscriptionResult | null>;
}
//# sourceMappingURL=openai-transcription.d.ts.map