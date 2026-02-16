/**
 * Preload script for Control Panel window
 *
 * Exposes a safe, limited API to the renderer process
 * using contextBridge for secure IPC communication.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings, TranscriptionState, IPC_CHANNELS } from '../shared/types';

// Define the API exposed to the renderer
export interface ControlAPI {
  // Transcription controls
  startTranscription: () => Promise<{ success: boolean; error?: string }>;
  stopTranscription: () => Promise<{ success: boolean }>;

  // Audio
  getDesktopSources: () => Promise<Electron.DesktopCapturerSource[]>;

  // System audio capture
  startSystemAudio: () => Promise<{ success: boolean; platform?: string; error?: string }>;
  stopSystemAudio: () => Promise<{ success: boolean }>;
  streamAudioChunk: (base64Data: string) => Promise<{ success: boolean }>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

  // State
  getState: () => Promise<TranscriptionState>;

  // Diagnostics
  getDiagnostics: () => Promise<any>;

  // Event listeners
  onStateChanged: (callback: (state: TranscriptionState) => void) => void;
  onError: (callback: (error: string) => void) => void;

  // Cleanup
  removeAllListeners: () => void;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Transcription controls
  startTranscription: () => ipcRenderer.invoke(IPC_CHANNELS.START_TRANSCRIPTION),
  stopTranscription: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_TRANSCRIPTION),

  // Audio
  getDesktopSources: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DESKTOP_SOURCES),

  // System audio capture
  startSystemAudio: () => ipcRenderer.invoke(IPC_CHANNELS.START_SYSTEM_AUDIO),
  stopSystemAudio: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_SYSTEM_AUDIO),
  streamAudioChunk: (base64Data: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STREAM_AUDIO_CHUNK, base64Data),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),

  // State
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_STATE),

  // Diagnostics
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DIAGNOSTICS),

  // Event listeners
  onStateChanged: (callback: (state: TranscriptionState) => void) => {
    ipcRenderer.on(IPC_CHANNELS.STATE_CHANGED, (_event, state) => callback(state));
  },

  onError: (callback: (error: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.ERROR_OCCURRED, (_event, error) => callback(error));
  },

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_CHANGED);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.ERROR_OCCURRED);
  },
} as ControlAPI);
