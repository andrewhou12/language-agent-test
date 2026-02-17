import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TranscriptionResult,
  OverlayStyle,
  DEFAULT_OVERLAY_STYLE,
} from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';

const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

interface TranscriptSegment {
  id: number;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

const MAX_DISPLAY_TIME = 8000; // 8 seconds max display
const FADE_DURATION = 500;

export function ClassicSubtitle(): React.ReactElement {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [style, setStyle] = useState<OverlayStyle>(DEFAULT_OVERLAY_STYLE);
  const [isVisible, setIsVisible] = useState(true);

  const nextIdRef = useRef(0);
  const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup old segments
  useEffect(() => {
    cleanupTimerRef.current = setInterval(() => {
      const now = Date.now();
      setSegments((prev) =>
        prev.filter((s) => now - s.timestamp < MAX_DISPLAY_TIME)
      );
    }, 1000);

    return () => {
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
      }
    };
  }, []);

  // Handle incoming transcription
  const handleTranscription = useCallback((result: TranscriptionResult) => {
    setSegments((prev) => {
      // Find existing interim segment
      const interimIndex = prev.findIndex((s) => !s.isFinal);

      if (result.isFinal) {
        // Replace interim with final, or add new final
        if (interimIndex !== -1) {
          const updated = [...prev];
          updated[interimIndex] = {
            ...updated[interimIndex],
            text: result.text,
            isFinal: true,
            timestamp: Date.now(),
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: nextIdRef.current++,
              text: result.text,
              timestamp: Date.now(),
              isFinal: true,
            },
          ].slice(-3); // Keep last 3 segments
        }
      } else {
        // Update or add interim
        if (interimIndex !== -1) {
          const updated = [...prev];
          updated[interimIndex] = {
            ...updated[interimIndex],
            text: result.text,
            timestamp: Date.now(),
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: nextIdRef.current++,
              text: result.text,
              timestamp: Date.now(),
              isFinal: false,
            },
          ].slice(-3);
        }
      }
    });
  }, []);

  // Handle clear
  const handleClear = useCallback(() => {
    setSegments([]);
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
    };
  }, [handleTranscription, handleClear, handleStyleUpdate]);

  // Determine language class for CJK fonts
  const getLangClass = (text: string): string => {
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'lang-cjk';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'lang-cjk';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'lang-cjk';
    return '';
  };

  // Get combined text from recent segments
  const displayText = segments
    .map((s) => s.text)
    .join(' ')
    .trim();

  if (!displayText) {
    return <div className="classic-container" />;
  }

  const hasInterim = segments.some((s) => !s.isFinal);

  return (
    <div className="classic-container">
      <div
        className="classic-subtitle"
        style={{
          fontFamily: style.fontFamily,
          fontSize: `${style.fontSize}px`,
          fontWeight: style.fontWeight,
        }}
      >
        <span className={`subtitle-text ${hasInterim ? 'has-interim' : ''} ${getLangClass(displayText)}`}>
          {displayText}
        </span>
      </div>
    </div>
  );
}
