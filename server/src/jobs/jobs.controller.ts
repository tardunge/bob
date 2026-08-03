import { Controller, Sse } from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { JobsService, type SessionEvent } from './jobs.service';

const HEARTBEAT_MS = 15_000;

interface MessageEvent {
  data: SessionEvent | string;
  type?: string;
}

@Controller('events')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // Single global SSE stream — clients filter by sessionId on the payload.
  // Heartbeat (event: ping) every 15s keeps the connection alive across the
  // long quiet windows during agent calls; the browser's EventSource.onmessage
  // only fires for the default 'message' type, so pings are invisible to the
  // app handler.
  @Sse()
  stream(): Observable<MessageEvent> {
    const events: Observable<MessageEvent> = this.jobsService
      .stream()
      .pipe(map((data) => ({ data })));
    const heartbeat: Observable<MessageEvent> = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'ping', data: '' })),
    );
    return merge(events, heartbeat);
  }
}
