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

Let the user cancel one background Agent Work record by stable identity and classify cancellation, unchanged profile timeout, and Bob restart through the durable terminal Background Callback path. Own the managed Pi process group recursively and never release lifecycle or workspace ownership until Bob verifies that the whole group has stopped.

## Acceptance criteria

- [ ] A local cancel endpoint addresses Agent Work by stable identity, sends `SIGTERM` to its server-observed Pi process group, waits five seconds, escalates a surviving group with `SIGKILL`, and records `cancelled` only after verifying that no member remains.
- [ ] Repeating cancellation returns the same durable state without signalling unrelated Agent Work or duplicating a Background Callback.
- [ ] The original profile deadline applies the same recursive termination and verification before recording `timed_out`; Promotion never resets or extends that deadline.
- [ ] Graceful Bob shutdown terminates and verifies every managed process group before the server exits.
- [ ] Startup reconciliation validates each non-terminal record's persisted process-group identity and birth discriminator, terminates the matching surviving group, verifies absence, and only then records `interrupted` and releases lifecycle and write ownership.
- [ ] Reused, ambiguous, inaccessible, or otherwise unverifiable process identity fails startup closed: Bob does not kill an unrelated process, the record remains non-terminal, its write leases remain held, and overlapping-root Conversation admission remains blocked.
- [ ] Interrupted Agent Work is not adopted, resumed, or replayed automatically; existing Pi Conversation recovery becomes available only after successful reconciliation.
- [ ] The work card offers cancellation only for cancellable non-terminal Agent Work and renders distinct cancelled, timed-out, interrupted, failed, and successful outcomes without relying on color alone.
- [ ] Cancel, timeout, failure, and restart consume the exactly-once terminal transaction and Background Callback publication path owned by the Promotion slice.
- [ ] Process, API, persistence, restart, and UI tests cover recursive termination, five-second escalation, process-birth validation, PID reuse, unverifiable fail-closed startup, exit-before-settle, cancel races, retry safety, deadline preservation, classified presentation, and isolation from other Agent Work.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with stable-identity cancellation, recursive process ownership, timeout classification, startup interruption, idempotency, and foreground-admission recovery.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Never cancel by client-supplied PID. Do not claim process adoption, automatic resumption, or a longer post-Promotion timeout.

## Blocked by

- [02-promote-and-deliver-pi-agent-work.md](./02-promote-and-deliver-pi-agent-work.md)
