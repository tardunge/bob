# Track finished conversations and uncaptured work

Status: Backlog

## Problem

Bob may have many concurrent conversation threads. Users can lose track of which threads still contain unfinished business and whether decisions or outcomes were captured in a durable artifact such as a backlog item, PRD, digest, or other document.

## Desired behavior

- Let the user explicitly mark a conversation as finished and reopen it later.
- Persist that state across Bob restarts.
- Distinguish finished and unfinished conversations in the conversation list, using more than color alone.
- Allow users to find or filter conversations that still contain unfinished business.
- Before or while marking a thread finished, show whether its outcomes were:
  - captured in one or more durable artifacts;
  - intentionally left without an artifact; or
  - not yet reviewed for capture.
- Keep finished conversations readable and searchable rather than deleting them.
- Do not infer that a conversation is finished solely because the most recent agent task completed.

## Motivation

This provides a lightweight coordination surface when multiple conversations and background work streams are active. It also helps users revisit threads whose decisions, backlog items, PRDs, or digests have not yet been captured.

## Open questions

- Whether `finished` is a conversation state, a user label, or distinct from archival.
- Whether artifact capture is manually recorded, automatically detected from Bob-authored files, or both.
- Whether Bob should offer a short unfinished-business and artifact-capture review when the user marks a thread finished.
- Which list indicators and filters communicate state accessibly without relying only on color.

## Scope

This is Bob conversation lifecycle, navigation, and durable-artifact awareness. It does not belong to the Tickr product backlog.
