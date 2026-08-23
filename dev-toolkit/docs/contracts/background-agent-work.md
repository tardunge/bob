# Background Agent Work Runtime Contract

## Scope

This contract defines Bob's durable Agent Work lifecycle, Conversation continuation ownership, callback delivery, write leases, process reconciliation, Attention State, and browser-wide Bob Chime behavior.

## Lifecycle

- Every accepted Turn creates one durable Agent Work record before adapter execution starts.
- A Conversation has at most one foreground Agent Work record. It may have multiple background records.
- The Promotion clock starts when the Turn enters the agent stage. At 120 seconds, supported Pi work atomically transitions from `foreground` to `background` and releases the foreground slot.
- Completion and Promotion race through persisted compare-and-set transitions. One run cannot produce both a foreground terminal path and a background terminal path.
- Promotion does not change the profile deadline. Terminal transitions are idempotent.
- Unsupported adapters remain foreground and never imply background support.

## Continuation ownership and callbacks

- Each run starts from an isolated branch of the canonical Conversation continuation and captures its canonical revision.
- Only a non-promoted foreground success whose base revision still matches may advance canonical continuation.
- Promoted and stale completions never replace canonical continuation. They create durable Background Callbacks.
- One Turn claims at most the 20 oldest pending callbacks, ordered by terminal sequence and stable callback identity.
- Continuation advancement and acknowledgement of that exact claimed batch commit atomically. Failed, promoted, or stale Turns acknowledge none of the batch.
- A terminal background outcome, display message, callback-inbox row, and monotonic terminal sequence commit in one SQLite transaction before SSE publication.
- A successful Agent Result, display message, continuation outcome, callback-inbox mutation, and terminal sequence commit before Piper or file-copy work. Until media staging completes, `stage = piper` is a durable publication-pending marker: browser reconciliation stops at that sequence, and non-promoted work continues to own the foreground slot.
- Media publication stores the Agent Work audio filename and clears the publication-pending marker before emitting terminal invalidation. Startup clears any stranded successful `piper` marker to a publish-ready text-only result so one interrupted media step cannot block later terminal sequences.
- SSE is an invalidation channel. Conversation detail and Agent Work APIs are authoritative after reconnect.

## Write leases

- At every admission, configured write roots must resolve to existing directories through native `realpath`; persisted roots are canonical absolute paths.
- Equal roots and component-boundary ancestor/descendant roots overlap. String prefixes without a path boundary do not.
- A promoted writer retains its lease until its process group is verified absent and its terminal transition commits.
- Pi may admit a later overlapping Turn only with no write roots and an explicit read-only prompt. Adapters that cannot enforce this are rejected.
- Profiles with unrestricted Pi extensions do not claim root enforcement: they remain foreground and take a filesystem-root lease so Bob cannot admit another writer concurrently.
- Adapter tool guards resolve every existing or dangling symlink component before authorizing a write.

## Process ownership, cancellation, and restart

- A managed Pi run has a stable adapter run identity, isolated continuation-branch directory, PID, process-group ID, and server-observed birth marker persisted before its prompt is activated.
- Cancellation, timeout, graceful shutdown, and restart reconciliation signal the owned process group with `SIGTERM`, wait five seconds, escalate a surviving group with `SIGKILL`, and verify absence.
- A terminal transition clears process identity and releases leases only after verified absence.
- If identity, termination, or absence cannot be verified, Agent Work remains non-terminal as `orphaned`; admission stays blocked and shutdown/startup fails closed.
- Cancellation is addressed only by Agent Work identity and is idempotent.
- A successfully reconciled interrupted Pi run marks Conversation recovery pending. The next foreground Turn uses persisted recovery context; interrupted work is not replayed.

## Attention State and speech

At terminal event handling time, the browser derives:
- `attending`: document visible, window focused, and originating Conversation selected.
- `in_bob`: document visible and window focused with another Conversation selected.
- `away`: document hidden or window unfocused.

Successful foreground responses and Background Callbacks may auto-play full speech only while `attending`, while all Bob audio is idle, and after a final Attention State check following audio fetch. Otherwise full speech is suppressed, the originating Conversation receives an unread indicator, and the result takes the Bob Chime path. Failures, timeouts, cancellations, and interruptions never auto-play full speech and retain a distinct failed-work indicator. Manual playback remains available.

## Browser-wide Bob Chime

- All participating tabs use BroadcastChannel plus Web Locks to coordinate one browser-wide chime scheduler. Without both mechanisms, automatic speech and chimes fail closed to visual indicators.
- The active browser lifetime begins with the first tab and ends with the last. A new lifetime snapshots the current maximum terminal sequence; records at or below it are historical.
- Tabs share a terminal cursor and stable-identity ledger. Live SSE, reconnect hydration, and owner handoff consume each post-baseline result at most once, including results spoken in full and attempts blocked by browser audio policy.
- Audio activation may occur in any tab. The scheduler delegates playback to an activated tab and observes browser-wide recording and playback occupancy.
- Chime starts are serialized at least 250 ms apart and never overlap Bob audio.
- The 180 ms Web Audio signal uses sine and triangle oscillators, each ramping exponentially from 720 Hz at 0 ms to 960 Hz at 65 ms and 820 Hz at 180 ms. Pre-master weights are `1 / 1.18` and `0.18 / 1.18`. Master gain is 0 at 0 ms, ramps linearly to 0.1 at 5 ms, and exponentially to 0.0001 at 180 ms.
- Bob requests no notification permission and uses no Web Notification API, service worker, sampled sound, or secondary notification queue.
