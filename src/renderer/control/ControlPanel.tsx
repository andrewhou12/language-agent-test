import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppSettings,
  TranscriptionState,
  SupportedLanguage,
  LANGUAGE_NAMES,
} from '../../shared/types';
import type { ControlAPI } from '../../main/preload-control';
import { useSystemAudio } from './useSystemAudio';

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

export function ControlPanel(): React.ReactElement {
  const [state, setState] = useState<TranscriptionState>('idle');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const stopCaptureRef = useRef<(() => void) | null>(null);

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
        setApiKeyInput(currentSettings.openaiApiKey || '');
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
    };
  }, []);

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

  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(e.target.value);
  }, []);

  const handleApiKeySave = useCallback(async () => {
    if (!settings) return;

    const updated = await window.electronAPI.updateSettings({ openaiApiKey: apiKeyInput });
    setSettings(updated);
    setError(null);
  }, [settings, apiKeyInput]);

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
  const hasApiKey = !!settings.openaiApiKey;

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
            <span>OpenAI API key required</span>
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
      </div>

      {/* Settings Section */}
      <div className="settings-section">
        <div className="settings-group">
          <h3>API Configuration</h3>
          <div className="setting-row api-key-row">
            <span className="setting-label">OpenAI API Key</span>
            <div className="api-key-input-wrapper">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={handleApiKeyChange}
                placeholder="sk-..."
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
          {apiKeyInput !== settings.openaiApiKey && (
            <button className="save-api-key-button" onClick={handleApiKeySave}>
              Save API Key
            </button>
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
      </div>

      <div className="footer">
        <p>v1.0.0 - Phase 1: Same-Language Subtitles</p>
      </div>
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
