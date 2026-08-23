import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Message, SessionUsage } from '../session/session.dto';
import { DatabaseService } from '../database/database.service';
import { TurnStore, type TurnStage } from '../turn/turn-store';
import type { AgentHarness } from '../agent/agent.types';
import { AgentWorkService } from '../agent-work/agent-work.service';
import type { AgentWorkProjection } from '../agent-work/agent-work.types';

export type JobState = 'processing' | 'ready' | 'failed';
export type JobStage = TurnStage;

export interface SessionEvent {
  kind: 'turn';
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
  agentWork?: AgentWorkProjection;
  speechSuppressed?: boolean;
}

@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly events$ = new Subject<SessionEvent>();

  constructor(
    private readonly database: DatabaseService,
    private readonly agentWork: AgentWorkService,
  ) {}

  private get turns(): TurnStore {
    return new TurnStore(this.database.getDatabase());
  }

  onApplicationBootstrap(): void {
    const reconciled = this.turns.reconcileProcessing(
      'This turn was interrupted when the Bob server restarted.',
      true,
    );
    if (reconciled > 0) {
      console.warn(`Marked ${reconciled} interrupted Bob turn(s) as failed.`);
    }
  }

  isProcessing(sessionId: string): boolean {
    return this.agentWork.hasForeground(sessionId);
  }

  start(sessionId: string, harness: AgentHarness): string {
    const admission = this.agentWork.admitTurn(sessionId, harness);
    this.events$.next({
      kind: 'turn',
      sessionId,
      harness,
      jobId: admission.turnId,
      state: 'processing',
      stage: 'whisper',
      agentWork: this.agentWork.get(admission.work.id),
    });
    return admission.turnId;
  }

  emitIntermediate(event: Omit<SessionEvent, 'kind'>): void {
    const turn = event.jobId
      ? this.turns.get(event.jobId)
      : this.turns.processingForSession(event.sessionId);
    if (turn && event.stage) this.turns.setStage(turn.id, event.stage);
    this.events$.next({
      kind: 'turn',
      ...event,
      harness: turn?.harness ?? event.harness,
      jobId: turn?.id ?? event.jobId,
      agentWork: turn ? this.agentWork.get(this.agentWork.forTurn(turn.id).id) : undefined,
    });
  }

  complete(
    jobId: string,
    payload: {
      userMessage: Message;
      assistantMessage: Message;
      audioFilename: string | null;
      usage?: SessionUsage;
      agentWork: AgentWorkProjection;
    },
  ): void {
    const turn = this.turns.get(jobId);
    if (!turn) return;
    this.events$.next({
      kind: 'turn',
      sessionId: turn.session_id,
      harness: turn.harness,
      jobId: turn.id,
      state: 'ready',
      userMessage: payload.userMessage,
      assistantMessage: payload.assistantMessage,
      audioFilename: payload.audioFilename,
      usage: payload.usage,
      agentWork: payload.agentWork,
      speechSuppressed: false,
    });
  }

  fail(
    jobId: string,
    error: string,
    assistantMessage?: Message,
    agentWork?: AgentWorkProjection,
  ): void {
    const turn = this.turns.get(jobId);
    if (!turn) return;
    this.events$.next({
      kind: 'turn',
      sessionId: turn.session_id,
      harness: turn.harness,
      jobId: turn.id,
      state: 'failed',
      error,
      assistantMessage,
      agentWork,
      speechSuppressed: true,
    });
  }

  latestTurn(sessionId: string) {
    return this.turns.latestForSession(sessionId);
  }

  stream(): Observable<SessionEvent> {
    return this.events$.asObservable();
  }
}
