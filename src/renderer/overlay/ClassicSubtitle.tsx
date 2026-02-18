import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TranscriptionResult,
  OverlayStyle,
  SPEAKER_COLORS,
} from '../../shared/types';

interface SubtitleEntry {
  id: number;
  text: string;
  timestamp: number;
  isFadingOut: boolean;
  isFinal: boolean;
  speaker?: number;
}

interface ClassicSubtitleProps {
  style: OverlayStyle;
  registerHandlers: (
    onTranscription: (result: TranscriptionResult) => void,
    onClear: () => void
  ) => void;
}

export function ClassicSubtitle({ style, registerHandlers }: ClassicSubtitleProps): React.ReactElement {
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
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
      setSubtitles((prev) => {
        // Find the last non-final entry (current interim)
        const lastInterimIndex = prev.findIndex((s) => !s.isFinal && !s.isFadingOut);

        if (result.isFinal) {
          // Final result: replace any interim with this final version
          if (lastInterimIndex !== -1) {
            // Replace interim with final
            const updated = [...prev];
            updated[lastInterimIndex] = {
              ...updated[lastInterimIndex],
              text: result.text,
              isFinal: true,
              speaker: result.speaker,
            };
            // Schedule fade-out for the now-final entry
            scheduleRemoval(updated[lastInterimIndex].id, style.displayDuration);
            return updated;
          } else {
            // No interim to replace, add as new final entry
            const id = nextIdRef.current++;
            const newEntry: SubtitleEntry = {
              id,
              text: result.text,
              timestamp: result.timestamp,
              isFadingOut: false,
              isFinal: true,
              speaker: result.speaker,
            };
            scheduleRemoval(id, style.displayDuration);
            const maxToKeep = style.maxLines;
            const kept = prev.slice(-(maxToKeep - 1));
            return [...kept, newEntry];
          }
        } else {
          // Interim result: update existing interim or create new one
          if (lastInterimIndex !== -1) {
            // Update existing interim in place
            const updated = [...prev];
            updated[lastInterimIndex] = {
              ...updated[lastInterimIndex],
              text: result.text,
              speaker: result.speaker,
            };
            return updated;
          } else {
            // Create new interim entry
            const id = nextIdRef.current++;
            const newEntry: SubtitleEntry = {
              id,
              text: result.text,
              timestamp: result.timestamp,
              isFadingOut: false,
              isFinal: false,
              speaker: result.speaker,
            };
            const maxToKeep = style.maxLines;
            const kept = prev.slice(-(maxToKeep - 1));
            return [...kept, newEntry];
          }
        }
      });

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

  // Register handlers with parent
  useEffect(() => {
    registerHandlers(handleTranscription, handleClear);
  }, [registerHandlers, handleTranscription, handleClear]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      fadeOutTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

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

  // Get speaker color
  const getSpeakerColor = (speaker?: number): string | undefined => {
    if (speaker === undefined) return undefined;
    return SPEAKER_COLORS[speaker % Object.keys(SPEAKER_COLORS).length];
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

        {subtitles.map((subtitle) => {
          // Only apply speaker color for final results (diarization is more accurate)
          const speakerColor = subtitle.isFinal ? getSpeakerColor(subtitle.speaker) : undefined;
          return (
            <div
              key={subtitle.id}
              className={`subtitle-line ${subtitle.isFadingOut ? 'fading-out' : ''} ${
                style.textShadow ? 'text-shadow' : ''
              } ${style.textOutline ? 'text-outline' : ''} ${getLangClass(subtitle.text)}`}
              style={{
                ...lineStyle,
                color: speakerColor || style.textColor,
              }}
            >
              {subtitle.text}
            </div>
          );
        })}
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
