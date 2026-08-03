# Bob

<img src="./ui/public/bob.svg" alt="Bob cartoon construction worker" width="160" />

Bob is a local, self-hosted voice assistant for your own workspace. The browser records a turn, a local server transcribes it with Whisper, sends it to Pi or the optional Claude CLI, synthesizes speech with Piper, and stores the conversation in local SQLite.

Bob is not a hosted service. Each installation selects its workspace, profiles, models, and executable paths.

```text
browser microphone
  → Whisper/ffmpeg
  → Pi (default) or Claude CLI
  → Piper
  → browser playback
        ↘ SQLite conversation history
```

## Quick start

### Using a CLI coding agent

From the cloned repository root, give Claude Code, Pi, Codex CLI, or another coding agent this instruction:

```text
Set up this Bob clone by following the Agent setup contract in INSTALL.md.
Inspect the machine first, use the safe defaults, ask only the unresolved
questions allowed by the contract, run the non-billed smoke test, and verify
the running UI and API. Do not commit local configuration or credentials.
```

The contract tells the agent what to detect automatically, which safe defaults to use, the few conditions that justify a user question, and the observable checks required before setup is complete.

Requirements: Node.js 22 or newer and npm. Normal voice use also requires Pi, Whisper, ffmpeg, Piper, and local speech model files. Claude CLI is optional.

```bash
npm run install:all
npm run smoke:offline
npm run dev
```

Open <http://127.0.0.1:5555>. The offline smoke test invokes no model provider or speech binary and incurs no model charges.

The optional `Justfile` adds a managed background lifecycle:

```bash
just up
just status
just logs server
just down
```

`just up-headroom` starts Headroom cache and token proxies on `127.0.0.1:8787` and `127.0.0.1:8788`, then routes Bob through the cache proxy. Plain `just up` starts no proxies.

For normal voice operation, copy `.env.example` to `.env`, set `BOB_WORKSPACE_PATH`, and configure the speech binaries and model files. See [INSTALL.md](INSTALL.md).

## Profiles

Bob loads profile directories from `BOB_PROFILES_PATH`. Each profile contains a validated `profile.json` and may add a system prompt, skills, MCP configuration, and Pi extensions.

The bundled `profiles/sample/` profile is generic and has no write roots, operator commands, MCP tools, or project assumptions. Copy it to a user-owned configuration directory before customizing it.

`examples/profiles/tickr/` demonstrates an opt-in project profile with its own prompt, skill, memory tools, and local operator extension. It is not loaded by default.

Machine-specific paths and secrets belong in `.env` or the process environment, not in a profile manifest.

## Agent harnesses

Supported harnesses are:

- **Pi** — documented and runtime default.
- **Claude CLI** — optional; selected with `BOB_AGENT_HARNESS=claude` or an existing Claude session.

Bob has no separate OMP adapter. Offline test mode is an integration mode, not an agent harness.

## Local networking

The API and Vite development server bind to `127.0.0.1` by default. Bob has no built-in user authentication. Do not bind it to `0.0.0.0`, a LAN address, or a public interface without an authenticated HTTPS reverse proxy.

## Data and privacy

Conversations are stored in the SQLite file selected by `DATABASE_PATH`. Provider-backed Pi and Claude models send prompts to their configured provider. Whisper, ffmpeg, and Piper are local child processes. Synthesized audio is kept under the operating system temporary directory for up to 24 hours.

SQLite data is not encrypted by Bob. Profiles, MCP servers, skills, and Pi extensions are trusted local code and can access data allowed by their process permissions. Read [SECURITY.md](SECURITY.md) before enabling write access or remote access.

## Development

```bash
npm run build
cd server && npm test -- --runInBand
npm run smoke:offline
```

The server listens on `127.0.0.1:5556`; the UI listens on `127.0.0.1:5555` and proxies `/api` to the server.

## License

MIT. See [LICENSE](LICENSE).
