import type { AgentWorkRecord } from '../types/session';
import { getTerminalSequence } from './agentWorkApi';
import { browserAttention } from './attention';
import { configureBobChime, startBobChime } from './bobChimeAudio';

const CHANNEL_NAME = 'bob-chime-v1';
const LOCK_NAME = 'bob-chime-audio-owner-v1';
const LIFETIME_KEY = 'bob.chime.lifetime.v1';
const HEARTBEAT_MS = 1_000;
const ELECTION_RETRY_MS = 2_000;
const MINIMUM_START_GAP_MS = 250;
const DECISION_SETTLE_MS = 400;
const DECISION_RESERVATION_MS = 30_000;

type SpeechDecision = 'pending' | 'full' | 'chime';

interface SpeechDecisionMessage {
  type: 'speech-decision';
  tabId: string;
  work: AgentWorkRecord;
  decision: SpeechDecision;
}

interface PresenceMessage {
  type: 'presence-query' | 'presence-alive';
  token: string;
  tabId: string;
}

interface ChimeCoordinationMessage {
  type:
    | 'audio-ready'
    | 'audio-unready'
    | 'audio-ready-query'
    | 'play-chime'
    | 'owner-acquired'
    | 'terminal-consumed';
  tabId: string;
  targetTabId?: string;
}

interface ChimeLifetime {
  id: string;
  baseline: number;
  cursor: number;
  ledger: string[];
  heartbeatAt: number;
}

class BobChimeService {
  private readonly channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(CHANNEL_NAME);
  private readonly tabId = crypto.randomUUID();
  private lifetime: ChimeLifetime | null = null;
  private owner = false;
  private ownerRelease: (() => void) | null = null;
  private heartbeatTimer: number | null = null;
  private electionTimer: number | null = null;
  private audioContext: AudioContext | null = null;
  private queue = Promise.resolve();
  private lastStartAt = 0;
  private started = false;
  private joinedExistingLifetime = false;
  private readonly audioReadyTabs = new Set<string>();
  private readonly startupMessages: SpeechDecisionMessage[] = [];
  private readonly pendingDecisions: Array<{
    work: AgentWorkRecord;
    decision: SpeechDecision;
  }> = [];
  private reconciling: Promise<void> | null = null;
  private readonly deliveryEnabled =
    this.channel !== null && typeof navigator.locks !== 'undefined';
  private readonly decisions = new Map<
    string,
    {
      work: AgentWorkRecord;
      byTab: Map<string, SpeechDecision>;
      timer: number;
      allowBaseline: boolean;
    }
  >();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.channel?.addEventListener('message', (event) =>
      this.handleMessage(event),
    );
    window.addEventListener('beforeunload', () => this.stop());
    if (!this.deliveryEnabled) return;
    void this.joinLifetime();
    this.electionTimer = window.setInterval(
      () => void this.electOwner(),
      ELECTION_RETRY_MS,
    );
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.channel?.postMessage({
      type: 'audio-unready',
      tabId: this.tabId,
    } satisfies ChimeCoordinationMessage);
    this.channel?.postMessage({ type: 'owner-released' });
    this.ownerRelease?.();
    this.ownerRelease = null;
    this.owner = false;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.electionTimer !== null) window.clearInterval(this.electionTimer);
    this.heartbeatTimer = null;
    this.electionTimer = null;
    this.channel?.close();
  }

  notifyTerminal(work: AgentWorkRecord, decision: SpeechDecision): void {
    if (!this.deliveryEnabled || work.terminal_sequence === null) return;
    const message: SpeechDecisionMessage = {
      type: 'speech-decision',
      tabId: this.tabId,
      work,
      decision,
    };
    if (this.owner) this.recordSpeechDecision(message);
    else if (!this.lifetime) this.startupMessages.push(message);
    this.channel?.postMessage(message);
  }

  reconnect(): void {
    if (!this.deliveryEnabled) return;
    if (this.owner) void this.reconcile();
    else this.channel?.postMessage({ type: 'reconcile' });
  }

  automaticDeliveryEnabled(): boolean {
    return this.deliveryEnabled;
  }
  terminalCursor(): number | null {
    if (!this.lifetime) {
      if (!this.joinedExistingLifetime) return null;
      this.lifetime = this.readLifetime();
    }
    this.refreshLifetime();
    return this.lifetime?.cursor ?? null;
  }

  wasConsumed(work: AgentWorkRecord): boolean {
    this.refreshLifetime();
    if (work.terminal_sequence === null) return false;
    const lifetime =
      this.lifetime ?? (this.joinedExistingLifetime ? this.readLifetime() : null);
    if (!lifetime) return false;
    return (
      work.terminal_sequence <= lifetime.baseline ||
      lifetime.ledger.includes(work.id)
    );
  }


  async unlockAudio(): Promise<void> {
    this.audioContext ??= new AudioContext();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    if (!this.deliveryEnabled || this.audioContext.state !== 'running') return;
    this.audioReadyTabs.add(this.tabId);
    this.channel?.postMessage({
      type: 'audio-ready',
      tabId: this.tabId,
    } satisfies ChimeCoordinationMessage);
  }

  private handleMessage(event: MessageEvent): void {
    if (event.data?.type === 'presence-query') {
      const query = event.data as PresenceMessage;
      if (query.tabId !== this.tabId) {
        this.channel?.postMessage({
          type: 'presence-alive',
          token: query.token,
          tabId: this.tabId,
        } satisfies PresenceMessage);
      }
    }
    if (event.data?.type === 'audio-ready-query') {
      if (this.audioContext?.state === 'running') {
        this.channel?.postMessage({
          type: 'audio-ready',
          tabId: this.tabId,
        } satisfies ChimeCoordinationMessage);
      }
    }
    if (event.data?.type === 'audio-ready' && this.owner) {
      this.audioReadyTabs.add((event.data as ChimeCoordinationMessage).tabId);
    }
    if (event.data?.type === 'audio-unready' && this.owner) {
      this.audioReadyTabs.delete((event.data as ChimeCoordinationMessage).tabId);
    }
    if (
      event.data?.type === 'play-chime' &&
      (event.data as ChimeCoordinationMessage).targetTabId === this.tabId
    ) {
      void this.playLocalChime();
    }
    if (event.data?.type === 'speech-decision' && this.owner) {
      this.recordSpeechDecision(event.data as SpeechDecisionMessage);
    }
    if (event.data?.type === 'reconcile') void this.reconcile();
    if (event.data?.type === 'owner-released') void this.electOwner();
    if (event.data?.type === 'owner-acquired') {
      window.dispatchEvent(new Event('bob-chime-owner-acquired'));
    }
    if (event.data?.type === 'terminal-consumed') {
      window.dispatchEvent(new Event('bob-chime-reconcile'));
    }
  }

  private async joinLifetime(): Promise<void> {
    this.joinedExistingLifetime = await this.detectExistingLifetime();
    if (this.started) await this.electOwner();
  }

  private async detectExistingLifetime(): Promise<boolean> {
    if (!this.channel) return false;
    const token = crypto.randomUUID();
    const result = Promise.withResolvers<boolean>();
    const onMessage = (event: MessageEvent) => {
      const message = event.data as Partial<PresenceMessage>;
      if (message.type !== 'presence-alive' || message.token !== token) return;
      this.channel?.removeEventListener('message', onMessage);
      result.resolve(true);
    };
    this.channel.addEventListener('message', onMessage);
    this.channel.postMessage({
      type: 'presence-query',
      token,
      tabId: this.tabId,
    } satisfies PresenceMessage);
    window.setTimeout(() => {
      this.channel?.removeEventListener('message', onMessage);
      result.resolve(false);
    }, 100);
    return result.promise;
  }

  private async electOwner(): Promise<void> {
    if (!this.started || this.owner || this.ownerRelease || !this.deliveryEnabled) {
      return;
    }
    const gate = Promise.withResolvers<void>();
    this.ownerRelease = gate.resolve;
    await navigator.locks.request(
      LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          this.ownerRelease = null;
          return;
        }
        this.owner = true;
        for (const message of this.startupMessages.splice(0)) {
          this.recordSpeechDecision(message);
        }
        this.audioReadyTabs.clear();
        if (this.audioContext?.state === 'running') {
          this.audioReadyTabs.add(this.tabId);
        }
        this.channel?.postMessage({
          type: 'audio-ready-query',
          tabId: this.tabId,
        } satisfies ChimeCoordinationMessage);
        const readyResponses = Promise.withResolvers<void>();
        window.setTimeout(readyResponses.resolve, 100);
        await readyResponses.promise;
        await this.initializeLifetime();
        this.channel?.postMessage({
          type: 'owner-acquired',
          tabId: this.tabId,
        } satisfies ChimeCoordinationMessage);
        window.dispatchEvent(new Event('bob-chime-owner-acquired'));
        this.heartbeatTimer = window.setInterval(
          () => this.persistHeartbeat(),
          HEARTBEAT_MS,
        );
        await this.reconcile();
        await gate.promise;
        this.owner = false;
        if (this.heartbeatTimer !== null) {
          window.clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
      },
    );
    this.ownerRelease = null;
  }

  private async initializeLifetime(): Promise<void> {
    const stored = this.readLifetime();
    if (this.joinedExistingLifetime && stored) {
      this.lifetime = stored;
      this.persistHeartbeat();
    } else {
      const baseline = await getTerminalSequence();
      this.lifetime = {
        id: crypto.randomUUID(),
        baseline,
        cursor: baseline,
        ledger: [],
        heartbeatAt: Date.now(),
      };
      this.persistLifetime();
    }
    this.flushPendingDecisions();
  }

  private recordSpeechDecision(message: SpeechDecisionMessage): void {
    const existing = this.decisions.get(message.work.id);
    if (existing) window.clearTimeout(existing.timer);
    const byTab = existing?.byTab ?? new Map<string, SpeechDecision>();
    byTab.set(message.tabId, message.decision);
    const allowBaseline = existing?.allowBaseline ?? this.lifetime === null;
    const values = [...byTab.values()];
    const delay =
      values.includes('pending') && !values.includes('full')
        ? DECISION_RESERVATION_MS
        : DECISION_SETTLE_MS;
    const timer = window.setTimeout(() => {
      const decision = this.decisions.get(message.work.id);
      this.decisions.delete(message.work.id);
      if (!decision) return;
      const resolvedDecision = [...decision.byTab.values()].includes('full')
        ? 'full'
        : 'chime';
      if (!this.lifetime) {
        this.pendingDecisions.push({
          work: decision.work,
          decision: resolvedDecision,
        });
        return;
      }
      this.applyDecision(
        decision.work,
        resolvedDecision,
        decision.allowBaseline,
      );
    }, delay);
    this.decisions.set(message.work.id, {
      work: message.work,
      byTab,
      timer,
      allowBaseline,
    });
  }

  private flushPendingDecisions(): void {
    for (const pending of this.pendingDecisions.splice(0)) {
      this.applyDecision(pending.work, pending.decision, true);
    }
  }

  private applyDecision(
    work: AgentWorkRecord,
    decision: SpeechDecision,
    allowBaseline: boolean,
  ): void {
    if (decision === 'full') this.consume(work, allowBaseline);
    else this.schedule(work, allowBaseline);
  }

  private async reconcile(): Promise<void> {
    if (!this.owner || !this.lifetime) return;
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.reconcileFromServer();
    try {
      await this.reconciling;
    } finally {
      this.reconciling = null;
    }
  }

  private async reconcileFromServer(): Promise<void> {
    if (!this.lifetime) return;
    window.dispatchEvent(new Event('bob-chime-reconcile'));
  }

  private consume(work: AgentWorkRecord, allowBaseline = false): boolean {
    if (!this.lifetime || work.terminal_sequence === null) return false;
    const sequence = work.terminal_sequence;
    this.lifetime.cursor = Math.max(this.lifetime.cursor, sequence);
    if (
      (!allowBaseline && sequence <= this.lifetime.baseline) ||
      this.lifetime.ledger.includes(work.id)
    ) {
      this.persistLifetime();
      return false;
    }
    this.lifetime.ledger.push(work.id);
    this.persistLifetime();
    this.channel?.postMessage({
      type: 'terminal-consumed',
      tabId: this.tabId,
    } satisfies ChimeCoordinationMessage);
    window.dispatchEvent(new Event('bob-chime-reconcile'));
    return true;
  }

  private schedule(work: AgentWorkRecord, allowBaseline = false): void {
    if (!this.consume(work, allowBaseline)) return;
    this.queue = this.queue
      .then(() => this.dispatchScheduledChime())
      .catch((error) => {
        console.warn('Bob Chime scheduling failed:', error);
      });
  }

  private async dispatchScheduledChime(): Promise<void> {
    const delay = Math.max(
      0,
      this.lastStartAt + MINIMUM_START_GAP_MS - performance.now(),
    );
    if (delay > 0) {
      const wait = Promise.withResolvers<void>();
      window.setTimeout(wait.resolve, delay);
      await wait.promise;
    }
    if (!browserAttention.isAudioIdle()) await this.waitForAudioIdle();
    this.lastStartAt = performance.now();
    if (this.audioContext?.state === 'running') {
      await this.playLocalChime();
      return;
    }
    const targetTabId = [...this.audioReadyTabs].sort()[0];
    if (!targetTabId) return;
    this.channel?.postMessage({
      type: 'play-chime',
      tabId: this.tabId,
      targetTabId,
    } satisfies ChimeCoordinationMessage);
  }

  private async playLocalChime(): Promise<void> {
    const context = this.audioContext;
    if (!context || context.state !== 'running') return;
    if (!browserAttention.isAudioIdle()) await this.waitForAudioIdle();

    const startedAt = context.currentTime;
    const { sine, triangle, sineWeight, triangleWeight, master, stoppedAt } =
      configureBobChime(context, startedAt);
    const endAudio = browserAttention.beginAudio();
    try {
      startBobChime(
        { sine, triangle, sineWeight, triangleWeight, master, stoppedAt },
        startedAt,
      );
      const playback = Promise.withResolvers<void>();
      window.setTimeout(playback.resolve, 180);
      await playback.promise;
    } finally {
      endAudio();
      sine.disconnect();
      triangle.disconnect();
      sineWeight.disconnect();
      triangleWeight.disconnect();
      master.disconnect();
    }
  }

  private waitForAudioIdle(): Promise<void> {
    if (browserAttention.isAudioIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: number | null = null;
      const finishIfIdle = () => {
        if (!browserAttention.isAudioIdle()) return;
        unsubscribe();
        if (timer !== null) window.clearInterval(timer);
        resolve();
      };
      const unsubscribe = browserAttention.subscribe(finishIfIdle);
      timer = window.setInterval(finishIfIdle, HEARTBEAT_MS);
      finishIfIdle();
    });
  }

  private persistHeartbeat(): void {
    if (!this.lifetime) return;
    this.lifetime.heartbeatAt = Date.now();
    this.persistLifetime();
  }

  private persistLifetime(): void {
    if (!this.lifetime) return;
    localStorage.setItem(LIFETIME_KEY, JSON.stringify(this.lifetime));
  }

  private refreshLifetime(): void {
    if (!this.lifetime) return;
    const stored = this.readLifetime();
    if (
      stored?.id === this.lifetime.id &&
      (stored.cursor > this.lifetime.cursor ||
        stored.heartbeatAt > this.lifetime.heartbeatAt)
    ) {
      this.lifetime = stored;
    }
  }

  private readLifetime(): ChimeLifetime | null {
    const stored = localStorage.getItem(LIFETIME_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as ChimeLifetime;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.baseline !== 'number' ||
        typeof parsed.cursor !== 'number' ||
        !Array.isArray(parsed.ledger) ||
        typeof parsed.heartbeatAt !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

export const bobChime = new BobChimeService();
