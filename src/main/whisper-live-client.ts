/**
 * WhisperLive WebSocket Client
 *
 * Connects to a WhisperLive server for real-time speech-to-text transcription.
 * Protocol: WebSocket with binary audio (Float32, 16kHz, mono) and JSON responses.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface WhisperLiveConfig {
  host: string;
  port: number;
  language?: string;
  model?: string;
  useVad?: boolean;
  task?: 'transcribe' | 'translate';
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  completed: boolean;
}

interface ServerMessage {
  uid: string;
  message?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  language_prob?: number;
  status?: 'WAIT' | 'ERROR' | 'WARNING';
  backend?: string;
}

export class WhisperLiveClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WhisperLiveConfig;
  private uid: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(config: WhisperLiveConfig) {
    super();
    this.config = {
      useVad: true,
      model: 'small',
      task: 'transcribe',
      ...config,
    };
    this.uid = this.generateUid();
  }

  private generateUid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.config.host}:${this.config.port}`;
      console.log('Connecting to WhisperLive server:', url);

      try {
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.on('open', () => {
          console.log('WebSocket connected, sending config...');
          this.sendInitialConfig();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.log('WebSocket closed:', code, reason.toString());
          this.isConnected = false;
          this.emit('disconnected', { code, reason: reason.toString() });
          this.handleReconnect();
        });

        // Set up ready handler
        this.once('ready', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        });

        // Timeout for connection (longer timeout to allow model loading)
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection timeout - server may still be loading the model'));
          }
        }, 120000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private sendInitialConfig(): void {
    const config = {
      uid: this.uid,
      language: this.config.language || null,
      task: this.config.task,
      model: this.config.model,
      use_vad: this.config.useVad,
    };

    console.log('Sending config:', config);
    this.ws?.send(JSON.stringify(config));
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      console.log('WhisperLive raw message:', data.toString().substring(0, 200));
      const message: ServerMessage = JSON.parse(data.toString());

      if (message.message === 'SERVER_READY') {
        console.log('Server ready:', message);
        this.emit('ready', message);
        return;
      }

      if (message.status === 'WAIT') {
        console.log('Server busy, wait time:', message.message);
        this.emit('waiting', message.message);
        return;
      }

      if (message.status === 'ERROR') {
        console.error('Server error:', message.message);
        this.emit('error', new Error(message.message));
        return;
      }

      if (message.segments && message.segments.length > 0) {
        this.emit('transcription', message.segments);
      }

      if (message.language) {
        this.emit('language-detected', {
          language: message.language,
          probability: message.language_prob,
        });
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('connection-failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      console.error('Reconnect failed:', error);
    }
  }

  /**
   * Send audio data to the server as Float32
   * @param audioData Float32Array of audio samples (16kHz, mono)
   */
  sendAudio(audioData: Float32Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Create proper Buffer from Float32Array with explicit binary flag
      const buffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      this.ws.send(buffer, { binary: true });
    }
  }

  /**
   * Send audio data as Int16 PCM bytes (recommended for non-Python clients)
   * @param audioData Int16Array of audio samples (16kHz, mono)
   */
  sendAudioInt16(audioData: Int16Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send raw Int16 bytes directly with explicit binary flag
      const buffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      this.ws.send(buffer, { binary: true });
    }
  }

  /**
   * Signal end of audio stream
   */
  endStream(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send('END_OF_AUDIO');
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Check if connected to server
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}
