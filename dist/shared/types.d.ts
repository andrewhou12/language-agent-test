export type TranscriptionState = 'idle' | 'starting' | 'active' | 'stopping';
export type WhisperModel = 'tiny' | 'base' | 'small';
export type SupportedLanguage = 'ja' | 'ko' | 'zh' | 'es' | 'fr' | 'de' | 'en' | 'auto';
export interface TranscriptionResult {
    text: string;
    timestamp: number;
    confidence: number;
    language?: string;
    isFinal?: boolean;
    speechFinal?: boolean;
}
export interface SavedTranscript {
    id: string;
    title: string;
    content: string;
    language: SupportedLanguage;
    startTime: number;
    endTime: number;
    duration: number;
    wordCount: number;
    createdAt: number;
}
export interface OverlayPosition {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface OverlayStyle {
    position: 'bottom' | 'top' | 'custom';
    customPosition?: {
        x: number;
        y: number;
    };
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    textColor: string;
    backgroundColor: string;
    backgroundOpacity: number;
    textShadow: boolean;
    textOutline: boolean;
    maxLines: number;
    displayDuration: number;
}
export interface AppSettings {
    deepgramApiKey: string;
    whisperModel: WhisperModel;
    language: SupportedLanguage;
    gpuAcceleration: boolean;
    chunkSize: number;
    overlayStyle: OverlayStyle;
    toggleShortcut: string;
    showHideShortcut: string;
    autoStart: boolean;
    minimizeToTray: boolean;
}
export declare const DEFAULT_OVERLAY_STYLE: OverlayStyle;
export declare const DEFAULT_SETTINGS: AppSettings;
export declare const LANGUAGE_NAMES: Record<SupportedLanguage, string>;
export declare const MODEL_INFO: Record<WhisperModel, {
    size: string;
    speed: string;
    accuracy: string;
}>;
export declare const IPC_CHANNELS: {
    readonly START_TRANSCRIPTION: "start-transcription";
    readonly STOP_TRANSCRIPTION: "stop-transcription";
    readonly GET_SETTINGS: "get-settings";
    readonly UPDATE_SETTINGS: "update-settings";
    readonly GET_STATE: "get-state";
    readonly TRANSCRIBE_AUDIO: "transcribe-audio";
    readonly GET_DESKTOP_SOURCES: "get-desktop-sources";
    readonly START_SYSTEM_AUDIO: "start-system-audio";
    readonly STOP_SYSTEM_AUDIO: "stop-system-audio";
    readonly SYSTEM_AUDIO_DATA: "system-audio-data";
    readonly STREAM_AUDIO_CHUNK: "stream-audio-chunk";
    readonly TRANSCRIPTION_UPDATE: "transcription-update";
    readonly CLEAR_TRANSCRIPTION: "clear-transcription";
    readonly UPDATE_OVERLAY_STYLE: "update-overlay-style";
    readonly STATE_CHANGED: "state-changed";
    readonly ERROR_OCCURRED: "error-occurred";
    readonly GET_DIAGNOSTICS: "get-diagnostics";
    readonly GET_TRANSCRIPTS: "get-transcripts";
    readonly GET_TRANSCRIPT: "get-transcript";
    readonly DELETE_TRANSCRIPT: "delete-transcript";
    readonly EXPORT_TRANSCRIPT: "export-transcript";
};
//# sourceMappingURL=types.d.ts.map