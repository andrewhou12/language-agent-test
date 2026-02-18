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
exports.IPC_CHANNELS = exports.MODEL_INFO = exports.PROVIDER_NAMES = exports.LANGUAGE_NAMES = exports.DEFAULT_SETTINGS = exports.DEFAULT_BUBBLE_STATE = exports.DEFAULT_OVERLAY_STYLE = exports.SPEAKER_COLORS = exports.TRANSLATION_DISPLAY_MODE_NAMES = exports.OVERLAY_MODE_NAMES = void 0;
exports.OVERLAY_MODE_NAMES = {
    bubble: 'Floating Bubble',
    subtitle: 'Classic Subtitles',
};
exports.TRANSLATION_DISPLAY_MODE_NAMES = {
    stacked: 'Stacked (Both)',
    original: 'Original Only',
    translation: 'Translation Only',
};
// Speaker colors for diarization display
exports.SPEAKER_COLORS = {
    0: '#60A5FA', // Blue
    1: '#34D399', // Green
    2: '#F472B6', // Pink
    3: '#FBBF24', // Yellow
    4: '#A78BFA', // Purple
    5: '#FB923C', // Orange
};
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
exports.DEFAULT_BUBBLE_STATE = {
    x: -1, // -1 means center
    y: -1, // -1 means lower-center (75% down screen)
    width: 320,
    height: 80,
    collapsed: false,
};
exports.DEFAULT_SETTINGS = {
    transcriptionProvider: 'deepgram',
    deepgramApiKey: '',
    gladiaApiKey: '',
    speechmaticsApiKey: '',
    whisperModel: 'base',
    language: 'auto',
    gpuAcceleration: true,
    chunkSize: 2,
    diarization: false,
    translationEnabled: false,
    translationTargetLanguage: 'en',
    translationDisplayMode: 'stacked',
    overlayMode: 'bubble',
    overlayStyle: exports.DEFAULT_OVERLAY_STYLE,
    bubbleState: exports.DEFAULT_BUBBLE_STATE,
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
    speechmatics: 'Speechmatics',
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
    // Overlay -> Main (bubble state)
    SAVE_BUBBLE_STATE: 'save-bubble-state',
    GET_BUBBLE_STATE: 'get-bubble-state',
    TOGGLE_BUBBLE_COLLAPSE: 'toggle-bubble-collapse',
    GET_OVERLAY_MODE: 'get-overlay-mode',
    SET_OVERLAY_MODE: 'set-overlay-mode',
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
  !*** ./src/main/preload-overlay.ts ***!
  \*************************************/

/**
 * Preload script for Overlay window
 *
 * Exposes a minimal API for receiving transcription updates
 * and style changes from the main process.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
const electron_1 = __webpack_require__(/*! electron */ "electron");
const types_1 = __webpack_require__(/*! ../shared/types */ "./src/shared/types.ts");
// Expose protected methods to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Event listeners
    onTranscriptionUpdate: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.TRANSCRIPTION_UPDATE, (_event, result) => callback(result));
    },
    onClearTranscription: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.CLEAR_TRANSCRIPTION, () => callback());
    },
    onStyleUpdate: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.UPDATE_OVERLAY_STYLE, (_event, style) => callback(style));
    },
    onOverlayModeChange: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.SET_OVERLAY_MODE, (_event, mode) => callback(mode));
    },
    // Settings
    getSettings: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_SETTINGS),
    // Overlay mode
    getOverlayMode: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_OVERLAY_MODE),
    // Bubble state
    getBubbleState: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_BUBBLE_STATE),
    saveBubbleState: (state) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SAVE_BUBBLE_STATE, state),
    toggleCollapse: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.TOGGLE_BUBBLE_COLLAPSE),
    // Cleanup
    removeAllListeners: () => {
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.TRANSCRIPTION_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.CLEAR_TRANSCRIPTION);
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.UPDATE_OVERLAY_STYLE);
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.SET_OVERLAY_MODE);
    },
});

})();

/******/ })()
;
//# sourceMappingURL=preload-overlay.js.map