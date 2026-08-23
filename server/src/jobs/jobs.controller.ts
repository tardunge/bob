import { Controller, Sse } from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { JobsService, type SessionEvent } from './jobs.service';
import { AgentWorkService } from '../agent-work/agent-work.service';
import type { AgentWorkEvent } from '../agent-work/agent-work.types';

const HEARTBEAT_MS = 15_000;

interface MessageEvent {
  data: SessionEvent | AgentWorkEvent | string;
  type?: string;
}

@Controller('events')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly agentWork: AgentWorkService,
  ) {}

  // Single global SSE stream — clients filter by sessionId on the payload.
  // Heartbeat (event: ping) every 15s keeps the connection alive across the
  // long quiet windows during agent calls; the browser's EventSource.onmessage
  // only fires for the default 'message' type, so pings are invisible to the
  // app handler.
  @Sse()
  stream(): Observable<MessageEvent> {
    const events: Observable<MessageEvent> = merge(
      this.jobsService.stream(),
      this.agentWork.stream(),
    ).pipe(map((data) => ({ data })));
    const heartbeat: Observable<MessageEvent> = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'ping', data: '' })),
    );
    return merge(events, heartbeat);
  }
}
