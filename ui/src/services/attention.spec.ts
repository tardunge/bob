// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAttentionService } from './attention';

describe('BrowserAttentionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives attending, in_bob, and away from browser attention', () => {
    const attention = new BrowserAttentionService();
    window.dispatchEvent(new Event('focus'));
    attention.setSelectedConversation('conversation-1');

    expect(attention.stateFor('conversation-1')).toBe('attending');
    expect(attention.stateFor('conversation-2')).toBe('in_bob');

    window.dispatchEvent(new Event('blur'));
    expect(attention.stateFor('conversation-1')).toBe('away');

    window.dispatchEvent(new Event('focus'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(attention.stateFor('conversation-1')).toBe('away');
  });

  it('tracks recording and playback occupancy without interrupting active audio', () => {
    const attention = new BrowserAttentionService();
    expect(attention.isAudioIdle()).toBe(true);

    attention.setRecording(true);
    expect(attention.isAudioIdle()).toBe(false);
    attention.setRecording(false);
    const release = attention.beginAudio();
    expect(attention.isAudioIdle()).toBe(false);
    release();
    expect(attention.isAudioIdle()).toBe(true);
  });
});
