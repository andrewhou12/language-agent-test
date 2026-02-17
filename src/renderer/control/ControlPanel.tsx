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

declare global {
  interface Window {
    electronAPI: ControlAPI;
  }
}

const STATUS_CONFIG: Record<TranscriptionState, { text: string; color: string }> = {
  idle: { text: 'Ready to transcribe', color: 'gray' },
  starting: { text: 'Connecting...', color: 'yellow' },
  active: { text: 'Live', color: 'green' },
  stopping: { text: 'Stopping...', color: 'yellow' },
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
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const stopCaptureRef = useRef<(() => void) | null>(null);
  const diagnosticsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { startCapture, stopCapture } = useSystemAudio({
    onError: (err) => setError(err),
  });

  useEffect(() => {
    stopCaptureRef.current = stopCapture;
  }, [stopCapture]);

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

  useEffect(() => {
    const fetchDiagnostics = async () => {
      try {
        const data = await window.electronAPI.getDiagnostics();
        setDiagnostics(data);
      } catch (err) {
        console.error('Failed to fetch diagnostics:', err);
      }
    };

    if (expandedSection === 'diagnostics' || state === 'active') {
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
  }, [expandedSection, state]);

  const handleToggle = useCallback(async () => {
    setError(null);

    if (state === 'active') {
      stopCaptureRef.current?.();
      const result = await window.electronAPI.stopTranscription();
      if (!result.success) {
        setError('Failed to stop transcription');
      }
    } else if (state === 'idle') {
      const result = await window.electronAPI.startTranscription();
      if (!result.success) {
        setError(result.error || 'Failed to start transcription');
        return;
      }

      const captureStarted = await startCapture();
      if (!captureStarted) {
        await window.electronAPI.stopTranscription();
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

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  if (isLoading || !settings) {
    return (
      <div className="app-container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  const isTransitioning = state === 'starting' || state === 'stopping';
  const isActive = state === 'active';
  const provider = settings.transcriptionProvider || 'deepgram';
  const hasApiKey = provider === 'deepgram' ? !!settings.deepgramApiKey : !!settings.gladiaApiKey;
  const statusConfig = STATUS_CONFIG[state];

  return (
    <div className="app-container">
      {/* Hero Section */}
      <div className="hero-section">
        <div className="brand">
          <div className="brand-icon">
            <WaveformIcon />
          </div>
          <div className="brand-text">
            <h1>Language Agent</h1>
            <p>Real-time multilingual transcription</p>
          </div>
        </div>

        {/* Main Action */}
        <div className="action-card">
          <div className="status-badge" data-status={statusConfig.color}>
            <span className="status-dot" />
            <span>{statusConfig.text}</span>
          </div>

          <button
            className={`primary-button ${isActive ? 'active' : ''}`}
            onClick={handleToggle}
            disabled={isTransitioning || !hasApiKey}
          >
            {isActive ? (
              <>
                <StopIcon />
                <span>Stop Transcription</span>
              </>
            ) : (
              <>
                <MicIcon />
                <span>Start Transcription</span>
              </>
            )}
          </button>

          {!hasApiKey && (
            <div className="setup-hint">
              <KeyIcon />
              <span>Add your {PROVIDER_NAMES[provider]} API key below to get started</span>
            </div>
          )}

          {error && (
            <div className="error-toast">
              <span>{error}</span>
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}
        </div>

        {/* Quick Stats when active */}
        {isActive && diagnostics?.deepgram && (
          <div className="live-stats">
            <div className="stat">
              <span className="stat-value">{diagnostics.deepgram.transcriptsReceived}</span>
              <span className="stat-label">Transcripts</span>
            </div>
            <div className="stat">
              <span className="stat-value">{(diagnostics.deepgram.audioBytesSent / 1024).toFixed(0)}KB</span>
              <span className="stat-label">Audio Sent</span>
            </div>
            <div className="stat">
              <span className="stat-value">{diagnostics.deepgram.connectionState}</span>
              <span className="stat-label">Status</span>
            </div>
          </div>
        )}
      </div>

      {/* Settings Sections */}
      <div className="settings-container">
        {/* Provider & API Key */}
        <div className={`settings-card ${expandedSection === 'api' ? 'expanded' : ''}`}>
          <button className="card-header" onClick={() => toggleSection('api')}>
            <div className="card-header-left">
              <SettingsIcon />
              <span>API Configuration</span>
            </div>
            <ChevronIcon expanded={expandedSection === 'api'} />
          </button>

          {expandedSection === 'api' && (
            <div className="card-content">
              <div className="field-group">
                <label>Provider</label>
                <div className="provider-toggle">
                  {Object.entries(PROVIDER_NAMES).map(([code, name]) => (
                    <button
                      key={code}
                      className={`provider-option ${provider === code ? 'selected' : ''}`}
                      onClick={() => handleProviderChange(code as TranscriptionProvider)}
                      disabled={isActive}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <label>{PROVIDER_NAMES[provider]} API Key</label>
                <div className="input-with-button">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={provider === 'deepgram' ? apiKeyInput : gladiaApiKeyInput}
                    onChange={(e) => provider === 'deepgram' ? setApiKeyInput(e.target.value) : setGladiaApiKeyInput(e.target.value)}
                    placeholder={`Enter your ${PROVIDER_NAMES[provider]} API key`}
                    disabled={isActive}
                  />
                  <button
                    className="icon-button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    type="button"
                  >
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {((provider === 'deepgram' && apiKeyInput !== settings.deepgramApiKey) ||
                  (provider === 'gladia' && gladiaApiKeyInput !== settings.gladiaApiKey)) && (
                  <button
                    className="save-button"
                    onClick={provider === 'deepgram' ? handleApiKeySave : handleGladiaApiKeySave}
                  >
                    Save API Key
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Language Settings */}
        <div className={`settings-card ${expandedSection === 'language' ? 'expanded' : ''}`}>
          <button className="card-header" onClick={() => toggleSection('language')}>
            <div className="card-header-left">
              <GlobeIcon />
              <span>Language</span>
            </div>
            <div className="card-header-right">
              <span className="current-value">{LANGUAGE_NAMES[settings.language]}</span>
              <ChevronIcon expanded={expandedSection === 'language'} />
            </div>
          </button>

          {expandedSection === 'language' && (
            <div className="card-content">
              <div className="language-grid">
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <button
                    key={code}
                    className={`language-option ${settings.language === code ? 'selected' : ''}`}
                    onClick={() => handleLanguageChange(code as SupportedLanguage)}
                    disabled={isActive}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Shortcuts */}
        <div className={`settings-card ${expandedSection === 'shortcuts' ? 'expanded' : ''}`}>
          <button className="card-header" onClick={() => toggleSection('shortcuts')}>
            <div className="card-header-left">
              <KeyboardIcon />
              <span>Keyboard Shortcuts</span>
            </div>
            <ChevronIcon expanded={expandedSection === 'shortcuts'} />
          </button>

          {expandedSection === 'shortcuts' && (
            <div className="card-content">
              <div className="shortcut-row">
                <span>Toggle Transcription</span>
                <kbd>{formatShortcut(settings.toggleShortcut)}</kbd>
              </div>
              <div className="shortcut-row">
                <span>Show/Hide Overlay</span>
                <kbd>{formatShortcut(settings.showHideShortcut)}</kbd>
              </div>
            </div>
          )}
        </div>

        {/* Diagnostics */}
        <div className={`settings-card ${expandedSection === 'diagnostics' ? 'expanded' : ''}`}>
          <button className="card-header" onClick={() => toggleSection('diagnostics')}>
            <div className="card-header-left">
              <ChartIcon />
              <span>Diagnostics</span>
            </div>
            <ChevronIcon expanded={expandedSection === 'diagnostics'} />
          </button>

          {expandedSection === 'diagnostics' && diagnostics && (
            <div className="card-content diagnostics-content">
              <div className="diagnostics-grid">
                <div className="diagnostics-item">
                  <span className="diagnostics-label">Platform</span>
                  <span className="diagnostics-value">{diagnostics.platform}</span>
                </div>
                <div className="diagnostics-item">
                  <span className="diagnostics-label">State</span>
                  <span className="diagnostics-value">{diagnostics.transcriptionState}</span>
                </div>
                <div className="diagnostics-item">
                  <span className="diagnostics-label">Audio Process</span>
                  <span className={`diagnostics-value ${diagnostics.audio.systemAudioProcRunning ? 'success' : ''}`}>
                    {diagnostics.audio.systemAudioProcRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <div className="diagnostics-item">
                  <span className="diagnostics-label">Chunks Received</span>
                  <span className="diagnostics-value">{diagnostics.audio.chunksReceived}</span>
                </div>
                {diagnostics.deepgram && (
                  <>
                    <div className="diagnostics-item">
                      <span className="diagnostics-label">Connection</span>
                      <span className={`diagnostics-value ${diagnostics.deepgram.connectionState === 'connected' ? 'success' : ''}`}>
                        {diagnostics.deepgram.connectionState}
                      </span>
                    </div>
                    <div className="diagnostics-item">
                      <span className="diagnostics-label">Bytes Sent</span>
                      <span className="diagnostics-value">{(diagnostics.deepgram.audioBytesSent / 1024).toFixed(1)} KB</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* History Button */}
        <button className="history-card" onClick={() => setShowHistory(true)}>
          <HistoryIcon />
          <span>View Transcript History</span>
          <ChevronRightIcon />
        </button>
      </div>

      {/* Footer */}
      <div className="app-footer">
        <span>Language Agent v1.0</span>
      </div>

      {showHistory && (
        <TranscriptHistory onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

function formatShortcut(shortcut: string): string {
  const isMac = navigator.userAgent.includes('Mac');
  return shortcut
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('+', ' ');
}

// Icons
function WaveformIcon(): React.ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18M8 8v8M4 10v4M16 6v12M20 9v6" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function KeyIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function SettingsIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function GlobeIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function KeyboardIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
    </svg>
  );
}

function ChartIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" />
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

function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronRightIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function EyeIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
