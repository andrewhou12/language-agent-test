/**
 * Custom hook for capturing system audio
 *
 * Platform-specific implementations:
 * - macOS: Uses native Swift binary (SystemAudioDump) via IPC
 * - Windows: Uses Electron's WASAPI loopback via getDisplayMedia
 *
 * Setup required:
 * - macOS: Screen Recording permission + SystemAudioDump binary in assets/
 * - Windows: No special permissions needed
 */

import { useRef, useCallback, useEffect } from 'react';
import type { ControlAPI } from '../../main/preload-control';

declare global {
  interface Window {
    electronAPI: ControlAPI;
  }
}

// Audio format constants (matching main process)
const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;
const CHUNK_DURATION_MS = 2000; // Send for transcription every 2 seconds

interface UseSystemAudioOptions {
  onError?: (error: string) => void;
}

interface UseSystemAudioReturn {
  startCapture: () => Promise<boolean>;
  stopCapture: () => void;
  isCapturing: boolean;
}

export function useSystemAudio(options: UseSystemAudioOptions = {}): UseSystemAudioReturn {
  const { onError } = options;
  const isCapturingRef = useRef(false);
  const platformRef = useRef<string | null>(null);

  // Windows-specific refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Int16Array[]>([]);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // macOS audio data listener
  useEffect(() => {
    const handleMacOSAudioData = async (data: { data: string }) => {
      if (!isCapturingRef.current || platformRef.current !== 'darwin') return;

      // macOS sends pre-processed mono 16-bit PCM at 24kHz
      // Accumulate and send periodically
      const pcmData = base64ToInt16Array(data.data);
      audioBufferRef.current.push(pcmData);
    };

    window.electronAPI.onSystemAudioData(handleMacOSAudioData);

    return () => {
      // Cleanup handled by removeAllListeners
    };
  }, []);

  // Periodically send accumulated audio for transcription
  const startSendInterval = useCallback(() => {
    sendIntervalRef.current = setInterval(async () => {
      if (audioBufferRef.current.length === 0) return;

      // Combine all buffered audio
      const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
      const combined = new Int16Array(totalLength);
      let offset = 0;
      for (const chunk of audioBufferRef.current) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      audioBufferRef.current = [];

      // Check for silence (simple VAD)
      let maxAmp = 0;
      for (let i = 0; i < combined.length; i++) {
        const abs = Math.abs(combined[i]);
        if (abs > maxAmp) maxAmp = abs;
      }

      console.log('Audio max amplitude:', maxAmp, '(16-bit range: 0-32767)');

      // Skip if too quiet (threshold for 16-bit audio)
      // 100 is very conservative - should catch most speech
      if (maxAmp < 100) {
        console.log('Audio too quiet, skipping');
        return;
      }

      // Convert to base64 and send
      const base64Data = int16ArrayToBase64(combined);
      console.log('Sending audio for transcription, samples:', combined.length);

      try {
        const result = await window.electronAPI.sendAudioData(base64Data);
        if (result) {
          console.log('Transcription:', result.text);
        }
      } catch (error) {
        console.error('Transcription error:', error);
      }
    }, CHUNK_DURATION_MS);
  }, []);

  const stopSendInterval = useCallback(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    audioBufferRef.current = [];
  }, []);

  // Windows: Start capture using getDisplayMedia
  const startWindowsCapture = useCallback(async (): Promise<boolean> => {
    try {
      console.log('Starting Windows audio capture via getDisplayMedia...');

      // Request display media - Electron's handler provides loopback audio
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack) {
        onError?.('No audio track in loopback stream');
        return false;
      }

      console.log('Audio track:', audioTrack.label);
      mediaStreamRef.current = mediaStream;

      // Process with Web Audio API
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const float32Data = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(float32Data);
        audioBufferRef.current.push(int16Data);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Stop video tracks - we only need audio
      mediaStream.getVideoTracks().forEach((track) => track.stop());

      console.log('Windows audio capture started');
      return true;
    } catch (error) {
      console.error('Windows capture error:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to start capture');
      return false;
    }
  }, [onError]);

  const stopWindowsCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const startCapture = useCallback(async (): Promise<boolean> => {
    if (isCapturingRef.current) return false;

    try {
      // Ask main process to start system audio capture
      const result = await window.electronAPI.startSystemAudio();

      if (!result.success) {
        onError?.(result.error || 'Failed to start system audio capture');
        return false;
      }

      platformRef.current = result.platform || null;
      console.log('Platform:', platformRef.current);

      if (result.platform === 'darwin') {
        // macOS: Audio comes via IPC from native binary
        // Just start the send interval
        console.log('macOS audio capture started via native binary');
      } else if (result.platform === 'win32') {
        // Windows: Need to start renderer-side capture
        const success = await startWindowsCapture();
        if (!success) {
          await window.electronAPI.stopSystemAudio();
          return false;
        }
      } else {
        onError?.('Unsupported platform');
        return false;
      }

      isCapturingRef.current = true;
      startSendInterval();
      console.log('System audio capture started');
      return true;
    } catch (error) {
      console.error('Capture error:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to start capture');
      return false;
    }
  }, [onError, startWindowsCapture, startSendInterval]);

  const stopCapture = useCallback(() => {
    console.log('Stopping system audio capture...');
    isCapturingRef.current = false;

    stopSendInterval();

    if (platformRef.current === 'win32') {
      stopWindowsCapture();
    }

    // Tell main process to stop
    window.electronAPI.stopSystemAudio();
    platformRef.current = null;

    console.log('System audio capture stopped');
  }, [stopSendInterval, stopWindowsCapture]);

  return { startCapture, stopCapture, isCapturing: isCapturingRef.current };
}

// Utility functions

function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ArrayToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
