import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SubtitleOverlay } from './SubtitleOverlay';
import { ClassicSubtitle } from './ClassicSubtitle';
import { OverlayMode, TranscriptionResult, OverlayStyle, DEFAULT_OVERLAY_STYLE } from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';
import './styles.css';

const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

function OverlayRoot(): React.ReactElement {
  const [mode, setMode] = useState<OverlayMode>('bubble');
  const [isLoading, setIsLoading] = useState(true);
  const [style, setStyle] = useState<OverlayStyle>(DEFAULT_OVERLAY_STYLE);

  // Use a ref to store the current transcription handler from the active child
  const transcriptionHandlerRef = useRef<((result: TranscriptionResult) => void) | null>(null);
  const clearHandlerRef = useRef<(() => void) | null>(null);

  // Handle style updates
  const handleStyleUpdate = useCallback((newStyle: OverlayStyle) => {
    setStyle(newStyle);
  }, []);

  // Set up IPC listeners ONCE at the parent level
  useEffect(() => {
    // Forward transcription to active child's handler
    electronAPI.onTranscriptionUpdate((result: TranscriptionResult) => {
      transcriptionHandlerRef.current?.(result);
    });

    // Forward clear to active child's handler
    electronAPI.onClearTranscription(() => {
      clearHandlerRef.current?.();
    });

    electronAPI.onStyleUpdate(handleStyleUpdate);

    return () => {
      electronAPI.removeAllListeners();
    };
  }, [handleStyleUpdate]);

  // Initialize mode and listen for mode changes
  useEffect(() => {
    // Get initial overlay mode
    electronAPI.getOverlayMode().then((overlayMode) => {
      setMode(overlayMode);
      setIsLoading(false);
    });

    // Listen for mode changes
    electronAPI.onOverlayModeChange((newMode) => {
      // Clear current component's state before switching
      clearHandlerRef.current?.();
      setMode(newMode);
    });
  }, []);

  // Update body class based on mode for CSS isolation
  useEffect(() => {
    document.body.classList.remove('mode-bubble', 'mode-subtitle');
    document.body.classList.add(`mode-${mode}`);
  }, [mode]);

  // Callback for children to register their handlers
  const registerHandlers = useCallback((
    onTranscription: (result: TranscriptionResult) => void,
    onClear: () => void
  ) => {
    transcriptionHandlerRef.current = onTranscription;
    clearHandlerRef.current = onClear;
  }, []);

  if (isLoading) {
    return <div />;
  }

  // Pass style and handler registration to child components
  return mode === 'bubble' ? (
    <SubtitleOverlay style={style} registerHandlers={registerHandlers} />
  ) : (
    <ClassicSubtitle style={style} registerHandlers={registerHandlers} />
  );
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
