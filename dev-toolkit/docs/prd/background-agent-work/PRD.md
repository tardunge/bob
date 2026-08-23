---
type: prd
status: shipped
slug: background-agent-work
repositories: [bob]
source_rfc: null
superseded_by: null
updated: 2026-08-18
---

# Background Agent Work

## Problem Statement

Bob accepts a voice Turn and returns HTTP control immediately, but the Conversation remains occupied until its selected agent harness settles. The active Conversation rejects another Turn, the voice control remains disabled, and Pi is killed when the profile timeout expires. A long tool call or a parent waiting for delegated work can therefore make one Conversation unusable for ten minutes and then produce only a timeout marker.

Bob also lacks a durable boundary for results that arrive after conversational control has returned. A completed background worker can report through its parent harness process, but Bob cannot identify, persist, deduplicate, display, or reintroduce that result into later agent context independently of the original foreground Turn.

Response speech is based only on whether the originating Conversation is selected when its SSE event arrives. Bob does not distinguish an actively attended Conversation from a hidden tab, an unfocused window, or a user working in another Conversation. It may therefore speak when the user is no longer attending, while a silenced result has no small auditory cue.

The product requirement is to return control of the same Conversation after two minutes without abandoning the work, deliver its terminal result as a durable Background Callback, and choose full speech or Bob's original notification chime from the user's actual Attention State. Promotion must not permit concurrent agents to corrupt one continuation or write concurrently to overlapping workspace roots.

## Source and lineage

This PRD promotes `docs/backlog/long-running-work-should-return-conversation-control.md` and incorporates the Bob Impl decision to use Wayfinder only for design and decision recording. It is related to, but does not resolve, `docs/backlog/expose-background-worker-live-links.md` or `docs/backlog/evaluate-migrating-bob-from-pi-to-omp.md`.

The current implementation establishes these constraints:

- A persisted Turn is only `processing`, `completed`, or `failed`, with `whisper`, `agent`, and `piper` stages.
- Admission rejects a second processing Turn in the same Conversation.
- The Pi adapter owns one child process until `agent_settled`, then terminates it.
- The profile timeout is a total agent-runtime limit; the Tickr profile currently uses ten minutes.
- Bob stores display messages separately from the harness continuation, so appending a callback to the Conversation does not by itself put that callback into future agent context.
- Bob already emits one global SSE stream and persists terminal Turn state, but it does not persist child-process identity or expose cancellation.
- On server restart, processing Pi Turns become failed and the Conversation is marked for recovery.
- The UI auto-plays a response whenever its Conversation is selected. It does not inspect `document.visibilityState` or window focus.
- Every assistant response already has manual audio playback while its generated audio remains available.

## Solution

Introduce a durable **Agent Work** lifecycle between conversational Turns and harness processes. Every accepted Turn owns one Agent Work record. Agent Work begins in foreground mode. If its agent stage remains non-terminal for 120 seconds, Bob atomically applies **Promotion**, releases the Conversation's foreground slot, and keeps the same harness process running under the Agent Work coordinator.

The Conversation immediately becomes usable for another Turn. The promoted Agent Work remains visible with its stable identity, current state, start time, elapsed time, and cancel action. Its existing profile timeout remains the total runtime limit; Promotion does not reset or extend that timeout.

When promoted Agent Work reaches a terminal outcome, Bob atomically persists a **Background Callback**, its Conversation message, its pending callback-inbox entry, and a monotonically increasing terminal sequence before notifying clients. The Background Callback identity is derived solely from its Agent Work identity because each Agent Work record has exactly one legal terminal transition. Success appears once as an assistant work-result message; failure, timeout, cancellation, and server interruption appear once as classified work-status messages.

A browser-side **Attention State** combines document visibility, window focus, and the selected Conversation. If a successful response or Background Callback belongs to the visible, focused Conversation, Bob may speak it. Otherwise one elected browser audio owner schedules the **Bob Chime** once for an eligible terminal result completed during the active Bob browser lifetime. Audible playback remains subject to browser audio policy; Bob does not use browser notifications.

## User Stories

1. As a Bob user, I want a Turn that has spent two minutes in the agent stage to continue in the background, so that I can keep using the same Conversation.
2. As a Bob user, I want the two-minute clock to exclude transcription and speech synthesis, so that Promotion measures Agent Work rather than local media latency.
3. As a Bob user, I want Promotion to preserve the running process, so that work already performed is not discarded.
4. As a Bob user, I want a visible acknowledgement when Agent Work is promoted, so that a re-enabled voice control is not mistaken for completion.
5. As a Bob user, I want each promoted Agent Work record to have a stable identity, summary, state, and elapsed time, so that I can distinguish concurrent work.
6. As a Bob user, I want to start another Turn after Promotion, so that an unrelated question does not wait behind long work.
7. As a Bob user, I want Bob to prevent overlapping workspace writes, so that returning Conversation control cannot corrupt my checkout.
8. As a Bob user, I want to cancel one background operation without stopping Bob or other Agent Work, so that a stuck search or mistaken request does not consume its full timeout.
9. As a Bob user, I want successful promoted Agent Work to append one Background Callback to the originating Conversation, so that I do not need to poll for it.
10. As a Bob user, I want failed, timed-out, cancelled, and interrupted Agent Work to have distinct outcomes, so that I know whether retrying is appropriate.
11. As a Bob user, I want a result that finishes while I view another Conversation to mark the originating Conversation unread, so that I notice it later.
12. As a Bob user, I want the next foreground agent to know about completed background work, so that I do not have to repeat its result manually.
13. As a Bob user, I want Background Callbacks to survive UI reconnects and Bob restarts, so that an SSE disconnect cannot lose a result.
14. As a Bob user, I want duplicate harness events to produce one Background Callback, so that retries do not duplicate Conversation messages.
15. As a Bob user, I want promoted Agent Work never to overwrite the canonical Conversation continuation, so that late completion cannot rewind newer discussion.
16. As a Bob user, I want Bob to speak a completed response only while I am actively attending its Conversation, so that asynchronous audio is contextual rather than surprising.
17. As a Bob user, I want Bob to suppress full speech when its tab is hidden, its window is unfocused, another Conversation is selected, or Bob audio is already playing.
18. As a Bob user, when Bob is open I want every terminal result with suppressed full speech to schedule the short Bob Chime once, so that I receive a discreet auditory cue whenever the browser permits audio.
19. As a Bob user, I want the Bob Chime to have an original identity rather than imitate Discord, Slack, Google Meet, or another known application.
20. As a Bob user, I do not want browser notifications or notification-permission prompts.
21. As a Bob user, I want manual playback to remain available when automatic speech is suppressed, so that I can listen when ready.
22. As a Bob user, I want near-simultaneous eligible Bob Chimes briefly serialized rather than overlapped or dropped, so that every live silenced result has one delivery attempt.
23. As a Bob user, I want the Bob Chime to reveal no response content, so that the cue is safe in a shared space.
24. As a Bob operator, I want Bob to prove every managed process tree has stopped before startup reconciliation releases its ownership, so that an interrupted Agent Work record cannot leave an untracked writer running.
25. As a Bob operator, I want harness-specific support declared explicitly, so that Bob does not imply safe background execution where an adapter cannot provide it.

## Behavioral Contract

### Agent Work lifecycle

```text
accepted
  -> foreground(agent)
  -> background                    at 120 seconds if still non-terminal
  -> completed | failed | timed_out | cancelled | interrupted

foreground(agent)
  -> completed | failed | timed_out | cancelled | interrupted
```

- The 120-second threshold starts when the Turn enters the agent stage.
- **Promotion** is an atomic persisted transition, not a UI timer and not a timeout.
- Promotion releases the one-per-Conversation foreground slot only after background ownership is durable.
- A completion racing the threshold wins through one compare-and-set transition: Agent Work is either foreground-terminal or background, never both.
- Promotion does not reset the profile's total runtime deadline.
- At most one foreground Agent Work record exists per Conversation. Multiple background records may exist.
- Every terminal transition is idempotent.

### Conversation continuation

- An Agent Work run starts from an isolated branch of the Conversation's canonical harness continuation.
- A foreground run may advance the canonical continuation only when it completes without Promotion and its captured base revision still matches the Conversation revision.
- A promoted run never advances or replaces the canonical continuation, even when no newer Turn has started.
- A late background result enters future agent context through the callback inbox rather than by merging harness session files.
- One foreground Turn receives at most the 20 oldest pending Background Callbacks, ordered by terminal sequence and then stable Background Callback identity. The exact injected batch remains pending unless that non-promoted Turn advances the canonical continuation; the continuation update and acknowledgement of that batch commit atomically. A failed, promoted, or stale Turn acknowledges none of them.
- Recovery must not resume two processes against one continuation file.

### Callback delivery

- A terminal background outcome, its Background Callback, its user-visible message, its pending callback-inbox entry, and its monotonically increasing terminal sequence are committed in one SQLite transaction.
- Because Agent Work has one legal terminal transition, its stable Background Callback identity is derived solely from Agent Work identity and never from retry count or terminal classification.
- Terminal sequence orders callbacks and browser delivery events; stable identity provides idempotency. All persistence occurs before SSE publication.
- SSE is an invalidation channel carrying durable identity and terminal sequence; the database is authoritative after reconnect.
- Success appends an assistant work-result message. Failure, timeout, cancellation, and interruption append classified status messages.
- Progress events may update the Agent Work view but never append Conversation messages.
- Results finishing outside the selected Conversation set its unread indicator; failures retain a distinct failed-work indicator.

### Attention-aware delivery

The browser derives one of three **Attention State** values at event handling time:

```text
attending       document visible + window focused + originating Conversation selected
in_bob          document visible + window focused + another Conversation selected
away            document hidden or window unfocused
```

- `attending`: a successful response or Background Callback may auto-play in full if no other Bob audio is active.
- `in_bob`: suppress full speech, mark the originating Conversation unread, and make the terminal result eligible for the Bob Chime.
- `away`: suppress full speech, mark the originating Conversation unread, and make the terminal result eligible for the Bob Chime.
- Failure, timeout, cancellation, and interruption never auto-play speech; each live terminal result is eligible for the Bob Chime.
- Bob rechecks Attention State after fetching audio and immediately before playback. Losing attention suppresses full speech and selects the Bob Chime path.
- If Bob audio is already active, a new terminal result does not interrupt or queue full speech; it selects the Bob Chime path and remains manually playable.
- Foreground and background terminal results use the same Attention State policy. Promotion changes lifecycle ownership, not speech rules.
- All open Bob tabs elect one browser-wide audio owner. Only that owner may schedule Bob Chimes. If the browser cannot provide safe single-owner coordination, Bob fails closed to visual indicators rather than risk duplicate sound.
- An active Bob browser lifetime begins when its first participating tab opens and ends when its last participating tab closes. Tabs joining an existing lifetime share its baseline, ledger, cursor, queue, and audio-owner election; a later first tab starts a new lifetime.
- The first Bob tab in a new active browser lifetime hydrates the current maximum terminal sequence as its baseline. Results at or below that baseline are historical and never chime; results committed afterward are eligible even when recovered by reconnect hydration.
- The elected audio owner keeps a browser-lifetime delivery cursor and stable-identity ledger shared across tabs. Duplicate SSE events, tab changes, and reconnect hydration schedule at most one attempt for each eligible terminal result.
- A scheduling attempt consumes that terminal result even if the browser blocks or suspends its AudioContext. The durable visual indicator remains authoritative; reopening Bob never replays missed historical chimes.
- Near-simultaneous Bob Chimes are serialized with at least 250 ms between starts; none of the eligible live delivery attempts are overlapped or dropped.
- Bob does not request notification permission and does not use the Web Notification API.

#### Bob Chime sound signature

- The Bob Chime is generated locally with the Web Audio API rather than copied from or sampled from another application.
- It uses one sine oscillator and one triangle oscillator following the same exponential frequency automation: 720 Hz at 0 ms, 960 Hz at 65 ms, and 820 Hz at 180 ms.
- Before the master envelope, the sine and triangle weights are respectively `1.0` and `0.18`, normalized by their sum.
- The master gain is exactly `0` at 0 ms, ramps linearly to `0.1` at 5 ms, ramps exponentially to `0.0001` at 180 ms, and then stops both oscillators. The `0.1` peak is -20 dBFS.
- The 180 ms sound contains no speech or result content and does not imitate Discord, Slack, Google Meet, or another known chat application's motif.
- Bob unlocks its AudioContext on an explicit microphone or playback interaction. If the browser still blocks audio, the one scheduling attempt is consumed, the durable visual indicator remains authoritative, and Bob does not treat the Agent Work result as failed.

### Workspace write safety

- Every configured write root must name an existing directory at admission. Bob resolves it to an absolute real path, thereby resolving symlinks and filesystem-native path casing, and rejects admission when resolution fails.
- Canonical roots overlap when equal or when one is a path-component-boundary ancestor of the other. String-prefix matches without a component boundary do not overlap.
- Every Agent Work record persists its canonical write roots before its adapter starts.
- A promoted writer retains an exclusive lease over overlapping roots until its managed process tree is verified stopped and its terminal transition commits.
- A subsequent foreground Turn may proceed in read-only mode while an overlapping lease exists; Bob passes no write roots to that harness process and states the restriction in its prompt and UI.
- Bob rejects any adapter start that could obtain an overlapping write lease. Returning conversational control must never create concurrent writers in one checkout.
- Isolated worktrees are a later optimization, not an MVP prerequisite.

### Cancellation and restart

- Cancelling background work targets its Agent Work identity, sends `SIGTERM` to its owned process group, waits five seconds, escalates a surviving group with `SIGKILL`, and records `cancelled` only after Bob verifies that the whole process group no longer exists.
- Repeating cancellation is idempotent.
- Every managed run persists a server-observed process-group identity plus a process-birth discriminator; no lifecycle operation trusts a client-supplied PID.
- On graceful shutdown Bob terminates and verifies every managed process group before exiting.
- On startup Bob reconciles each non-terminal Agent Work record by validating its persisted process identity, terminating the matching process group when it still exists, and verifying absence before committing `interrupted` and releasing its write lease or foreground slot.
- If Bob cannot safely distinguish, terminate, or verify a recorded process group, startup fails closed: the record stays non-terminal, its write leases remain held, and Conversation admission for overlapping roots remains blocked. Bob never marks work interrupted merely because the previous server process disappeared.
- Existing Pi Conversation recovery remains available on the next foreground Turn only after reconciliation succeeds; interrupted Agent Work itself is not replayed automatically.

## Implementation Decisions

1. Add an Agent Work coordinator as the single deep module responsible for durable lifecycle transitions, Promotion timers, process ownership, cancellation, continuation revisions, callback transactions, write leases, startup reconciliation, and event publication.
2. Narrow VoiceService to transcription, Turn admission, result speech synthesis, and delegation to the Agent Work coordinator. It must no longer own a long-lived harness promise directly.
3. Replace the one-shot AgentRuntime contract with a managed-run contract that starts a run and exposes a stable run handle, lifecycle events, graceful cancellation, terminal result, continuation branch, server-observed process-group identity, and adapter capabilities.
4. Implement managed detached work for Pi in the MVP. Existing Claude support remains foreground-only until its adapter proves isolated continuation, process ownership, and cancellation semantics. OMP and pi-agent-rust adapters are out of scope; this PRD does not claim they exist.
5. Require adapters to declare `detachedWork`, `continuationFork`, `recursiveTermination`, and `cancellation` capabilities. Automatic Promotion is enabled only when all required capabilities are present; unsupported Conversations display the existing foreground behavior honestly.
6. Persist Agent Work separately from Turns. The record includes its originating Turn and Conversation, harness, mode, state, stage, base continuation revision, adapter run identity, server-observed process-group identity and birth discriminator, timestamps, unchanged deadline, canonical write roots, terminal sequence, terminal classification, and error.
7. Persist callback-inbox entries separately from display messages. Inject at most 20 oldest pending entries by terminal sequence and acknowledge the exact batch atomically with a successful canonical continuation update.
8. Version the canonical Conversation continuation and update it through compare-and-set. A stale foreground completion becomes a Background Callback rather than overwriting newer continuation state.
9. Extend Conversation projection to return the foreground Turn plus active and recent Agent Work. Do not overload one `active_turn` field with multiple executions.
10. Extend SSE with Agent Work events carrying Agent Work identity, Conversation identity, mode, state, stage, terminal sequence, and terminal classification. Existing clients must ignore unknown event fields safely during migration.
11. Add a local API to list Agent Work for a Conversation and cancel one record. Cancellation is addressed by Agent Work identity, never by a client-supplied PID.
12. Re-enable the Conversation voice control only after receiving or hydrating the durable `background` transition. Render a compact Agent Work card rather than treating Promotion as a completed assistant response.
13. Keep the existing profile timeout as the total execution deadline. Promoted Agent Work that reaches the current ten-minute limit emits a `timed_out` Background Callback and terminates.
14. Give every managed run recursive process-group ownership. Cancellation, timeout, graceful shutdown, and startup reconciliation send `SIGTERM`, wait five seconds, escalate survivors with `SIGKILL`, and verify the whole group is absent before a terminal transition releases ownership; unverifiable startup state fails closed.
15. Add one browser attention service as the sole source of document visibility, window focus, selected Conversation, audio occupancy, browser-wide audio-owner election, browser-lifetime terminal baseline, and chime-delivery cursor. Components must not infer these independently.
16. Keep Piper synthesis and manual playback available for every successful assistant result. The browser attention service decides automatic playback after the audio fetch and a final Attention State check.
17. Generate the Bob Chime from the exact deterministic Web Audio frequency, mix, and gain automation specified above; do not ship or derive a sampled sound from another application.
18. Use durable terminal sequence and identity to trigger at most one live-session chime attempt through the elected audio owner. Do not add browser-notification permissions, service workers, or a second backend notification queue.
19. Migrate existing Turn rows without synthesizing Agent Work. Startup migration and reconciliation must be idempotent.

### Deepening opportunity

Agent Work coordination becomes the locally complete lifecycle boundary currently spread across VoiceService, JobsService, TurnStore, PiRpcService, SessionService, and UI-local status maps. A browser attention service similarly replaces the current selected-Conversation-only autoplay condition. Consumers use these two contracts instead of independently inferring whether a process, Turn, message, SSE event, selected Conversation, or focused window represents active attention.

## API and UI Contract

- Conversation detail returns its latest foreground Turn and a bounded list of active and recent Agent Work.
- An Agent Work list endpoint returns durable records; clients do not reconstruct them from SSE history.
- A cancel endpoint returns the resulting durable state and is safe to retry.
- The Conversation shows foreground media and agent stages as today.
- On Promotion, the foreground spinner becomes an Agent Work card and the voice control becomes available.
- The sidebar distinguishes unread successful Background Callbacks from failed Agent Work without relying on color alone.
- Opening a Conversation clears only its unread presentation state; it does not delete Agent Work history or Background Callback records.
- For each eligible live terminal result with suppressed full speech, one elected browser audio owner schedules at most one Bob Chime attempt after durable deduplication; historical hydration never replays sound.
- Bob has no browser-notification toggle or permission prompt.
- Manual Play and Stop remain available on assistant messages regardless of whether automatic playback was suppressed.

## Testing Decisions

Tests defend observable lifecycle, safety, Attention State, and Bob Chime contracts, not timer implementation, SQL statements, or component structure.

1. Use a fake clock and fake managed adapter to prove that Agent Work remains foreground at 119,999 ms and is durably background at 120,000 ms.
2. Prove that completion racing Promotion yields exactly one legal state and one Background Callback at most.
3. Prove that Promotion releases foreground admission only after persistence succeeds and that the same managed Pi process reaches a durable, user-visible terminal outcome.
4. Prove that a promoted completion cannot replace a newer canonical continuation.
5. Prove that pending Background Callbacks are selected in terminal-sequence order, capped at 20, and acknowledged as an exact batch only when the receiving Turn atomically advances the canonical continuation.
6. Prove a failed, promoted, or stale receiving Turn acknowledges no Background Callbacks and receives the same oldest batch again on the next eligible Turn.
7. Prove duplicate terminal events and SSE retries produce one Background Callback identity, terminal sequence, and Conversation message.
8. Prove cancellation terminates and verifies the whole adapter process group before recording `cancelled`, and that repetition is idempotent.
9. Prove the original profile deadline terminates and verifies promoted Agent Work before recording `timed_out`.
10. Prove graceful shutdown terminates all managed process groups before exit.
11. Prove startup reconciliation validates persisted process identity, kills a surviving group, verifies absence, and only then records `interrupted` and releases ownership.
12. Prove ambiguous, reused, inaccessible, or otherwise unverifiable process identity fails startup closed while preserving the non-terminal record, write lease, and overlapping-root admission block.
13. Prove configured write roots must be existing directories, resolve through symlinks and filesystem-native casing to absolute real paths, and use path-component ancestry rather than string-prefix overlap.
14. Prove overlapping canonical roots force later Agent Work into enforceable read-only mode, while disjoint roots do not.
15. Extend Turn-store and Session-service SQLite tests for migration, terminal sequence, stable Background Callback identity, compare-and-set continuation ownership, exact-batch acknowledgement, terminal transactions, and restart reconciliation.
16. Add Pi adapter process tests for Promotion survival, recursive process-group cancellation, graceful shutdown, startup cleanup, PID-reuse protection, exit-before-settle, and timeout classification.
17. Add API tests for foreground conflict, post-Promotion admission, Agent Work listing, cancellation, terminal-sequence hydration, and reconnect recovery.
18. Use injected document visibility, window focus, selected Conversation, and audio occupancy to test every Attention State branch deterministically.
19. Prove an `attending` successful completion auto-plays full speech only when audio is idle and Attention State still holds after audio fetch.
20. Prove `in_bob` and `away` suppress full speech, mark only the originating Conversation unread, and route eligible live results to the elected browser audio owner.
21. Prove multi-tab election permits only one audio owner, safe-election failure produces visual-only delivery, and tab leadership changes do not duplicate a scheduling attempt.
22. Prove a new browser lifetime establishes its terminal-sequence baseline without replaying historical results, while reconnect hydration recovers eligible post-baseline results exactly once.
23. Prove blocked or suspended AudioContext consumes one scheduling attempt without retry, duplicate SSE events do not reschedule it, and durable visual state remains correct.
24. Use an offline AudioContext to prove the two exact frequency ramps, normalized `1.0:0.18` oscillator mix, `0→0.1→0.0001` gain envelope, 180 ms stop, and absence of sampled audio.
25. Prove near-simultaneous eligible results serialize scheduling attempts with at least 250 ms between starts without dropping any.
26. Add UI tests showing voice-control re-enablement, Agent Work cards, unread success, failed-work indication, Attention State-aware speech, browser-wide chime ownership, and manual playback.
27. Add an end-to-end smoke scenario with an injected clock where deterministic Pi Agent Work crosses the exact 120-second threshold, the user completes another Turn, and the first result later appears once with the correct Attention State-dependent speech or Bob Chime attempt.

## Behavioral surface touched

Bob has no runtime-contract directory today. Implementation must add a durable background-work contract covering lifecycle states, Promotion timing, continuation ownership, ordered Background Callback delivery, canonical write roots and leases, recursive process ownership, fail-closed restart reconciliation, Attention State, speech eligibility, browser-wide Bob Chime ownership and deduplication, and the exact content-free sound signature. The PRD extends Bob's runtime behavior; the contract addition is in scope.

## Out of Scope

- A live `/collab`-style worker viewer or externally shareable worker link.
- Continuous progress streaming from arbitrary harness internals.
- Automatic restart or resumption of interrupted Agent Work.
- Extending the existing total runtime deadline beyond the profile timeout.
- Concurrent writers to one checkout.
- Automatic isolated-worktree creation.
- Merging divergent Pi or Claude session files.
- Migrating Bob from Pi to OMP.
- Implementing OMP or pi-agent-rust adapters.
- Browser notifications, notification permissions, service workers, push services, operating-system-native notification daemons, Hermes, Discord, Slack, or email delivery.
- Speech queues, interruption priority, or speaking Background Callbacks after Attention State returns.
- Grilled PRD verification and the broader skills evaluation.

## Success Criteria

1. A supported Pi Turn still running in the agent stage at two minutes durably undergoes Promotion, the same Conversation accepts a new Turn, and the promoted process later reaches one durable user-visible terminal outcome.
2. The promoted process continues until its original terminal outcome, cancellation, server interruption, or unchanged profile deadline.
3. A promoted terminal outcome has one stable Background Callback identity and terminal sequence, appears exactly once in the originating Conversation, and survives UI reconnect.
4. Later foreground agents receive pending Background Callbacks in bounded terminal-sequence order; only the exact batch included in a successful canonical continuation update is acknowledged.
5. No promoted or stale run can overwrite a newer canonical continuation.
6. No two Agent Work records hold overlapping canonical write leases, including across Bob restart.
7. The user can list and cancel background Agent Work by stable identity.
8. Bob verifies every managed process group has stopped before recording interruption or releasing ownership; unverifiable startup state fails closed.
9. Unsupported adapters never imply background Agent Work support.
10. A successful result auto-plays full speech only when Bob is visible, focused, showing its Conversation, and not already playing audio.
11. For every eligible live terminal result with suppressed full speech, exactly one elected browser audio owner schedules at most one Bob Chime attempt; historical, duplicate, blocked, or multi-tab delivery never causes replay.
12. The Bob Chime uses the exact deterministic 180 ms frequency, oscillator-mix, and gain signature and contains no result content.
13. Bob never requests browser-notification permission or uses the Web Notification API.

## Further Notes

Wayfinder was used here as a planning discipline rather than an execution engine: the destination was a decision-complete Bob-local PRD, and repository evidence resolved the immediate design frontier. The implementation remains separate work.

## Glossary / Pending vocabulary

Canonical definitions live in the [Bob glossary](../../../CONTEXT.md#language):

- **Conversation**
- **Turn**
- **Agent Work**
- **Promotion**
- **Background Callback**
- **Attention State**
- **Bob Chime**

Pending vocabulary: none.

`callback inbox`, `write lease`, `terminal sequence`, `process-birth discriminator`, `browser audio owner`, and `delivery cursor` remain lower-case implementation mechanisms rather than Bob domain terms.
