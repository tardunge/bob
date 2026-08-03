import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Message, SessionUsage } from '../session/session.dto';
import { DatabaseService } from '../database/database.service';
import { TurnStore, type TurnStage } from '../turn/turn-store';
import type { AgentHarness } from '../agent/agent.types';

export type JobState = 'processing' | 'ready' | 'failed';
export type JobStage = TurnStage;

export interface SessionEvent {
  sessionId: string;
  harness: AgentHarness;
  jobId?: string;
  state: JobState;
  stage?: JobStage;
  userMessage?: Message;
  assistantMessage?: Message;
  audioFilename?: string | null;
  usage?: SessionUsage;
  error?: string;
}

@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly events$ = new Subject<SessionEvent>();

  constructor(private readonly database: DatabaseService) {}

  private get turns(): TurnStore {
    return new TurnStore(this.database.getDatabase());
  }

  onApplicationBootstrap(): void {
    const reconciled = this.turns.reconcileProcessing(
      'This turn was interrupted when the Bob server restarted.',
    );
    if (reconciled > 0) {
      console.warn(`Marked ${reconciled} interrupted Bob turn(s) as failed.`);
    }
  }

  isProcessing(sessionId: string): boolean {
    return this.turns.processingForSession(sessionId) !== null;
  }

  start(sessionId: string, harness: AgentHarness): string {
    const turn = this.turns.create(sessionId, harness);
    this.events$.next({
      sessionId,
      harness,
      jobId: turn.id,
      state: 'processing',
      stage: 'whisper',
    });
    return turn.id;
  }

  emitIntermediate(event: SessionEvent): void {
    const turn = event.jobId
      ? this.turns.get(event.jobId)
      : this.turns.processingForSession(event.sessionId);
    if (turn && event.stage) this.turns.setStage(turn.id, event.stage);
    this.events$.next({
      ...event,
      harness: turn?.harness ?? event.harness,
      jobId: turn?.id ?? event.jobId,
    });
  }

  complete(
    sessionId: string,
    harness: AgentHarness,
    payload: {
      userMessage: Message;
      assistantMessage: Message;
      audioFilename: string | null;
      usage?: SessionUsage;
    },
  ): void {
    const turn = this.turns.processingForSession(sessionId);
    if (turn) this.turns.complete(turn.id);
    this.events$.next({
      sessionId,
      harness: turn?.harness ?? harness,
      jobId: turn?.id,
      state: 'ready',
      userMessage: payload.userMessage,
      assistantMessage: payload.assistantMessage,
      audioFilename: payload.audioFilename,
      usage: payload.usage,
    });
  }

  fail(
    sessionId: string,
    harness: AgentHarness,
    error: string,
    assistantMessage?: Message,
  ): void {
    const turn = this.turns.processingForSession(sessionId);
    if (turn) this.turns.fail(turn.id, error);
    this.events$.next({
      sessionId,
      harness: turn?.harness ?? harness,
      jobId: turn?.id,
      state: 'failed',
      error,
      assistantMessage,
    });
  }

  latestTurn(sessionId: string) {
    return this.turns.latestForSession(sessionId);
  }

  stream(): Observable<SessionEvent> {
    return this.events$.asObservable();
  }
}
