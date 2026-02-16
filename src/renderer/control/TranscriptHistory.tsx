import React, { useState, useEffect, useCallback } from 'react';
import { SavedTranscript, LANGUAGE_NAMES, SupportedLanguage } from '../../shared/types';

interface TranscriptHistoryProps {
  onClose: () => void;
}

export function TranscriptHistory({ onClose }: TranscriptHistoryProps): React.ReactElement {
  const [transcripts, setTranscripts] = useState<SavedTranscript[]>([]);
  const [selectedTranscript, setSelectedTranscript] = useState<SavedTranscript | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadTranscripts = useCallback(async () => {
    try {
      const data = await window.electronAPI.getTranscripts();
      setTranscripts(data);
    } catch (err) {
      console.error('Failed to load transcripts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTranscripts();
  }, [loadTranscripts]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this transcript?')) return;

    const success = await window.electronAPI.deleteTranscript(id);
    if (success) {
      setTranscripts(prev => prev.filter(t => t.id !== id));
      if (selectedTranscript?.id === id) {
        setSelectedTranscript(null);
      }
    }
  }, [selectedTranscript]);

  const handleExport = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await window.electronAPI.exportTranscript(id);
    if (result.success) {
      alert(`Transcript exported to: ${result.filePath}`);
    } else if (result.error && result.error !== 'Export cancelled') {
      alert(`Export failed: ${result.error}`);
    }
  }, []);

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  if (isLoading) {
    return (
      <div className="transcript-history">
        <div className="transcript-history-header">
          <h2>Transcript History</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="transcript-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="transcript-history">
      <div className="transcript-history-header">
        <h2>Transcript History</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      {transcripts.length === 0 ? (
        <div className="transcript-empty">
          <p>No transcripts yet</p>
          <p className="transcript-empty-hint">
            Start a transcription session to save your first transcript.
          </p>
        </div>
      ) : (
        <div className="transcript-content">
          <div className="transcript-list">
            {transcripts.map(transcript => (
              <div
                key={transcript.id}
                className={`transcript-item ${selectedTranscript?.id === transcript.id ? 'selected' : ''}`}
                onClick={() => setSelectedTranscript(transcript)}
              >
                <div className="transcript-item-header">
                  <span className="transcript-title">{transcript.title}</span>
                  <div className="transcript-actions">
                    <button
                      className="transcript-action-btn export"
                      onClick={(e) => handleExport(transcript.id, e)}
                      title="Export"
                    >
                      ↓
                    </button>
                    <button
                      className="transcript-action-btn delete"
                      onClick={(e) => handleDelete(transcript.id, e)}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="transcript-meta">
                  <span className="transcript-duration">{formatDuration(transcript.duration)}</span>
                  <span className="transcript-separator">•</span>
                  <span className="transcript-words">{transcript.wordCount} words</span>
                  <span className="transcript-separator">•</span>
                  <span className="transcript-language">
                    {LANGUAGE_NAMES[transcript.language as SupportedLanguage] || transcript.language}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {selectedTranscript && (
            <div className="transcript-preview">
              <div className="transcript-preview-header">
                <h3>{selectedTranscript.title}</h3>
                <span className="transcript-preview-date">
                  {formatDate(selectedTranscript.createdAt)}
                </span>
              </div>
              <div className="transcript-preview-content">
                {selectedTranscript.content}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
