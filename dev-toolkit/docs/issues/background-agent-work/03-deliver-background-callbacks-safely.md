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

Inject durable Background Callbacks from promoted Agent Work into later foreground agent context without allowing any run to rewind the canonical Conversation continuation. Select a bounded, deterministic pending batch and acknowledge exactly that batch only when the receiving Turn atomically advances the canonical continuation.

## Acceptance criteria

- [ ] Every Agent Work run starts from an isolated continuation branch captured against a versioned canonical Conversation revision.
- [ ] A non-promoted foreground completion advances the canonical continuation only through compare-and-set against its captured base revision; a promoted or stale completion never replaces it.
- [ ] One eligible foreground Turn receives at most the 20 oldest pending Background Callbacks, ordered by terminal sequence and then stable Background Callback identity.
- [ ] Callback context enters the agent prompt independently of display messages and identifies the originating Agent Work and terminal classification without exposing implementation paths.
- [ ] The successful canonical continuation update and acknowledgement of the exact injected callback batch commit atomically.
- [ ] A failed, promoted, cancelled, timed-out, interrupted, or stale receiving Turn acknowledges none of its injected callbacks; the next eligible Turn receives the same oldest pending batch.
- [ ] Callbacks beyond the 20-entry batch remain pending for later Turns, preserving terminal-sequence order and eventual delivery.
- [ ] Callback-inbox state survives server restart and UI reconnect without duplicating Conversation messages or terminal SSE publication.
- [ ] Persistence, race, restart, and managed-adapter tests prove compare-and-set continuation ownership, bounded deterministic selection, exact-batch acknowledgement, retry after non-advancing Turns, and eventual delivery of remaining callbacks.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with isolated continuation ownership, bounded terminal-sequence callback selection, prompt injection, atomic exact-batch acknowledgement, retry, and eventual delivery.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Do not merge divergent harness session files. Display-message insertion alone is not callback context delivery. This slice consumes the terminal Background Callback records and pending callback-inbox entries owned by the Promotion slice; it must not create a second terminal transaction, Conversation message, or SSE publication path.

## Blocked by

- [02-promote-and-deliver-pi-agent-work.md](./02-promote-and-deliver-pi-agent-work.md)
