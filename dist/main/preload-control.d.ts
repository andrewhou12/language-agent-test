/**
 * Preload script for Control Panel window
 *
 * Exposes a safe, limited API to the renderer process
 * using contextBridge for secure IPC communication.
 */
import { AppSettings, TranscriptionState } from '../shared/types';
export interface ControlAPI {
    startTranscription: () => Promise<{
        success: boolean;
        error?: string;
    }>;
    stopTranscription: () => Promise<{
        success: boolean;
    }>;
    getDesktopSources: () => Promise<Electron.DesktopCapturerSource[]>;
    transcribeAudio: (audioData: ArrayBuffer) => Promise<{
        text: string;
    } | null>;
    startSystemAudio: () => Promise<{
        success: boolean;
        platform?: string;
        error?: string;
    }>;
    stopSystemAudio: () => Promise<{
        success: boolean;
    }>;
    sendAudioData: (base64Data: string) => Promise<{
        text: string;
    } | null>;
    onSystemAudioData: (callback: (data: {
        data: string;
    }) => void) => void;
    getSettings: () => Promise<AppSettings>;
    updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    getState: () => Promise<TranscriptionState>;
    onStateChanged: (callback: (state: TranscriptionState) => void) => void;
    onError: (callback: (error: string) => void) => void;
    removeAllListeners: () => void;
}
//# sourceMappingURL=preload-control.d.ts.map