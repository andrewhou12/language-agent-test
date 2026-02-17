# Node Live Transcription - Architecture & Data Flow

## Overview

This is a **Deepgram Live Transcription Demo Application** - a full-stack web application that provides real-time speech-to-text transcription using the Deepgram API. Users speak into their microphone and see live transcription results displayed in the browser.

**Tech Stack:**
- **Backend:** Node.js (Express + WebSocket)
- **Frontend:** Vanilla HTML/CSS/JavaScript (Vite bundled)
- **Deployment:** Docker + Fly.io with Caddy reverse proxy

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend (Port 8080)                   │
│  HTML + CSS + JavaScript (Vite bundled)                 │
│  - Deepgram branded UI (@deepgram/styles)               │
│  - Microphone access via Web Audio API                  │
│  - WebSocket client for real-time streaming             │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    HTTP │ Session & Metadata   │ WebSocket (Binary Audio)
         │                       │
┌────────▼───────────────────────▼────────────────────────┐
│            Backend API Server (Port 8081)               │
│  Node.js + Express + WebSocket Server                   │
│                                                         │
│  Endpoints:                                             │
│  - GET /api/session       → JWT token generation        │
│  - GET /api/metadata      → Project metadata (TOML)     │
│  - WS  /api/live-transcription → Deepgram proxy        │
└────────┬────────────────────────────────────────────────┘
         │
         │ Bidirectional WebSocket Proxy
         │
┌────────▼────────────────────────────────────────────────┐
│              Deepgram STT API                           │
│        wss://api.deepgram.com/v1/listen                 │
│  - Accepts PCM16 audio stream                           │
│  - Returns JSON transcription results                   │
└─────────────────────────────────────────────────────────┘
```

### Production Deployment Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Fly.io Container                                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Caddy Reverse Proxy (Port 8080 - Public)          │  │
│  │  - Serves static frontend from /app/frontend/dist  │  │
│  │  - Proxies /api/* to backend                       │  │
│  │  - Rate limiting per IP                            │  │
│  │    - /api/session: 5 req/min                       │  │
│  │    - /api/*: 120 req/min                           │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │                                   │
│  ┌────────────────────▼───────────────────────────────┐  │
│  │  Node.js Backend (Port 8081 - localhost only)      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Connection Establishment

```
User loads page (http://localhost:8080)
    │
    ├─► Frontend fetches GET /api/metadata
    │   └─► Returns project title, description from deepgram.toml
    │
    └─► User clicks "Connect" button
        │
        ├─► Frontend requests JWT: GET /api/session
        │   └─► Backend generates signed JWT (1h expiry)
        │       └─► Returns { token: "eyJhbGc..." }
        │
        ├─► Frontend requests microphone access
        │   └─► Browser shows permission dialog
        │       └─► AudioContext created (16kHz sample rate)
        │
        └─► Frontend initiates WebSocket connection
            URL: wss://host/api/live-transcription?model=nova-3&language=en
            Auth: Subprotocol = "access_token.<jwt>"
                │
                └─► Backend validates JWT
                    └─► Backend opens proxy connection to Deepgram
```

### 2. Audio Streaming Flow

```
┌──────────────┐    ┌───────────────┐    ┌────────────┐    ┌──────────┐
│  Microphone  │───►│ AudioContext  │───►│ ScriptProc │───►│ PCM16    │
│              │    │   (16kHz)     │    │  (4096)    │    │ Convert  │
└──────────────┘    └───────────────┘    └────────────┘    └────┬─────┘
                                                                │
                    Binary ArrayBuffer (4096 samples = ~256ms)  │
                                                                ▼
┌──────────────┐    ┌───────────────┐    ┌────────────┐    ┌──────────┐
│  Display in  │◄───│   Parse JSON  │◄───│  Backend   │◄───│ Deepgram │
│  Browser UI  │    │  Transcript   │    │   Proxy    │    │   API    │
└──────────────┘    └───────────────┘    └────────────┘    └──────────┘
```

### 3. Message Formats

**Client → Backend → Deepgram:**
- Binary PCM16 audio
- 16kHz sample rate, mono channel
- 4096 samples per chunk (~256ms)

**Deepgram → Backend → Client:**
```json
{
  "type": "Results",
  "channel": {
    "alternatives": [
      {
        "transcript": "hello world",
        "confidence": 0.95
      }
    ]
  },
  "is_final": false,
  "speech_final": false
}
```

---

## Key Components

### Backend (`server.js`)

| Component | Responsibility |
|-----------|----------------|
| Express App | HTTP server, CORS, JSON parsing |
| `/api/session` | JWT token generation for auth |
| `/api/metadata` | Serve project metadata from TOML |
| WebSocket Server | Handle upgrade, JWT validation |
| Deepgram Proxy | Bidirectional message forwarding |
| Graceful Shutdown | 10s timeout for in-flight connections |

### Frontend (`frontend/`)

| File | Responsibility |
|------|----------------|
| `index.html` | UI structure with Deepgram branding |
| `main.js` | WebSocket client, audio capture, UI updates |
| `vite.config.js` | Build config, dev proxy to backend |

### Deployment (`deploy/`)

| File | Responsibility |
|------|----------------|
| `Dockerfile` | Multi-stage build (Caddy + Frontend + Backend) |
| `Caddyfile` | Reverse proxy config with rate limiting |
| `start.sh` | Container startup script |

---

## Authentication

### JWT Session Flow

1. Client requests `GET /api/session` (rate-limited: 5 req/min)
2. Backend generates JWT: `jwt.sign({ iat }, SESSION_SECRET, { expiresIn: '1h' })`
3. Frontend stores token in memory
4. WebSocket upgrade uses subprotocol: `access_token.<jwt>`
5. Backend validates token before accepting connection

### Deepgram API Authentication

- Backend holds `DEEPGRAM_API_KEY` (never exposed to frontend)
- Proxies requests with header: `Authorization: Token <key>`

---

## External Services

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| Deepgram STT API | Live transcription | API Key (backend only) |
| Fly.io | Hosting | FLY_API_TOKEN (CI/CD) |
| GitHub Actions | Deployment pipeline | GitHub secrets |

---

## Configuration

### Environment Variables

```bash
# Required
DEEPGRAM_API_KEY=<your-api-key>

# Optional
PORT=8081                    # Backend port (default: 8081)
HOST=0.0.0.0                 # Bind address (default: 0.0.0.0)
SESSION_SECRET=<random-hex>  # JWT secret (auto-generated if not set)
```

### Project Metadata (`deepgram.toml`)

Defines project title, description, author, tags displayed in the UI.

---

## Project Structure

```
node-live-transcription/
├── server.js                 # Backend entry point
├── package.json              # Backend dependencies
├── deepgram.toml             # Project metadata
├── fly.toml                  # Fly.io deployment config
├── Makefile                  # Development commands
├── .env                      # Configuration
├── deploy/
│   ├── Dockerfile            # Multi-stage Docker build
│   ├── Caddyfile             # Reverse proxy config
│   └── start.sh              # Container startup
├── frontend/                 # Git submodule
│   ├── index.html
│   ├── main.js
│   ├── vite.config.js
│   └── package.json
├── contracts/                # Git submodule (conformance tests)
└── .github/workflows/
    └── deploy.yml            # CI/CD pipeline
```

---

## Audio Processing Details

| Parameter | Value |
|-----------|-------|
| Sample Rate | 16 kHz |
| Channels | Mono (1) |
| Encoding | Linear PCM, Int16 |
| Chunk Size | 4096 samples (~256ms) |
| Features | Echo cancellation, noise suppression |

---

## Error Handling

- **WebSocket errors:** Close client with code 1011
- **Microphone access denied:** User-friendly alert
- **Session expired:** WebSocket close code 4401
- **Uncaught exceptions:** Graceful shutdown sequence (10s timeout)
