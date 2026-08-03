import { useEffect, useRef } from 'react';
import type { SessionEvent } from '../types/session';

// Opens one SSE connection on mount and routes every event to the current
// handler via a ref, so changing the handler doesn't reconnect the stream.
// EventSource auto-reconnects on transient errors — no extra logic needed.
export function useSessionEvents(handler: (event: SessionEvent) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (ev) => {
      try {
        const event: SessionEvent = JSON.parse(ev.data);
        handlerRef.current(event);
      } catch (err) {
        console.warn('Failed to parse SSE event:', err, ev.data);
      }
    };
    source.onerror = (err) => {
      // The browser will retry automatically. Log so we can spot persistent
      // failures, but don't surface as a user error.
      console.warn('SSE connection error:', err);
    };
    return () => source.close();
  }, []);
}
