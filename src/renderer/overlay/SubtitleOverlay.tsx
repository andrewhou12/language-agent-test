import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TranscriptionResult,
  OverlayStyle,
  BubbleState,
  DEFAULT_OVERLAY_STYLE,
  DEFAULT_BUBBLE_STATE,
} from '../../shared/types';
import type { OverlayAPI } from '../../main/preload-overlay';

// Access the electronAPI with proper typing for the overlay context
const electronAPI = (window as unknown as { electronAPI: OverlayAPI }).electronAPI;

interface TranscriptEntry {
  id: number;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

// Configuration
const MAX_AGE_MS = 30000;      // 30 seconds rolling window
const MAX_ENTRIES = 50;        // Max entries to keep
const PAUSE_CLEAR_MS = 5000;   // Clear after 5 seconds of silence

export function SubtitleOverlay(): React.ReactElement {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [style, setStyle] = useState<OverlayStyle>(DEFAULT_OVERLAY_STYLE);
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

  // Handle style updates
  const handleStyleUpdate = useCallback((newStyle: OverlayStyle) => {
    setStyle(newStyle);
  }, []);

  // Toggle collapse
  const handleToggleCollapse = useCallback(async () => {
    const newState = await electronAPI.toggleCollapse();
    setBubbleState(newState);
    setIsCollapsed(newState.collapsed);
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

  // Build transcript text with proper spacing
  const renderTranscriptText = () => {
    return transcripts.map((t, index) => (
      <span
        key={t.id}
        className={`transcript-word ${t.isFinal ? 'final' : 'interim'} ${getLangClass(t.text)}`}
      >
        {t.text}
        {index < transcripts.length - 1 ? ' ' : ''}
      </span>
    ));
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
