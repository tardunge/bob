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

Track every accepted Turn as one durable foreground Agent Work record and run supported Pi work through a managed adapter handle without changing existing foreground Conversation behavior. Expose the stable Agent Work identity and current foreground state through Bob's local API, Conversation projection, and SSE stream. Declare adapter capabilities explicitly so unsupported harnesses remain honestly foreground-only.

## Acceptance criteria

- [ ] Every accepted Pi Turn creates exactly one durable foreground Agent Work record linked to its Turn and Conversation, with stable identity, harness, mode, state, stage, timestamps, unchanged profile deadline, base continuation revision, canonical write roots, adapter run identity, server-observed process-group identity, and process-birth discriminator.
- [ ] Fresh and upgraded SQLite databases gain Agent Work, terminal-sequence, callback-inbox, and continuation-revision storage idempotently; existing Turn rows do not synthesize historical Agent Work.
- [ ] Pi starts through a managed-run contract that exposes lifecycle events, a stable handle, terminal result, continuation branch, server-observed recursive process ownership, graceful cancellation, and adapter capabilities; normal foreground completion retains Bob's existing response behavior.
- [ ] Adapter capability declarations are authoritative: Pi advertises only capabilities it implements, including recursive termination; Claude remains foreground-only, and Bob never implies background support for an unsupported adapter.
- [ ] Conversation detail and a read-only Agent Work endpoint return the latest foreground record, while SSE publishes the persisted foreground identity and state for immediate UI invalidation.
- [ ] The existing foreground media and agent stages still render correctly after hydration and SSE reconnect; unknown Agent Work event fields remain safely ignorable during migration.
- [ ] Contract and integration tests cover one-record-per-Turn identity, migration idempotency, server-observed process identity, foreground completion, capability gating, API projection, SSE ordering after persistence, and unchanged foreground UI behavior.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md` (new; the surface is currently undocumented).
- **How this slice interacts** — creates the Agent Work admission, foreground ownership, managed-adapter capability, persistence-before-publication, and foreground terminal-state contract.
- **Contract update required?** — yes; the contract is created inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Do not add an OMP or pi-agent-rust adapter, change Claude's foreground-only support, synthesize Agent Work for historical Turns, or alter the profile's total runtime deadline.

## Blocked by

None — can start immediately.
