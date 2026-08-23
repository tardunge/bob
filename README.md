<p align="center">
  <img src="ui/public/bob.svg" width="144" alt="Bob logo">
</p>

<h1 align="center">Bob</h1>

<p align="center">
  <strong>A local, self-hosted voice interface for coding agents.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tardunge/bob?style=flat-square&color=2563eb" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22 or newer">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="Strict TypeScript">
  <img src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/harnesses-Pi%20%7C%20OMP%20%7C%20Claude-7c3aed?style=flat-square" alt="Pi, OMP, and Claude harnesses">
  <img src="https://img.shields.io/badge/network-localhost%20by%20default-0f766e?style=flat-square" alt="Localhost by default">
</p>

Bob records a browser voice turn, transcribes it locally with Whisper, sends the
text to a selected coding-agent harness, synthesizes the response locally with
Piper, and stores conversation history in SQLite. It is a single-user local
application—not a hosted service.

## Features

- **Three harnesses:** Pi by default, explicit OMP support, and optional Claude CLI.
- **Local voice pipeline:** browser audio, FFmpeg, whisper.cpp, and Piper.
- **Durable long-running work:** automatic background promotion, cancellation,
  callback delivery, restart reconciliation, and process ownership.
- **Safe profiles:** declared read/write roots, tools, skills, MCP servers,
  extensions, models, and voice configuration.
- **Visible boundaries:** every empty conversation shows the selected harness
  and its effective read, write, shell, web, MCP, and background capabilities.
- **Usage visibility:** per-turn context, token, cache, and cost accounting when
  the selected provider reports it.
- **Local memory:** profile-scoped conversation search plus a reusable read-only
  MCP example.
- **Fail-closed networking:** localhost by default; non-loopback binds require
  explicit authenticated-proxy mode.

## Prerequisites

| Requirement | Version or purpose |
|---|---|
| [Node.js](https://nodejs.org/) | 22 or newer |
| npm | Dependency and command runner |
| [Pi](https://github.com/badlogic/pi-mono), [OMP](https://github.com/can1357/oh-my-pi), or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Agent harness |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Local transcription (`whisper-cli` plus a `.bin` model) |
| [FFmpeg](https://ffmpeg.org/) | Browser-audio conversion |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | Local speech (`piper` plus an `.onnx` voice) |

The deterministic offline smoke test requires no model provider or speech
binary and incurs no model cost.

## Quick start

```bash
git clone https://github.com/tardunge/bob.git
cd bob
npm run install:all
npm run setup
npm run doctor
npm run smoke:offline
npm run dev
```

Open <http://127.0.0.1:5555>.

`npm run setup` is an interactive configuration wizard. It detects installed
harnesses, chooses platform-standard private data directories, installs a copy
of the read-only sample profile, and writes the ignored `.env` file. It does
not enable write access, remote binding, or provider-backed requests.

`npm run doctor` prints a non-secret preflight report covering Node, profile,
workspace, database, harness, speech assets, and network policy.

See [INSTALL.md](INSTALL.md) for harness authentication, speech-model setup,
agent-assisted installation, Headroom, managed background processes, and
remote-proxy configuration.

## Agent harnesses

| Harness | Status | Background work | Continuation |
|---|---|---:|---|
| **Pi** | Default | Yes | Isolated forked session |
| **OMP** | Optional | Yes | Isolated RPC session with `--resume` |
| **Claude CLI** | Optional | No | Claude session ID |

Pi remains the default. OMP has a separate adapter and configuration surface;
Bob never disguises OMP as `BOB_PI_BINARY`.

```dotenv
# Pi (default)
BOB_AGENT_HARNESS=pi
BOB_PI_BINARY=pi

# OMP
BOB_AGENT_HARNESS=omp
BOB_OMP_BINARY=omp

# Claude CLI
BOB_AGENT_HARNESS=claude
BOB_CLAUDE_BINARY=claude
```

## Profiles and permissions

Bob loads profiles from `BOB_PROFILES_PATH`. A validated `profile.json` can
select a harness and model, append a system prompt, narrow write roots, and add
trusted skills, MCP configuration, or harness extensions.

- `profiles/sample/` is generic and read-only.
- `examples/profiles/tickr/` is an opt-in project-specific example.
- `examples/mcp/conversation-memory.mjs` is a reusable read-only MCP server for
  listing, searching, and reading conversations belonging to the active profile.

Profiles and everything they execute are trusted local code. Review them before
installation. The UI capability envelope distinguishes declared roots from the
boundary the selected harness actually enforces.

## Architecture

```text
Browser microphone
       │
       ▼
Bob API ──► FFmpeg ──► Whisper
       │
       ▼
AgentRuntime
  ├── Pi RPC
  ├── OMP RPC
  └── Claude CLI
       │
       ▼
SQLite history ──► Piper ──► browser playback
```

The NestJS API owns sessions, durable Agent Work, usage, memory, and audio. The
React UI receives lifecycle updates over server-sent events. Provider-backed
harnesses may send prompts and tool results to their configured model provider;
speech processing stays local.

## Network and security

Bob binds the API and UI to `127.0.0.1` by default. It has no built-in login,
multi-user authorization, tenant boundary, TLS termination, or encrypted
SQLite store.

A non-loopback bind is rejected unless `BOB_REMOTE_MODE=proxy` is set with
explicit origins and hostnames. Proxy mode is an acknowledgement, not an auth
implementation: an authenticated HTTPS reverse proxy is still required.

Read [SECURITY.md](SECURITY.md) before enabling write roots, extensions, MCP
servers, or remote access.

## Development

```bash
npm run build
cd server && npm test -- --runInBand
cd ../ui && npm test
cd .. && npm run smoke:offline
```

Optional Unix lifecycle shortcuts are available through `just`:

```bash
just up
just status
just logs server
just down
```

## Documentation

- [Installation and setup](INSTALL.md)
- [Security and privacy](SECURITY.md)
- [License](LICENSE)

## License

Bob is available under the [MIT License](LICENSE).
