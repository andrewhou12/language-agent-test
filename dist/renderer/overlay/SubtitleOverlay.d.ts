import React from 'react';
import { TranscriptionResult, OverlayStyle } from '../../shared/types';
interface SubtitleOverlayProps {
    style: OverlayStyle;
    registerHandlers: (onTranscription: (result: TranscriptionResult) => void, onClear: () => void) => void;
}
export declare function SubtitleOverlay({ style, registerHandlers }: SubtitleOverlayProps): React.ReactElement;
export {};
//# sourceMappingURL=SubtitleOverlay.d.ts.map