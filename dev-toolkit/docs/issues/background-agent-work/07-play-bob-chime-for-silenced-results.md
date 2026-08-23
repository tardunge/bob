---
type: issue
status: done
parent: background-agent-work
repositories: [bob]
owner: null
superseded_by: null
updated: 2026-08-18
---

## Parent

[Background Agent Work PRD](../../prd/background-agent-work/PRD.md)

## Execution mode

AFK

## What to build

Schedule Bob's original short chime at most once for each eligible live terminal result whose full speech is suppressed. Elect one audio owner across all open Bob tabs, establish a terminal-sequence baseline for each active browser lifetime, deduplicate live and reconnect delivery, serialize bursts, and retain authoritative visual delivery when coordination or browser audio is unavailable. Bob must not use browser notifications.

## Acceptance criteria

- [ ] An active Bob browser lifetime begins when its first participating tab opens and ends when its last participating tab closes; tabs joining an existing lifetime share its state, while a later first tab starts a new lifetime and hydrates the current maximum terminal sequence as its baseline. Results at or below that baseline are historical and never schedule sound.
- [ ] All open Bob tabs elect one browser-wide audio owner, and only that owner may schedule Bob Chimes; if safe single-owner coordination is unavailable, delivery fails closed to visual indicators.
- [ ] Eligible results are durable terminal results committed after the browser-lifetime baseline whose full speech was suppressed, including failed, timed-out, cancelled, and interrupted Agent Work.
- [ ] A browser-lifetime delivery cursor and stable-identity ledger shared across tabs deduplicate each eligible result across duplicate SSE events, tab leadership changes, and reconnect hydration.
- [ ] Each eligible result consumes one scheduling attempt even when the browser blocks or suspends its AudioContext; visual state remains correct and later hydration or reopening never replays the missed sound.
- [ ] The Bob Chime uses sine and triangle oscillators with shared exponential frequency automation at exactly 720 Hz at 0 ms, 960 Hz at 65 ms, and 820 Hz at 180 ms.
- [ ] The sine and triangle weights are exactly `1.0` and `0.18`, normalized by their sum; master gain is `0` at 0 ms, ramps linearly to `0.1` at 5 ms, ramps exponentially to `0.0001` at 180 ms, and then stops both oscillators.
- [ ] Near-simultaneous scheduling attempts are serialized with at least 250 ms between starts; none of the eligible live attempts overlap or are dropped.
- [ ] Bob unlocks its AudioContext only from an explicit microphone or playback interaction, and blocked audio never changes the durable Agent Work result.
- [ ] The 180 ms chime contains no response content and ships no sampled sound copied from or intentionally imitating Discord, Slack, Google Meet, or another known application.
- [ ] Bob contains no Web Notification API use, notification-permission prompt, notification setting, service worker, or secondary notification queue.
- [ ] Offline AudioContext tests verify exact frequency automation, normalized oscillator mix, gain envelope, stop time, and absence of sampled audio; browser tests verify multi-tab election, visual-only fallback, baseline semantics, reconnect deduplication, tab handoff, blocked audio, and serialization.
- [ ] A browser-driven smoke scenario uses an injected clock to promote deterministic Pi Agent Work at the exact 120-second boundary, admits and completes another Turn, then observes the first terminal result once with the correct Attention State-dependent full speech or single Bob Chime scheduling attempt and no browser notification request.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with browser-lifetime Bob Chime eligibility, terminal-sequence baseline, browser-wide audio-owner election, stable-identity deduplication, single-attempt semantics, exact sound signature, serialization, AudioContext activation, content privacy, and browser-notification exclusion.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Do not add browser notifications or reuse another application's audio. Full-speech queuing and interruption priority remain out of scope.

## Blocked by

- [05-cancel-and-reconcile-background-agent-work.md](./05-cancel-and-reconcile-background-agent-work.md)
- [06-apply-attention-state-to-response-speech.md](./06-apply-attention-state-to-response-speech.md)
