# Expose live links for background workers

Status: Backlog

## Problem

When Bob delegates work to a background worker, the user can continue the conversation but has little visibility into what the worker is doing. To understand whether it is reading, editing, testing, blocked, or stalled, the user must repeatedly ask Bob for status.

## Desired behavior

- Whenever Bob starts a background worker, report a stable link that opens a live view of that worker.
- Keep the link visible in the conversation alongside the worker ID, task summary, and current status.
- Let the user inspect streamed activity, tool use, progress, failures, and completion without asking Bob to poll or relay it.
- Keep the main Bob conversation available for unrelated discussion while the worker runs.
- Preserve the view after completion so it can be used to review what happened.
- Have Bob still provide a concise completion summary and surface anything requiring a decision.

## OMP opportunity

Evaluate OMP's `/collab` experience, or an equivalent collaboration/session URL, as the live worker surface. If Bob migrates from Pi to OMP, Bob should return the relevant collaboration link directly in chat when spawning a worker so the user can keep it open independently.

The capability should also be evaluated separately from a full OMP migration: if Pi or Bob can expose an equivalent local run viewer, live worker visibility should not depend unnecessarily on replacing the entire harness.

## Safety and usability constraints

- Default to a local/private view; never publish sessions externally without explicit user approval.
- Redact secrets and credential-bearing tool inputs or outputs.
- Clearly distinguish read-only observation from controls that can steer, interrupt, or stop a worker.
- Show when a link is unavailable or stale rather than implying live visibility.
- Avoid requiring periodic polling by Bob merely to keep the view current.

## Scope

This is Bob background-work observability and harness integration. It complements the existing Bob backlog items for asynchronous conversation control and evaluating migration from Pi to OMP; it does not belong to the Tickr product backlog.
