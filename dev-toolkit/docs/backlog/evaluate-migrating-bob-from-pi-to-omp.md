# Evaluate migrating Bob from Pi to OMP

Status: Backlog

## Problem

Bob currently treats Pi as its primary agent harness. Evaluate whether Bob should move its primary harness to OMP (Oh My Pi) instead of Pi.

## Evaluation areas

- Session creation, continuation, compaction, and recovery.
- Tool and extension compatibility.
- Background subagent execution and completion notifications.
- Model/provider configuration and thinking controls.
- Streaming, cancellation, timeout, and error behavior.
- Conversation-memory integration.
- Operational complexity, packaging, and upgrade strategy.
- Compatibility or migration requirements for existing Pi sessions and profiles.

## Desired outcome

Produce a recommendation to retain Pi, adopt OMP, or support a staged migration, with a bounded implementation and rollback path.

## Scope

This is Bob architecture and runtime work. It does not belong to the Tickr product backlog.
