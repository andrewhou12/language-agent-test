import React from 'react';
import { TranscriptionResult, OverlayStyle, TranslationDisplayMode } from '../../shared/types';
interface SubtitleOverlayProps {
    style: OverlayStyle;
    registerHandlers: (onTranscription: (result: TranscriptionResult) => void, onClear: () => void) => void;
    translationDisplayMode: TranslationDisplayMode;
}
export declare function SubtitleOverlay({ style, registerHandlers, translationDisplayMode }: SubtitleOverlayProps): React.ReactElement;
export {};
//# sourceMappingURL=SubtitleOverlay.d.ts.map