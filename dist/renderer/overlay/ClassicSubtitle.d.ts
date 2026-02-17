import React from 'react';
import { TranscriptionResult, OverlayStyle } from '../../shared/types';
interface ClassicSubtitleProps {
    style: OverlayStyle;
    registerHandlers: (onTranscription: (result: TranscriptionResult) => void, onClear: () => void) => void;
}
export declare function ClassicSubtitle({ style, registerHandlers }: ClassicSubtitleProps): React.ReactElement;
export {};
//# sourceMappingURL=ClassicSubtitle.d.ts.map