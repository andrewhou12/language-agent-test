import React from 'react';
import type { ControlAPI } from '../../main/preload-control';
declare global {
    interface Window {
        electronAPI: ControlAPI;
    }
}
export declare function ControlPanel(): React.ReactElement;
//# sourceMappingURL=ControlPanel.d.ts.map