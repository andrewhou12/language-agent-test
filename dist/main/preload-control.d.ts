/**
 * Preload script for Control Panel window
 *
 * Exposes a safe, limited API to the renderer process
 * using contextBridge for secure IPC communication.
 */
import { AppSettings, TranscriptionState, SavedTranscript } from '../shared/types';
export interface ControlAPI {
    startTranscription: () => Promise<{
        success: boolean;
        error?: string;
    }>;
    stopTranscription: () => Promise<{
        success: boolean;
    }>;
    getDesktopSources: () => Promise<Electron.DesktopCapturerSource[]>;
    startSystemAudio: () => Promise<{
        success: boolean;
        platform?: string;
        error?: string;
    }>;
    stopSystemAudio: () => Promise<{
        success: boolean;
    }>;
    streamAudioChunk: (base64Data: string) => Promise<{
        success: boolean;
    }>;
    getSettings: () => Promise<AppSettings>;
    updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    getState: () => Promise<TranscriptionState>;
    getDiagnostics: () => Promise<any>;
    getTranscripts: () => Promise<SavedTranscript[]>;
    getTranscript: (id: string) => Promise<SavedTranscript | null>;
    deleteTranscript: (id: string) => Promise<boolean>;
    exportTranscript: (id: string) => Promise<{
        success: boolean;
        filePath?: string;
        error?: string;
    }>;
    onStateChanged: (callback: (state: TranscriptionState) => void) => void;
    onError: (callback: (error: string) => void) => void;
    removeAllListeners: () => void;
}
//# sourceMappingURL=preload-control.d.ts.map