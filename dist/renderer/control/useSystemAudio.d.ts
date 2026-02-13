/**
 * Custom hook for capturing system audio
 *
 * Platform-specific implementations:
 * - macOS: Uses native Swift binary (SystemAudioDump) via IPC
 * - Windows: Uses Electron's WASAPI loopback via getDisplayMedia
 *
 * Setup required:
 * - macOS: Screen Recording permission + SystemAudioDump binary in assets/
 * - Windows: No special permissions needed
 */
import type { ControlAPI } from '../../main/preload-control';
declare global {
    interface Window {
        electronAPI: ControlAPI;
    }
}
interface UseSystemAudioOptions {
    onError?: (error: string) => void;
}
interface UseSystemAudioReturn {
    startCapture: () => Promise<boolean>;
    stopCapture: () => void;
    isCapturing: boolean;
}
export declare function useSystemAudio(options?: UseSystemAudioOptions): UseSystemAudioReturn;
export {};
//# sourceMappingURL=useSystemAudio.d.ts.map