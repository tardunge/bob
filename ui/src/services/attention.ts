const CHANNEL_NAME = 'bob-attention-v1';
const HEARTBEAT_MS = 1_000;
const REMOTE_EXPIRY_MS = 2_500;

interface AudioStateMessage {
  type: 'audio-state';
  tabId: string;
  occupied: boolean;
  sentAt: number;
}

export type AttentionState = 'attending' | 'in_bob' | 'away';

type AttentionListener = () => void;

export class BrowserAttentionService {
  private selectedConversationId: string | null = null;
  private documentVisible = document.visibilityState === 'visible';
  private windowFocused = document.hasFocus();
  private recording = false;
  private readonly audioOwners = new Set<symbol>();
  private readonly tabId = crypto.randomUUID();
  private readonly channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(CHANNEL_NAME);
  private readonly remoteAudio = new Map<string, number>();
  private readonly listeners = new Set<AttentionListener>();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.documentVisible = document.visibilityState === 'visible';
      this.notify();
    });
    window.addEventListener('focus', () => {
      this.windowFocused = true;
      this.notify();
    });
    window.addEventListener('blur', () => {
      this.windowFocused = false;
      this.notify();
    });
    this.channel?.addEventListener('message', (event) => {
      const message = event.data as Partial<AudioStateMessage>;
      if (
        message.type !== 'audio-state' ||
        typeof message.tabId !== 'string' ||
        message.tabId === this.tabId
      ) {
        return;
      }
      if (message.occupied) {
        this.remoteAudio.set(message.tabId, Date.now());
      } else {
        this.remoteAudio.delete(message.tabId);
      }
      this.notify();
    });
    window.setInterval(() => this.publishAudioState(), HEARTBEAT_MS);
    window.addEventListener('beforeunload', () => {
      this.channel?.postMessage({
        type: 'audio-state',
        tabId: this.tabId,
        occupied: false,
        sentAt: Date.now(),
      } satisfies AudioStateMessage);
    });
  }

  setSelectedConversation(sessionId: string | null): void {
    if (this.selectedConversationId === sessionId) return;
    this.selectedConversationId = sessionId;
    this.notify();
  }

  setRecording(recording: boolean): void {
    if (this.recording === recording) return;
    this.recording = recording;
    this.notify();
    this.publishAudioState();
  }

  beginAudio(): () => void {
    const owner = Symbol('bob-audio');
    this.audioOwners.add(owner);
    this.notify();
    this.publishAudioState();
    return () => {
      if (!this.audioOwners.delete(owner)) return;
      this.notify();
      this.publishAudioState();
    };
  }

  stateFor(sessionId: string): AttentionState {
    if (!this.documentVisible || !this.windowFocused) return 'away';
    if (this.selectedConversationId === sessionId) return 'attending';
    return 'in_bob';
  }

  isAudioIdle(): boolean {
    const oldestLiveHeartbeat = Date.now() - REMOTE_EXPIRY_MS;
    for (const [tabId, seenAt] of this.remoteAudio) {
      if (seenAt < oldestLiveHeartbeat) this.remoteAudio.delete(tabId);
    }
    return (
      !this.recording &&
      this.audioOwners.size === 0 &&
      this.remoteAudio.size === 0
    );
  }

  subscribe(listener: AttentionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publishAudioState(): void {
    this.channel?.postMessage({
      type: 'audio-state',
      tabId: this.tabId,
      occupied: this.recording || this.audioOwners.size > 0,
      sentAt: Date.now(),
    } satisfies AudioStateMessage);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const browserAttention = new BrowserAttentionService();
