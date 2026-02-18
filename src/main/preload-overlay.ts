/**
 * Preload script for Overlay window
 *
 * Exposes a minimal API for receiving transcription updates
 * and style changes from the main process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { TranscriptionResult, OverlayStyle, BubbleState, OverlayMode, AppSettings, IPC_CHANNELS } from '../shared/types';

// Define the API exposed to the overlay renderer
export interface OverlayAPI {
  // Event listeners
  onTranscriptionUpdate: (callback: (result: TranscriptionResult) => void) => void;
  onClearTranscription: (callback: () => void) => void;
  onStyleUpdate: (callback: (style: OverlayStyle) => void) => void;
  onOverlayModeChange: (callback: (mode: OverlayMode) => void) => void;

  // Settings
  getSettings: () => Promise<AppSettings>;

  // Overlay mode
  getOverlayMode: () => Promise<OverlayMode>;

  // Bubble state
  getBubbleState: () => Promise<BubbleState>;
  saveBubbleState: (state: BubbleState) => Promise<BubbleState>;
  toggleCollapse: () => Promise<BubbleState>;

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

  onOverlayModeChange: (callback: (mode: OverlayMode) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SET_OVERLAY_MODE, (_event, mode) => callback(mode));
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),

  // Overlay mode
  getOverlayMode: () => ipcRenderer.invoke(IPC_CHANNELS.GET_OVERLAY_MODE),

  // Bubble state
  getBubbleState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BUBBLE_STATE),
  saveBubbleState: (state: BubbleState) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_BUBBLE_STATE, state),
  toggleCollapse: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_BUBBLE_COLLAPSE),

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TRANSCRIPTION_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.CLEAR_TRANSCRIPTION);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_OVERLAY_STYLE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.SET_OVERLAY_MODE);
  },
} as OverlayAPI);
