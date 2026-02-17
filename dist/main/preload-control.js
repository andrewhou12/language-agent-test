/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/shared/types.ts"
/*!*****************************!*\
  !*** ./src/shared/types.ts ***!
  \*****************************/
(__unused_webpack_module, exports) {


// Shared type definitions for the Language Agent application
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.IPC_CHANNELS = exports.MODEL_INFO = exports.PROVIDER_NAMES = exports.LANGUAGE_NAMES = exports.DEFAULT_SETTINGS = exports.DEFAULT_OVERLAY_STYLE = void 0;
exports.DEFAULT_OVERLAY_STYLE = {
    position: 'bottom',
    fontFamily: 'system-ui, "Noto Sans CJK", sans-serif',
    fontSize: 24,
    fontWeight: 400,
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.7,
    textShadow: true,
    textOutline: false,
    maxLines: 2,
    displayDuration: 5,
};
exports.DEFAULT_SETTINGS = {
    transcriptionProvider: 'deepgram',
    deepgramApiKey: '',
    gladiaApiKey: '',
    whisperModel: 'base',
    language: 'auto',
    gpuAcceleration: true,
    chunkSize: 2,
    overlayStyle: exports.DEFAULT_OVERLAY_STYLE,
    toggleShortcut: 'CommandOrControl+Shift+S',
    showHideShortcut: 'CommandOrControl+Shift+H',
    autoStart: false,
    minimizeToTray: true,
};
exports.LANGUAGE_NAMES = {
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese (Mandarin)',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    en: 'English',
    auto: 'Auto-detect',
};
exports.PROVIDER_NAMES = {
    deepgram: 'Deepgram',
    gladia: 'Gladia',
};
exports.MODEL_INFO = {
    tiny: { size: '~75MB', speed: 'Fastest', accuracy: 'Good' },
    base: { size: '~150MB', speed: 'Fast', accuracy: 'Better' },
    small: { size: '~500MB', speed: 'Moderate', accuracy: 'Best' },
};
// IPC Channel names
exports.IPC_CHANNELS = {
    // Control -> Main
    START_TRANSCRIPTION: 'start-transcription',
    STOP_TRANSCRIPTION: 'stop-transcription',
    GET_SETTINGS: 'get-settings',
    UPDATE_SETTINGS: 'update-settings',
    GET_STATE: 'get-state',
    TRANSCRIBE_AUDIO: 'transcribe-audio',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
    // Audio capture
    START_SYSTEM_AUDIO: 'start-system-audio',
    STOP_SYSTEM_AUDIO: 'stop-system-audio',
    SYSTEM_AUDIO_DATA: 'system-audio-data',
    STREAM_AUDIO_CHUNK: 'stream-audio-chunk', // New: stream audio directly to Deepgram
    // Main -> Overlay
    TRANSCRIPTION_UPDATE: 'transcription-update',
    CLEAR_TRANSCRIPTION: 'clear-transcription',
    UPDATE_OVERLAY_STYLE: 'update-overlay-style',
    // Main -> Control
    STATE_CHANGED: 'state-changed',
    ERROR_OCCURRED: 'error-occurred',
    // Diagnostics
    GET_DIAGNOSTICS: 'get-diagnostics',
    // Transcript history
    GET_TRANSCRIPTS: 'get-transcripts',
    GET_TRANSCRIPT: 'get-transcript',
    DELETE_TRANSCRIPT: 'delete-transcript',
    EXPORT_TRANSCRIPT: 'export-transcript',
};


/***/ },

/***/ "electron"
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
(module) {

module.exports = require("electron");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
/*!*************************************!*\
  !*** ./src/main/preload-control.ts ***!
  \*************************************/

/**
 * Preload script for Control Panel window
 *
 * Exposes a safe, limited API to the renderer process
 * using contextBridge for secure IPC communication.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
const electron_1 = __webpack_require__(/*! electron */ "electron");
const types_1 = __webpack_require__(/*! ../shared/types */ "./src/shared/types.ts");
// Expose protected methods to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Transcription controls
    startTranscription: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.START_TRANSCRIPTION),
    stopTranscription: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.STOP_TRANSCRIPTION),
    // Audio
    getDesktopSources: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_DESKTOP_SOURCES),
    // System audio capture
    startSystemAudio: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.START_SYSTEM_AUDIO),
    stopSystemAudio: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.STOP_SYSTEM_AUDIO),
    streamAudioChunk: (base64Data) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.STREAM_AUDIO_CHUNK, base64Data),
    // Settings
    getSettings: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_SETTINGS),
    updateSettings: (settings) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.UPDATE_SETTINGS, settings),
    // State
    getState: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_STATE),
    // Diagnostics
    getDiagnostics: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_DIAGNOSTICS),
    // Transcript history
    getTranscripts: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_TRANSCRIPTS),
    getTranscript: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_TRANSCRIPT, id),
    deleteTranscript: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DELETE_TRANSCRIPT, id),
    exportTranscript: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.EXPORT_TRANSCRIPT, id),
    // Event listeners
    onStateChanged: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.STATE_CHANGED, (_event, state) => callback(state));
    },
    onError: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.ERROR_OCCURRED, (_event, error) => callback(error));
    },
    // Cleanup
    removeAllListeners: () => {
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.STATE_CHANGED);
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.ERROR_OCCURRED);
    },
});

})();

/******/ })()
;
//# sourceMappingURL=preload-control.js.map