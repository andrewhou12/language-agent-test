/**
 * Preload script for Overlay window
 *
 * Exposes a minimal API for receiving transcription updates
 * and style changes from the main process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { TranscriptionResult, OverlayStyle, IPC_CHANNELS } from '../shared/types';

// Define the API exposed to the overlay renderer
export interface OverlayAPI {
  // Event listeners
  onTranscriptionUpdate: (callback: (result: TranscriptionResult) => void) => void;
  onClearTranscription: (callback: () => void) => void;
  onStyleUpdate: (callback: (style: OverlayStyle) => void) => void;

  // Cleanup
  removeAllListeners: () => void;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Event listeners
  onTranscriptionUpdate: (callback: (result: TranscriptionResult) => void) => {
    ipcRenderer.on(IPC_CHANNELS.TRANSCRIPTION_UPDATE, (_event, result) => callback(result));
  },

  onClearTranscription: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.CLEAR_TRANSCRIPTION, () => callback());
  },

  onStyleUpdate: (callback: (style: OverlayStyle) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_OVERLAY_STYLE, (_event, style) => callback(style));
  },

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TRANSCRIPTION_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.CLEAR_TRANSCRIPTION);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_OVERLAY_STYLE);
  },
} as OverlayAPI);
