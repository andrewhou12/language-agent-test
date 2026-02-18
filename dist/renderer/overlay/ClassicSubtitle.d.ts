import React from 'react';
import { TranscriptionResult, OverlayStyle, TranslationDisplayMode } from '../../shared/types';
interface ClassicSubtitleProps {
    style: OverlayStyle;
    registerHandlers: (onTranscription: (result: TranscriptionResult) => void, onClear: () => void) => void;
    translationDisplayMode: TranslationDisplayMode;
}
export declare function ClassicSubtitle({ style, registerHandlers, translationDisplayMode }: ClassicSubtitleProps): React.ReactElement;
export {};
//# sourceMappingURL=ClassicSubtitle.d.ts.map