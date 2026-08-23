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

Keep workspace ownership safe after Promotion. Capture normalized write roots when Agent Work is admitted, retain exclusive ownership for promoted writers until terminal, and let a later Turn continue only when its effective adapter permissions cannot overlap those roots. Surface enforced read-only operation clearly in both the agent prompt and Bob UI.

## Acceptance criteria

- [ ] Every configured write root must identify an existing directory; admission resolves it to an absolute real path that reflects symlinks and filesystem-native casing, then persists that canonical root before the adapter starts.
- [ ] Admission rejects nonexistent, non-directory, inaccessible, or otherwise unresolvable write roots rather than weakening workspace protection.
- [ ] Canonical roots overlap only when equal or when one is a path-component-boundary ancestor of the other; plain string-prefix matches without a component boundary do not overlap.
- [ ] A promoted writer retains exclusive ownership of every overlapping canonical root until its managed process group is verified stopped and its durable terminal transition commits.
- [ ] A later Turn with disjoint roots proceeds with its declared permissions; a later Turn with overlapping roots proceeds only through an enforceable read-only adapter mode that receives no write roots.
- [ ] The read-only restriction is stated in the later agent's prompt and visible in the Conversation UI before work begins.
- [ ] Bob rejects an adapter start when the adapter could still obtain overlapping write access; returning Conversation control never creates concurrent writers in one checkout.
- [ ] Terminal completion releases ownership idempotently only after process absence is verified, including terminal outcomes produced while a subsequent read-only Turn is active.
- [ ] Unit and integration tests cover real-path normalization, symlink and native-case resolution, invalid-root rejection, ancestor/descendant overlap, path-component boundaries, disjoint roots, enforced read-only admission, unsafe-adapter rejection, terminal release, and concurrent admission races.

## Behavioral surface touched

- **Path** — `dev-toolkit/docs/contracts/background-agent-work.md`.
- **How this slice interacts** — extends the contract with admission-time write-root capture, promoted ownership retention, overlap rules, read-only fallback, rejection, and terminal release.
- **Contract update required?** — yes; update lands inside `bob` in this slice.

## Constraints

Code, commits, comments, tests, and PR descriptions written for this issue must not reference any path inside Bob's `dev-toolkit/` or the workspace methodology repo — no `~/tickr-io/developer-toolkit/docs/prd/`, `docs/issues/`, `docs/adr/`, `docs/rfc/`, `docs/contracts/`, `CONTEXT-MAP.md`, or `contexts/`. The product code must read as self-contained. Use canonical Bob glossary terms in identifiers and prose; restate the reason inline when it matters instead of linking to a methodology artifact.

Read-only mode must be enforced by adapter permissions, not merely requested in prose. Do not add automatic worktree creation or permit concurrent writers to one checkout.

## Blocked by

- [02-promote-and-deliver-pi-agent-work.md](./02-promote-and-deliver-pi-agent-work.md)
