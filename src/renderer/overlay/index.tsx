import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SubtitleOverlay } from './SubtitleOverlay';
import { ClassicSubtitle } from './ClassicSubtitle';
import { OverlayMode } from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';
import './styles.css';

const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

function OverlayRoot(): React.ReactElement {
  const [mode, setMode] = useState<OverlayMode>('bubble');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get initial overlay mode
    electronAPI.getOverlayMode().then((overlayMode) => {
      setMode(overlayMode);
      setIsLoading(false);
    });

    // Listen for mode changes
    electronAPI.onOverlayModeChange((newMode) => {
      setMode(newMode);
    });
  }, []);

  if (isLoading) {
    return <div />;
  }

  return mode === 'bubble' ? <SubtitleOverlay /> : <ClassicSubtitle />;
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <OverlayRoot />
    </React.StrictMode>
  );
}
