---
type: backlog
kind: tech-debt
status: promoted
promoted_to: background-agent-work
superseded_by: null
updated: 2026-08-18
---

# Long-running work should return conversation control


## Problem

Bob can delegate substantial work to a tracked background subagent and then block the conversation by waiting for that work to finish. This prevents the user from using the same conversation for other topics while the delegated work continues.

## Desired behavior

- Delegate substantial or long-running work asynchronously.
- Return conversation control immediately after reporting what was delegated.
- Do not poll or wait for completion unless the user explicitly asks Bob to wait and report within the current turn.
- Preserve the tracked run so Bob can inspect it when the user asks for status or when Pi reports completion.
- Avoid overlapping writes to the same worktree while a background writer remains active.

## Scope

This is Bob interaction and orchestration behavior. It does not belong to the Tickr product backlog.

## Promotion

Promoted to the [Background agent work PRD](../prd/background-agent-work/PRD.md), which owns two-minute promotion, durable callbacks, continuation safety, cancellation, and focus-aware delivery.
