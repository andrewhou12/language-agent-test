/**
 * Preload script for Overlay window
 *
 * Exposes a minimal API for receiving transcription updates
 * and style changes from the main process.
 */
import { TranscriptionResult, OverlayStyle, BubbleState } from '../shared/types';
export interface OverlayAPI {
    onTranscriptionUpdate: (callback: (result: TranscriptionResult) => void) => void;
    onClearTranscription: (callback: () => void) => void;
    onStyleUpdate: (callback: (style: OverlayStyle) => void) => void;
    getBubbleState: () => Promise<BubbleState>;
    saveBubbleState: (state: BubbleState) => Promise<BubbleState>;
    toggleCollapse: () => Promise<BubbleState>;
    removeAllListeners: () => void;
}
//# sourceMappingURL=preload-overlay.d.ts.map