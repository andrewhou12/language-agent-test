import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TranscriptionResult,
  OverlayStyle,
  BubbleState,
  DEFAULT_BUBBLE_STATE,
  SPEAKER_COLORS,
  TranslationDisplayMode,
} from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';

// Access the electronAPI with proper typing for the overlay context
const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

interface TranscriptEntry {
  id: number;
  text: string;
  timestamp: number;
  isFinal: boolean;
  speaker?: number;
  translation?: string;
}

// Configuration
const MAX_AGE_MS = 30000;      // 30 seconds rolling window
const MAX_ENTRIES = 50;        // Max entries to keep
const PAUSE_CLEAR_MS = 5000;   // Clear after 5 seconds of silence

interface SubtitleOverlayProps {
  style: OverlayStyle;
  registerHandlers: (
    onTranscription: (result: TranscriptionResult) => void,
    onClear: () => void
  ) => void;
  translationDisplayMode: TranslationDisplayMode;
}

export function SubtitleOverlay({ style, registerHandlers, translationDisplayMode }: SubtitleOverlayProps): React.ReactElement {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [bubbleState, setBubbleState] = useState<BubbleState>(DEFAULT_BUBBLE_STATE);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const nextIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Load initial bubble state
  useEffect(() => {
    electronAPI.getBubbleState().then((state) => {
      setBubbleState(state);
      setIsCollapsed(state.collapsed);
    });
  }, []);

  // Auto-scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, isCollapsed]);

  // Clear transcripts after pause (5 seconds of silence)
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceLastActivity = Date.now() - lastActivityRef.current;
      if (timeSinceLastActivity > PAUSE_CLEAR_MS && transcripts.length > 0) {
        setTranscripts([]);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [transcripts.length]);

  // Trim old transcripts (rolling window)
  const trimTranscripts = useCallback((entries: TranscriptEntry[]): TranscriptEntry[] => {
    const now = Date.now();
    return entries
      .filter(e => now - e.timestamp < MAX_AGE_MS)
      .slice(-MAX_ENTRIES);
  }, []);

  // Handle incoming transcription
  const handleTranscription = useCallback(
    (result: TranscriptionResult) => {
      lastActivityRef.current = Date.now();

      setTranscripts((prev) => {
        // Find the last non-final entry (current interim)
        const lastInterimIndex = prev.findIndex((s) => !s.isFinal);

        let updated: TranscriptEntry[];

        if (result.isFinal) {
          // Final result: replace any interim with this final version
          if (lastInterimIndex !== -1) {
            updated = [...prev];
            updated[lastInterimIndex] = {
              ...updated[lastInterimIndex],
              text: result.text,
              isFinal: true,
              speaker: result.speaker,
              translation: result.translation,
            };
          } else {
            // No interim to replace, add as new final entry
            const id = nextIdRef.current++;
            updated = [
              ...prev,
              {
                id,
                text: result.text,
                timestamp: result.timestamp,
                isFinal: true,
                speaker: result.speaker,
                translation: result.translation,
              },
            ];
          }
        } else {
          // Interim result: update existing interim or create new one
          if (lastInterimIndex !== -1) {
            updated = [...prev];
            updated[lastInterimIndex] = {
              ...updated[lastInterimIndex],
              text: result.text,
              timestamp: Date.now(),
              speaker: result.speaker,
              translation: result.translation,
            };
          } else {
            const id = nextIdRef.current++;
            updated = [
              ...prev,
              {
                id,
                text: result.text,
                timestamp: result.timestamp,
                isFinal: false,
                speaker: result.speaker,
                translation: result.translation,
              },
            ];
          }
        }

        return trimTranscripts(updated);
      });
    },
    [trimTranscripts]
  );

  // Handle clear transcription command
  const handleClear = useCallback(() => {
    setTranscripts([]);
  }, []);

  // Register handlers with parent
  useEffect(() => {
    registerHandlers(handleTranscription, handleClear);
  }, [registerHandlers, handleTranscription, handleClear]);

  // Toggle collapse
  const handleToggleCollapse = useCallback(async () => {
    const newState = await electronAPI.toggleCollapse();
    setBubbleState(newState);
    setIsCollapsed(newState.collapsed);
  }, []);

  // Determine language class for CJK fonts
  const getLangClass = (text: string): string => {
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'lang-cjk';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'lang-cjk';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'lang-cjk';
    return '';
  };

  // Get speaker color
  const getSpeakerColor = (speaker?: number): string | undefined => {
    if (speaker === undefined) return undefined;
    return SPEAKER_COLORS[speaker % Object.keys(SPEAKER_COLORS).length];
  };

  // Get display text based on translation mode
  const getDisplayText = (t: TranscriptEntry): { primary: string; secondary?: string } => {
    switch (translationDisplayMode) {
      case 'translation':
        // Show only translation (fall back to original if no translation)
        return { primary: t.translation || t.text };
      case 'original':
        // Show only original
        return { primary: t.text };
      case 'stacked':
      default:
        // Show both (original primary, translation secondary)
        return { primary: t.text, secondary: t.translation };
    }
  };

  // Build transcript text with proper spacing and speaker colors
  const renderTranscriptText = () => {
    return transcripts.map((t, index) => {
      // Only apply speaker color for final results (diarization is more accurate)
      const speakerColor = t.isFinal ? getSpeakerColor(t.speaker) : undefined;
      const { primary, secondary } = getDisplayText(t);

      return (
        <span
          key={t.id}
          className={`transcript-word ${t.isFinal ? 'final' : 'interim'} ${getLangClass(primary)}`}
          style={speakerColor ? { color: speakerColor } : undefined}
        >
          {primary}
          {secondary && (
            <span className="translation-text"> ({secondary})</span>
          )}
          {index < transcripts.length - 1 ? ' ' : ''}
        </span>
      );
    });
  };

  return (
    <div className={`bubble-container ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header / Drag handle */}
      <div className="bubble-header">
        <div className="header-left">
          <div className="status-dot" />
          {isCollapsed && <span className="collapsed-label">Live</span>}
        </div>
        <button
          className="collapse-btn"
          onClick={handleToggleCollapse}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▼' : '▲'}
        </button>
      </div>

      {/* Transcript content - hidden when collapsed */}
      {!isCollapsed && (
        <div
          className="bubble-content"
          ref={scrollRef}
          style={{
            fontFamily: style.fontFamily,
            fontSize: `${style.fontSize}px`,
            fontWeight: style.fontWeight,
          }}
        >
          {transcripts.length === 0 ? (
            <div className="empty-state">Listening...</div>
          ) : (
            <div className="transcript-text">
              {renderTranscriptText()}
            </div>
          )}
        </div>
      )}

      {/* Resize handle */}
      {!isCollapsed && <div className="resize-handle" />}
    </div>
  );
}
