# Language Agent

Real-time multilingual transcription desktop app for language learning. Captures system audio and displays live subtitles as an overlay, perfect for watching foreign language content with same-language subtitles.

## Features

- **Real-time transcription** - Live subtitles from any audio playing on your system
- **Multiple transcription providers**:
  - Deepgram (nova-3 model)
  - Gladia
  - Speechmatics (known for high-quality diarization)
- **Speaker diarization** - Color-coded speakers (Deepgram & Speechmatics)
- **Multiple languages** - Japanese, Korean, Chinese, Spanish, French, German, English, and auto-detect
- **Two overlay modes**:
  - **Floating Bubble** - Draggable, resizable, collapsible transcript window
  - **Classic Subtitles** - Traditional bottom-screen subtitles with fade animation
- **Transcript history** - Save and export past transcription sessions
- **Fullscreen support** - Overlay visible even in fullscreen applications
- **Keyboard shortcuts** - Quick toggle for transcription and overlay visibility

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the app:
   ```bash
   npm start
   ```

## Permissions

**macOS**: Requires Screen Recording permission to capture system audio. Grant access in System Preferences > Security & Privacy > Privacy > Screen Recording.

## Configuration

1. Select your transcription provider (Deepgram, Gladia, or Speechmatics)
2. Enter your API key for the selected provider
3. Choose your target language or use auto-detect
4. Enable speaker diarization if desired (Deepgram/Speechmatics)
5. Select overlay mode (Bubble or Subtitles)
6. Start transcription and play audio/video content

## API Keys

Get API keys from:
- Deepgram: https://console.deepgram.com
- Gladia: https://app.gladia.io
- Speechmatics: https://portal.speechmatics.com

## Tech Stack

- Electron
- React + TypeScript
- WebSocket streaming APIs
- Native macOS audio capture

## Development

```bash
npm run dev    # Development mode with hot reload
npm run build  # Build for production
npm start      # Build and run
```
