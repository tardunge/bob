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

Centralize browser Attention State and use it to decide whether a successful foreground response or Background Callback may speak in full. Combine document visibility, window focus, selected Conversation, and Bob audio occupancy; recheck immediately before playback; preserve manual playback; keep originating Conversation indicators correct; and expose one terminal-result eligibility decision for the later Bob Chime slice.

## Acceptance criteria

- [ ] One browser attention service derives exactly `attending`, `in_bob`, or `away` from injected document visibility, window focus, selected Conversation, and audio occupancy; UI components do not infer these inputs independently.
- [ ] A successful foreground response or Background Callback auto-plays full speech only while `attending` and Bob audio is idle.
- [ ] Bob rechecks Attention State after fetching audio and immediately before playback; lost attention or newly active Bob audio suppresses full speech.
- [ ] `in_bob` and `away` suppress full speech, mark only the originating Conversation unread, and mark the live terminal result eligible for the Bob Chime; failed Agent Work retains a distinct non-color-only status indicator.
- [ ] Active Bob audio is never interrupted and suppressed asynchronous speech is never queued for later autoplay.
- [ ] Opening the originating Conversation clears only its unread presentation state, not Agent Work history, Background Callback records, or failure classification.
- [ ] Manual Play and Stop remain available on assistant messages whenever generated audio exists, regardless of automatic-speech eligibility.
- [ ] Foreground and background successful results use the same Attention State policy, including after SSE reconnect and Conversation hydration.
- [ ] Deterministic UI tests cover all Attention State branches, final-check races, active-audio suppression, originating-Conversation unread behavior, failure indication, reconnect, and manual playback.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with Attention State derivation, full-speech eligibility, final recheck, unread presentation, Bob Chime eligibility, audio non-interruption, and manual playback.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Do not add browser notifications, notification permissions, service workers, speech queues, or delayed automatic speech after Attention State returns.

## Blocked by

- [02-promote-and-deliver-pi-agent-work.md](./02-promote-and-deliver-pi-agent-work.md)
