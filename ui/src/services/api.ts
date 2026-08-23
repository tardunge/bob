import type { AgentHarness, VoiceAccepted } from '../types/session';
import { browserAttention } from './attention';

const API_BASE_URL = '/api';

// Async voice flow: POST returns immediately with { sessionId, accepted: true }.
// Whisper → selected agent → Piper runs in the background; the UI learns about the
// outcome via the SSE stream at /api/events.
export async function sendVoiceMessage(
  audioBlob: Blob,
  sessionId: string,
  harness: AgentHarness,
  skill?: string,
  effort?: string,
  model?: string,
): Promise<VoiceAccepted> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('sessionId', sessionId);
  formData.append('harness', harness);
  if (skill) {
    formData.append('skill', skill);
  }
  if (effort) {
    formData.append('effort', effort);
  }
  if (model) {
    formData.append('model', model);
  }

  const response = await fetch(`${API_BASE_URL}/voice`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to submit voice (${response.status})`);
  }

  return response.json();
}

export function audioUrlForFilename(filename: string): string {
  return `${API_BASE_URL}/voice/audio/${encodeURIComponent(filename)}`;
}

export function audioUrlForMessage(messageId: number): string {
  return audioUrlForFilename(`response-${messageId}.wav`);
}

export async function fetchAudioBlob(audioUrl: string): Promise<Blob> {
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'expired' : 'fetch-failed');
  }
  return response.blob();
}

export function playAudioBlob(audioBlob: Blob): {
  audio: HTMLAudioElement;
  promise: Promise<void>;
} {
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  const endAudio = browserAttention.beginAudio();
  let settled = false;

  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(audioUrl);
      endAudio();
      if (error) reject(error);
      else resolve();
    };
    audio.onended = () => finish();
    audio.onpause = () => finish();
    audio.onerror = (error) => finish(error);

    audio.play().catch((error) => {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        console.warn('Audio playback blocked by autoplay policy:', error);
      }
      finish(error);
    });
  });

  return { audio, promise };
}
