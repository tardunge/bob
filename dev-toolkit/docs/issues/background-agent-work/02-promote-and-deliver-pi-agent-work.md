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

Carry supported Pi Agent Work through a complete Promotion tracer bullet: persist background ownership at 120 seconds, release the Conversation's foreground slot, keep the same process and original deadline, admit another Turn, and deliver the promoted process's eventual terminal outcome once as a durable Background Callback visible after reconnect.

## Acceptance criteria

- [ ] The Promotion clock begins only when the Turn enters the agent stage; Agent Work is foreground at 119,999 ms and durably background at 120,000 ms when still non-terminal.
- [ ] Promotion is one atomic compare-and-set transition: a racing completion produces either one foreground terminal state or one background state at the threshold, never both.
- [ ] The one-per-Conversation foreground slot is released only after background ownership is durable; a new Turn is then admitted in the same Conversation.
- [ ] Promotion preserves the same managed Pi process, accumulated work, isolated continuation branch, canonical write roots, and original profile deadline; it neither restarts the process nor extends its runtime.
- [ ] A promoted run never advances or replaces the canonical Conversation continuation.
- [ ] Bob publishes the persisted background transition once through SSE and returns it through Conversation and Agent Work hydration after reconnect.
- [ ] When the promoted process terminates, one SQLite transaction records its terminal state, Background Callback identity derived solely from Agent Work identity, monotonically increasing terminal sequence, user-visible result or classified status message, and pending callback-inbox entry before terminal SSE publication.
- [ ] Duplicate harness terminal events, retries, and reconnects converge on one terminal state, one Background Callback, one terminal sequence, and one Conversation message.
- [ ] The UI re-enables voice control only after observing or hydrating the durable background transition, renders a compact Agent Work card with stable identity, summary, state, start time, and elapsed time, and later replaces or completes that presentation with the durable terminal result.
- [ ] Unsupported adapters retain the existing foreground behavior without a Promotion timer, background card, or false capability claim.
- [ ] Fake-clock, race, API, SSE, SQLite, UI, and managed-process tests prove exact threshold behavior, persistence-before-admission, process survival, unchanged deadline, post-Promotion Turn admission, terminal delivery, exactly-once identity, and reconnect hydration.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with the 120-second Promotion transition, race semantics, durable foreground-slot release, process survival, complete terminal Background Callback transaction and publication, and UI hydration.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Promotion is not a timeout, must not reset the profile deadline, and must not be implemented as a browser timer. This slice owns terminal Background Callback persistence and publication; do not add future-Turn callback injection or acknowledgement, write-lease admission behavior, cancellation, restart reconciliation, Attention State, or Bob Chime behavior owned by later slices.

## Blocked by

- [01-track-foreground-agent-work.md](./01-track-foreground-agent-work.md)
