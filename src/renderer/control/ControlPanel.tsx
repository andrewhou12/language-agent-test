import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppSettings,
  TranscriptionState,
  SupportedLanguage,
  TranscriptionProvider,
  LANGUAGE_NAMES,
  PROVIDER_NAMES,
} from '../../shared/types';
import type { ControlAPI } from '../../main/preload-control';
import { useSystemAudio } from './useSystemAudio';
import { TranscriptHistory } from './TranscriptHistory';

// Declare the electronAPI on window
declare global {
  interface Window {
    electronAPI: ControlAPI;
  }
}

const STATUS_TEXT: Record<TranscriptionState, string> = {
  idle: 'Ready',
  starting: 'Starting...',
  active: 'Transcribing',
  stopping: 'Stopping...',
};

interface DiagnosticsData {
  platform: string;
  transcriptionState: string;
  deepgram: {
    connectionState: string;
    lastError: string | null;
    audioChunksSent: number;
    audioBytesSent: number;
    transcriptsReceived: number;
    lastTranscriptTime: number | null;
    keepAlivesSent: number;
  } | null;
  audio: {
    chunksReceived: number;
    bytesReceived: number;
    chunksSentToDeepgram: number;
    lastChunkTime: number;
    systemAudioProcRunning: boolean;
    systemAudioProcPid: number | null;
  };
}

export function ControlPanel(): React.ReactElement {
  const [state, setState] = useState<TranscriptionState>('idle');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [gladiaApiKeyInput, setGladiaApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const stopCaptureRef = useRef<(() => void) | null>(null);
  const diagnosticsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { startCapture, stopCapture } = useSystemAudio({
    onError: (err) => setError(err),
  });

  // Store stopCapture in ref so handleToggle can access latest version
  useEffect(() => {
    stopCaptureRef.current = stopCapture;
  }, [stopCapture]);

  // Load initial state and settings
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [currentState, currentSettings] = await Promise.all([
          window.electronAPI.getState(),
          window.electronAPI.getSettings(),
        ]);
        setState(currentState);
        setSettings(currentSettings);
        setApiKeyInput(currentSettings.deepgramApiKey || '');
        setGladiaApiKeyInput(currentSettings.gladiaApiKey || '');
      } catch (err) {
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();

    // Subscribe to state changes
    window.electronAPI.onStateChanged((newState) => {
      setState(newState);
    });

    window.electronAPI.onError((errorMsg) => {
      setError(errorMsg);
    });

    return () => {
      window.electronAPI.removeAllListeners();
      if (diagnosticsIntervalRef.current) {
        clearInterval(diagnosticsIntervalRef.current);
      }
    };
  }, []);

  // Poll diagnostics when active or when diagnostics panel is shown
  useEffect(() => {
    const fetchDiagnostics = async () => {
      try {
        const data = await window.electronAPI.getDiagnostics();
        setDiagnostics(data);
      } catch (err) {
        console.error('Failed to fetch diagnostics:', err);
      }
    };

    if (showDiagnostics || state === 'active') {
      fetchDiagnostics();
      diagnosticsIntervalRef.current = setInterval(fetchDiagnostics, 1000);
    } else {
      if (diagnosticsIntervalRef.current) {
        clearInterval(diagnosticsIntervalRef.current);
        diagnosticsIntervalRef.current = null;
      }
    }

    return () => {
      if (diagnosticsIntervalRef.current) {
        clearInterval(diagnosticsIntervalRef.current);
      }
    };
  }, [showDiagnostics, state]);

  const handleToggle = useCallback(async () => {
    setError(null);

    if (state === 'active') {
      // Stop
      stopCaptureRef.current?.();
      const result = await window.electronAPI.stopTranscription();
      if (!result.success) {
        setError('Failed to stop transcription');
      }
    } else if (state === 'idle') {
      // Start
      const result = await window.electronAPI.startTranscription();
      if (!result.success) {
        setError(result.error || 'Failed to start transcription');
        return;
      }

      // Start audio capture
      const captureStarted = await startCapture();
      if (!captureStarted) {
        await window.electronAPI.stopTranscription();
        // Error is set by onError callback
      }
    }
  }, [state, startCapture]);

  const handleLanguageChange = useCallback(
    async (language: SupportedLanguage) => {
      if (!settings) return;

      const updated = await window.electronAPI.updateSettings({ language });
      setSettings(updated);
    },
    [settings]
  );

  const handleProviderChange = useCallback(
    async (provider: TranscriptionProvider) => {
      if (!settings) return;

      const updated = await window.electronAPI.updateSettings({ transcriptionProvider: provider });
      setSettings(updated);
    },
    [settings]
  );

  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(e.target.value);
  }, []);

  const handleApiKeySave = useCallback(async () => {
    if (!settings) return;

    const updated = await window.electronAPI.updateSettings({ deepgramApiKey: apiKeyInput });
    setSettings(updated);
    setError(null);
  }, [settings, apiKeyInput]);

  const handleGladiaApiKeySave = useCallback(async () => {
    if (!settings) return;

    const updated = await window.electronAPI.updateSettings({ gladiaApiKey: gladiaApiKeyInput });
    setSettings(updated);
    setError(null);
  }, [settings, gladiaApiKeyInput]);

  if (isLoading || !settings) {
    return (
      <div className="control-panel">
        <div className="header">
          <h1>Language Agent</h1>
          <p className="subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  const isTransitioning = state === 'starting' || state === 'stopping';
  const isActive = state === 'active';
  const provider = settings.transcriptionProvider || 'deepgram';
  const hasApiKey = provider === 'deepgram' ? !!settings.deepgramApiKey : !!settings.gladiaApiKey;

  return (
    <div className="control-panel">
      <div className="header">
        <h1>Language Agent</h1>
        <p className="subtitle">Real-Time Subtitles for Language Learning</p>
      </div>

      {/* API Key Section */}
      {!hasApiKey && (
        <div className="api-key-section">
          <div className="api-key-warning">
            <span className="warning-icon">⚠️</span>
            <span>{PROVIDER_NAMES[provider]} API key required</span>
          </div>
        </div>
      )}

      {/* Status Section */}
      <div className="status-section">
        <div className="status-indicator">
          <span className={`status-dot ${state}`} />
          <span className="status-text">{STATUS_TEXT[state]}</span>
        </div>

        <button
          className={`toggle-button ${isActive ? 'stop' : 'start'}`}
          onClick={handleToggle}
          disabled={isTransitioning || !hasApiKey}
        >
          {isActive ? (
            <>
              <StopIcon /> Stop Transcription
            </>
          ) : (
            <>
              <PlayIcon /> Start Transcription
            </>
          )}
        </button>

        {error && <div className="error-message">{error}</div>}

        <button
          className="history-button"
          onClick={() => setShowHistory(true)}
        >
          <HistoryIcon /> View Transcript History
        </button>
      </div>

      {/* Settings Section */}
      <div className="settings-section">
        <div className="settings-group">
          <h3>API Configuration</h3>
          <div className="setting-row">
            <span className="setting-label">Provider</span>
            <div className="select-wrapper">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as TranscriptionProvider)}
                disabled={isActive}
              >
                {Object.entries(PROVIDER_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {provider === 'deepgram' && (
            <>
              <div className="setting-row api-key-row">
                <span className="setting-label">Deepgram API Key</span>
                <div className="api-key-input-wrapper">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={handleApiKeyChange}
                    placeholder="Enter your Deepgram API key"
                    className="api-key-input"
                    disabled={isActive}
                  />
                  <button
                    className="api-key-toggle"
                    onClick={() => setShowApiKey(!showApiKey)}
                    type="button"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              {apiKeyInput !== settings.deepgramApiKey && (
                <button className="save-api-key-button" onClick={handleApiKeySave}>
                  Save API Key
                </button>
              )}
            </>
          )}

          {provider === 'gladia' && (
            <>
              <div className="setting-row api-key-row">
                <span className="setting-label">Gladia API Key</span>
                <div className="api-key-input-wrapper">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={gladiaApiKeyInput}
                    onChange={(e) => setGladiaApiKeyInput(e.target.value)}
                    placeholder="Enter your Gladia API key"
                    className="api-key-input"
                    disabled={isActive}
                  />
                  <button
                    className="api-key-toggle"
                    onClick={() => setShowApiKey(!showApiKey)}
                    type="button"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              {gladiaApiKeyInput !== settings.gladiaApiKey && (
                <button className="save-api-key-button" onClick={handleGladiaApiKeySave}>
                  Save API Key
                </button>
              )}
            </>
          )}
        </div>

        <div className="settings-group">
          <h3>Language</h3>
          <div className="setting-row">
            <span className="setting-label">Target Language</span>
            <div className="select-wrapper">
              <select
                value={settings.language}
                onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                disabled={isActive}
              >
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <h3>Shortcuts</h3>
          <div className="setting-row">
            <span className="setting-label">Toggle Transcription</span>
            <span className="shortcut-key">{formatShortcut(settings.toggleShortcut)}</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">Show/Hide Overlay</span>
            <span className="shortcut-key">{formatShortcut(settings.showHideShortcut)}</span>
          </div>
        </div>

        {/* Diagnostics Section */}
        <div className="settings-group">
          <h3>
            Diagnostics
            <button
              className="diagnostics-toggle"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              style={{ marginLeft: '10px', fontSize: '12px' }}
            >
              {showDiagnostics ? 'Hide' : 'Show'}
            </button>
          </h3>

          {showDiagnostics && diagnostics && (
            <div className="diagnostics-panel" style={{ fontSize: '12px', fontFamily: 'monospace' }}>
              <div className="diagnostics-section">
                <strong>System:</strong>
                <div>Platform: {diagnostics.platform}</div>
                <div>State: {diagnostics.transcriptionState}</div>
              </div>

              <div className="diagnostics-section" style={{ marginTop: '10px' }}>
                <strong>Audio Capture:</strong>
                <div>Process Running: {diagnostics.audio.systemAudioProcRunning ? '✓ Yes' : '✗ No'}</div>
                <div>Process PID: {diagnostics.audio.systemAudioProcPid || 'N/A'}</div>
                <div>Chunks Received: {diagnostics.audio.chunksReceived}</div>
                <div>Bytes Received: {(diagnostics.audio.bytesReceived / 1024).toFixed(1)} KB</div>
                <div>Chunks Sent: {diagnostics.audio.chunksSentToDeepgram}</div>
                <div>Last Chunk: {diagnostics.audio.lastChunkTime ? new Date(diagnostics.audio.lastChunkTime).toLocaleTimeString() : 'Never'}</div>
              </div>

              {diagnostics.deepgram && (
                <div className="diagnostics-section" style={{ marginTop: '10px' }}>
                  <strong>{PROVIDER_NAMES[provider]} Connection:</strong>
                  <div>
                    State:{' '}
                    <span style={{ color: diagnostics.deepgram.connectionState === 'connected' ? '#4caf50' : diagnostics.deepgram.connectionState === 'error' ? '#f44336' : '#ff9800' }}>
                      {diagnostics.deepgram.connectionState}
                    </span>
                  </div>
                  {diagnostics.deepgram.lastError && (
                    <div style={{ color: '#f44336' }}>Error: {diagnostics.deepgram.lastError}</div>
                  )}
                  <div>Audio Chunks Sent: {diagnostics.deepgram.audioChunksSent}</div>
                  <div>Audio Bytes Sent: {(diagnostics.deepgram.audioBytesSent / 1024).toFixed(1)} KB</div>
                  <div>Transcripts Received: {diagnostics.deepgram.transcriptsReceived}</div>
                  {diagnostics.deepgram.keepAlivesSent !== undefined && (
                    <div>KeepAlives Sent: {diagnostics.deepgram.keepAlivesSent}</div>
                  )}
                  <div>Last Transcript: {diagnostics.deepgram.lastTranscriptTime ? new Date(diagnostics.deepgram.lastTranscriptTime).toLocaleTimeString() : 'Never'}</div>
                </div>
              )}

              {!diagnostics.deepgram && state === 'active' && (
                <div style={{ color: '#f44336', marginTop: '10px' }}>
                  Warning: No transcription service data available
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="footer">
        <p>v1.0.0 - Phase 1: Same-Language Subtitles</p>
      </div>

      {showHistory && (
        <TranscriptHistory onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

// Helper function to format keyboard shortcuts
function formatShortcut(shortcut: string): string {
  const isMac = navigator.userAgent.includes('Mac');
  return shortcut
    .replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl')
    .replace('+', ' + ');
}

// Simple SVG Icons
function PlayIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

function HistoryIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
