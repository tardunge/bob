---
name: operate-tickr
description: Operate a local Tickr formation through its documented commands and localhost API.
---

# Operate Tickr

Use this skill only when the user asks to start, stop, inspect, register, or trigger a local Tickr formation.

1. Read the workspace’s current Tickr operating instructions before choosing commands or payloads.
2. Use only operator commands allowed by the active profile.
3. Send API requests only to localhost endpoints documented by the workspace.
4. Fetch status once per user request; never create an unbounded polling loop.
5. Do not print secrets, environment files, credentials, or full authorization headers.
6. Report the exact formation, workflow, build, or run identifier returned by the command or API.
7. If a prerequisite service is unavailable, report the failing readiness check instead of guessing.
