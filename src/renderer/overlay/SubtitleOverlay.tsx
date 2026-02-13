import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TranscriptionResult,
  OverlayStyle,
  DEFAULT_OVERLAY_STYLE,
} from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';

// Access the electronAPI with proper typing for the overlay context
const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

interface SubtitleEntry {
  id: number;
  text: string;
  timestamp: number;
  isFadingOut: boolean;
}

export function SubtitleOverlay(): React.ReactElement {
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [style, setStyle] = useState<OverlayStyle>(DEFAULT_OVERLAY_STYLE);
  const [isListening, setIsListening] = useState(true);
  const nextIdRef = useRef(0);
  const fadeOutTimersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  // Clear a subtitle after fade-out completes
  const removeSubtitle = useCallback((id: number) => {
    setSubtitles((prev) => prev.filter((s) => s.id !== id));
    fadeOutTimersRef.current.delete(id);
  }, []);

  // Start fade-out animation for a subtitle
  const startFadeOut = useCallback(
    (id: number) => {
      setSubtitles((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isFadingOut: true } : s))
      );

      // Remove after fade-out animation (500ms as defined in CSS)
      setTimeout(() => removeSubtitle(id), 500);
    },
    [removeSubtitle]
  );

  // Schedule a subtitle to fade out after displayDuration
  const scheduleRemoval = useCallback(
    (id: number, displayDuration: number) => {
      const timer = setTimeout(() => {
        startFadeOut(id);
      }, displayDuration * 1000);

      fadeOutTimersRef.current.set(id, timer);
    },
    [startFadeOut]
  );

  // Handle incoming transcription
  const handleTranscription = useCallback(
    (result: TranscriptionResult) => {
      const id = nextIdRef.current++;
      const newEntry: SubtitleEntry = {
        id,
        text: result.text,
        timestamp: result.timestamp,
        isFadingOut: false,
      };

      setSubtitles((prev) => {
        // Keep only the most recent entries (maxLines - 1) plus the new one
        const maxToKeep = style.maxLines;
        const kept = prev.slice(-(maxToKeep - 1));
        return [...kept, newEntry];
      });

      // Schedule this subtitle to fade out
      scheduleRemoval(id, style.displayDuration);
      setIsListening(true);
    },
    [style.maxLines, style.displayDuration, scheduleRemoval]
  );

  // Handle clear transcription command
  const handleClear = useCallback(() => {
    // Clear all timers
    fadeOutTimersRef.current.forEach((timer) => clearTimeout(timer));
    fadeOutTimersRef.current.clear();

    // Clear all subtitles
    setSubtitles([]);
    setIsListening(false);
  }, []);

  // Handle style updates
  const handleStyleUpdate = useCallback((newStyle: OverlayStyle) => {
    setStyle(newStyle);
  }, []);

  // Set up IPC listeners
  useEffect(() => {
    electronAPI.onTranscriptionUpdate(handleTranscription);
    electronAPI.onClearTranscription(handleClear);
    electronAPI.onStyleUpdate(handleStyleUpdate);

    return () => {
      electronAPI.removeAllListeners();
      // Clear all timers on unmount
      fadeOutTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, [handleTranscription, handleClear, handleStyleUpdate]);

  // Generate dynamic styles based on settings
  const containerStyle: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    color: style.textColor,
  };

  const lineStyle: React.CSSProperties = {
    backgroundColor: `rgba(${hexToRgb(style.backgroundColor)}, ${style.backgroundOpacity})`,
  };

  // Determine position class
  const positionClass = `position-${style.position}`;

  // Determine language class for CJK fonts
  const getLangClass = (text: string): string => {
    // Check for CJK characters
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) {
      return 'lang-ja';
    }
    if (/[\uAC00-\uD7AF]/.test(text)) {
      return 'lang-ko';
    }
    if (/[\u4E00-\u9FFF]/.test(text)) {
      return 'lang-zh';
    }
    return '';
  };

  return (
    <div
      className={`subtitle-overlay ${positionClass}`}
      style={containerStyle}
    >
      <div className="subtitle-container">
        {subtitles.length === 0 && isListening && (
          <div className="status-indicator">
            <span className="status-dot" />
            <span>Listening...</span>
          </div>
        )}

        {subtitles.map((subtitle) => (
          <div
            key={subtitle.id}
            className={`subtitle-line ${subtitle.isFadingOut ? 'fading-out' : ''} ${
              style.textShadow ? 'text-shadow' : ''
            } ${style.textOutline ? 'text-outline' : ''} ${getLangClass(subtitle.text)}`}
            style={lineStyle}
          >
            {subtitle.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper function to convert hex color to RGB
function hexToRgb(hex: string): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Parse hex values
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  return `${r}, ${g}, ${b}`;
}
