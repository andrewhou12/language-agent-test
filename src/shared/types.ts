// Shared type definitions for the Language Agent application

export type TranscriptionState = 'idle' | 'starting' | 'active' | 'stopping';

export type WhisperModel = 'tiny' | 'base' | 'small';

export type SupportedLanguage =
  | 'ja' // Japanese
  | 'ko' // Korean
  | 'zh' // Chinese (Mandarin)
  | 'es' // Spanish
  | 'fr' // French
  | 'de' // German
  | 'en' // English
  | 'auto'; // Auto-detect

export type TranscriptionProvider = 'deepgram' | 'gladia';

export interface TranscriptionResult {
  text: string;
  timestamp: number;
  confidence: number;
  language?: string;
  isFinal?: boolean;      // Whether this is the final transcription for this segment
  speechFinal?: boolean;  // Whether the speaker has finished this utterance
}

export interface SavedTranscript {
  id: string;
  title: string;
  content: string;
  language: SupportedLanguage;
  startTime: number;      // Unix timestamp when session started
  endTime: number;        // Unix timestamp when session ended
  duration: number;       // Duration in seconds
  wordCount: number;
  createdAt: number;      // Unix timestamp
}

export interface OverlayPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayStyle {
  position: 'bottom' | 'top' | 'custom';
  customPosition?: { x: number; y: number };
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  textShadow: boolean;
  textOutline: boolean;
  maxLines: number;
  displayDuration: number; // in seconds
}

export interface BubbleState {
  x: number;       // -1 means center
  y: number;       // -1 means center
  width: number;
  height: number;
  collapsed: boolean;
}

export interface AppSettings {
  // Provider selection
  transcriptionProvider: TranscriptionProvider;

  // API settings
  deepgramApiKey: string;
  gladiaApiKey: string;

  // Model settings
  whisperModel: WhisperModel;
  language: SupportedLanguage;

  // Performance settings
  gpuAcceleration: boolean;
  chunkSize: number; // in seconds (1-3)

  // Overlay settings
  overlayStyle: OverlayStyle;
  bubbleState: BubbleState;

  // Shortcuts
  toggleShortcut: string;
  showHideShortcut: string;

  // General
  autoStart: boolean;
  minimizeToTray: boolean;
}

export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  position: 'bottom',
  fontFamily: 'system-ui, "Noto Sans CJK", sans-serif',
  fontSize: 24,
  fontWeight: 400,
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.7,
  textShadow: true,
  textOutline: false,
  maxLines: 2,
  displayDuration: 5,
};

export const DEFAULT_BUBBLE_STATE: BubbleState = {
  x: -1,  // -1 means center
  y: -1,
  width: 400,
  height: 250,
  collapsed: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider: 'deepgram',
  deepgramApiKey: '',
  gladiaApiKey: '',
  whisperModel: 'base',
  language: 'auto',
  gpuAcceleration: true,
  chunkSize: 2,
  overlayStyle: DEFAULT_OVERLAY_STYLE,
  bubbleState: DEFAULT_BUBBLE_STATE,
  toggleShortcut: 'CommandOrControl+Shift+S',
  showHideShortcut: 'CommandOrControl+Shift+H',
  autoStart: false,
  minimizeToTray: true,
};

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese (Mandarin)',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  en: 'English',
  auto: 'Auto-detect',
};

export const PROVIDER_NAMES: Record<TranscriptionProvider, string> = {
  deepgram: 'Deepgram',
  gladia: 'Gladia',
};

export const MODEL_INFO: Record<WhisperModel, { size: string; speed: string; accuracy: string }> = {
  tiny: { size: '~75MB', speed: 'Fastest', accuracy: 'Good' },
  base: { size: '~150MB', speed: 'Fast', accuracy: 'Better' },
  small: { size: '~500MB', speed: 'Moderate', accuracy: 'Best' },
};

// IPC Channel names
export const IPC_CHANNELS = {
  // Control -> Main
  START_TRANSCRIPTION: 'start-transcription',
  STOP_TRANSCRIPTION: 'stop-transcription',
  GET_SETTINGS: 'get-settings',
  UPDATE_SETTINGS: 'update-settings',
  GET_STATE: 'get-state',
  TRANSCRIBE_AUDIO: 'transcribe-audio',
  GET_DESKTOP_SOURCES: 'get-desktop-sources',

  // Audio capture
  START_SYSTEM_AUDIO: 'start-system-audio',
  STOP_SYSTEM_AUDIO: 'stop-system-audio',
  SYSTEM_AUDIO_DATA: 'system-audio-data',
  STREAM_AUDIO_CHUNK: 'stream-audio-chunk', // New: stream audio directly to Deepgram

  // Main -> Overlay
  TRANSCRIPTION_UPDATE: 'transcription-update',
  CLEAR_TRANSCRIPTION: 'clear-transcription',
  UPDATE_OVERLAY_STYLE: 'update-overlay-style',

  // Overlay -> Main (bubble state)
  SAVE_BUBBLE_STATE: 'save-bubble-state',
  GET_BUBBLE_STATE: 'get-bubble-state',
  TOGGLE_BUBBLE_COLLAPSE: 'toggle-bubble-collapse',

  // Main -> Control
  STATE_CHANGED: 'state-changed',
  ERROR_OCCURRED: 'error-occurred',

  // Diagnostics
  GET_DIAGNOSTICS: 'get-diagnostics',

  // Transcript history
  GET_TRANSCRIPTS: 'get-transcripts',
  GET_TRANSCRIPT: 'get-transcript',
  DELETE_TRANSCRIPT: 'delete-transcript',
  EXPORT_TRANSCRIPT: 'export-transcript',
} as const;
