# Installation

## Agent-assisted setup

If this repository is open in Claude Code, Pi, Codex CLI, or another coding agent, give it this prompt from the repository root:

```text
Set up this Bob clone by following the Agent setup contract in INSTALL.md.
Inspect the machine first, use the documented safe defaults, ask only the
questions the contract says are necessary, run the offline smoke test before
any provider-backed request, and finish by starting Bob and verifying health.
Do not commit machine-local configuration or credentials.
```

### Agent setup contract

The setup agent's goal is a working, private, localhost-only Bob installation—not merely installed npm packages.

Before asking the user anything, the agent must:

1. Detect the operating system, architecture, shell, repository root, Node/npm versions, available package managers, and occupied Bob ports.
2. Locate existing `pi`, `claude`, `whisper-cli`, `ffmpeg`, and `piper` executables with the shell or platform command lookup.
3. Look for existing Whisper `.bin` and Piper `.onnx` models in standard user data directories and alongside any installed speech tools.
4. Check whether `.env` already exists. Preserve valid settings and never print credentials or copy them into tracked files.
5. Check the configured and platform-standard Bob profile/data directories before creating another convention.

Use these defaults without asking:

- Pi harness; Claude CLI only when explicitly requested or Pi cannot be used.
- The bundled `sample` profile as the source for a user-owned profile.
- Read-only workspace access, no operator commands, and no web research.
- `127.0.0.1:5555` for the UI and `127.0.0.1:5556` for the API.
- A platform-standard user data directory for SQLite and Pi sessions.
- Plain Bob with no Headroom, Tailscale, LAN binding, or reverse proxy.
- Existing compatible speech models when exactly one clear choice is available.

After discovery, ask one consolidated question containing only unresolved user decisions:

1. **Workspace:** ask for the workspace directory only when it cannot be inferred unambiguously from the user's request or surrounding directories.
2. **Harness:** ask which harness to install only when neither Pi nor Claude is usable. Otherwise use Pi, or the sole usable harness.
3. **Voice:** ask for transcription language and preferred Piper voice only when no compatible local models exist. Keep this as one question and state the download size when known.
4. **Elevated capabilities:** ask before adding write roots, operator commands, web research, remote access, or any authenticated proxy. A normal first run stays read-only and localhost-only.

Do not ask the user for facts the machine can provide: operating system, CPU architecture, executable paths, installed versions, package manager, free ports, home directory, or whether optional tools are installed. Do not ask about Headroom, Tailscale, LAN access, custom MCP servers, skills, or extensions during the baseline setup.

The agent should then execute this sequence:

1. Install or update Node.js only if it is older than version 22, then run `npm run install:all`.
2. Run `npm run smoke:offline` before configuring or invoking a model provider.
3. Copy `profiles/sample/` into the platform-standard user profile directory, keeping the directory name and manifest ID as `sample`.
4. Create the ignored `.env` from `.env.example`, replacing every placeholder used by the selected setup with an absolute path.
5. Install and authenticate the selected harness. Install speech tools and models if they were not already present.
6. Run `npm run build`.
7. Start Bob, verify `GET http://127.0.0.1:5556/api/health`, and load `http://127.0.0.1:5555`.
8. Confirm the live profile and model catalog through `/api/profiles` and `/api/models`.

Setup is complete only when:

- the offline smoke test passes with zero provider cost;
- the production build passes;
- the API reports `{"status":"ok","testMode":null}`;
- the UI loads from localhost;
- the selected profile and harness are visible;
- all configured executable and model paths exist; and
- the agent reports any remaining manual authentication or microphone permission step explicitly.

The final report must state the selected workspace, profile, harness, local URLs, data locations, verification results, and any optional feature deliberately left disabled. It must not include secrets.

## Manual setup

## 1. Install Node and Bob dependencies

Install Node.js 22 or newer and npm, then run from the repository root:

```bash
npm run install:all
```

The npm commands are the portable interface. The `Justfile` only provides optional Unix shortcuts.

## 2. Configure a profile

The repository includes a read-only generic example at `profiles/sample/`. For customization, copy that directory to a user-owned location such as:

- Linux: `~/.config/bob/profiles/sample`
- macOS: `~/Library/Application Support/Bob/profiles/sample`
- Windows: `%APPDATA%\Bob\profiles\sample`

Use the parent directories as follows:

| Platform | `BOB_PROFILES_PATH` | Suggested local data directory |
|---|---|---|
| Linux | `~/.config/bob/profiles` | `$XDG_DATA_HOME/bob` or `~/.local/share/bob` |
| macOS | `~/Library/Application Support/Bob/profiles` | `~/Library/Application Support/Bob` |
| Windows | `%APPDATA%\Bob\profiles` | `%LOCALAPPDATA%\Bob` |

The user-owned profile can remain unchanged for a safe first run. Its default policy can read the selected workspace but cannot write files, execute operator commands, use web research, or load third-party extensions.

Set `BOB_PROFILES_PATH` to the parent `profiles` directory. Set `BOB_WORKSPACE_PATH` to the workspace the assistant should inspect. Profile IDs must match their directory names.

A profile may declare read roots, write roots, operator commands, skills, MCP configuration, and Pi extensions. Treat profiles and every executable asset they reference as trusted code.

## 3. Configure the environment

Copy `.env.example` to `.env` and replace its example paths. Bob loads `.env` from the repository root; real environment variables take precedence.

At minimum, replace these values:

```dotenv
BOB_WORKSPACE_PATH=/absolute/path/to/the/workspace
BOB_PROFILES_PATH=/absolute/path/to/the/parent/profiles-directory
BOB_DEFAULT_PROFILE=sample
BOB_AGENT_HARNESS=pi
DATABASE_PATH=/absolute/path/to/user-data/bob.db
BOB_PI_SESSION_DIR=/absolute/path/to/user-data/pi-sessions
```

Keep `BOB_HOST` and `BOB_UI_HOST` set to `127.0.0.1`. Do not put provider credentials in `.env` when the selected harness supplies its own credential store.

Use absolute paths for speech model files. Paths may contain spaces and are passed directly as process arguments without shell interpolation.

## 4. Install an agent harness

Pi is the default. Install the current Pi coding agent, start it once, and use `/login` to authenticate a provider:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
```

Confirm `pi --version` succeeds, then set `BOB_PI_BINARY=pi`. If Pi is installed somewhere outside `PATH`, use its absolute executable path instead.

Claude CLI is optional. To use it, install and authenticate Claude Code, set `BOB_CLAUDE_BINARY` if it is not on `PATH`, and select:

```dotenv
BOB_AGENT_HARNESS=claude
```

Bob supports Pi and Claude CLI. It does not contain an OMP adapter.

## 5. Install local speech tools

Bob expects five local assets:

| Setting | Purpose |
|---|---|
| `BOB_WHISPER_BINARY` | Whisper CLI executable |
| `BOB_WHISPER_MODEL_PATH` | Whisper model file |
| `BOB_FFMPEG_BINARY` | Browser-audio conversion |
| `BOB_PIPER_BINARY` | Piper executable |
| `BOB_PIPER_MODEL_PATH` | Piper `.onnx` voice model |

Install these through the package manager appropriate for the operating system or download them from the maintained [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [FFmpeg](https://ffmpeg.org/download.html), and [Piper](https://github.com/OHF-Voice/piper1-gpl) projects. The Piper Python package is `piper-tts`; its voice downloader can fetch a selected `.onnx` model and adjacent `.onnx.json` file. Executables may be command names on `PATH` or absolute paths. Bob does not assume Homebrew, a Unix home layout, or a particular language or voice.

The Piper model’s adjacent JSON configuration file must remain beside the `.onnx` file when required by that voice package.

## 6. Run the non-billed smoke test

```bash
npm run smoke:offline
```

The smoke test starts the Nest application on an ephemeral localhost port, creates a Pi session, submits a fixture voice turn, and verifies the persisted assistant reply. In offline mode Bob does not start Pi, Claude, Whisper, ffmpeg, Piper, MCP servers, or provider requests.

## 7. Start Bob

```bash
npm run dev
```

Open <http://127.0.0.1:5555>. Browser microphone access works on localhost. Both development servers refuse silent port fallback, making conflicts visible.

Verify the API separately:

```bash
curl --fail http://127.0.0.1:5556/api/health
curl --fail http://127.0.0.1:5556/api/profiles
curl --fail http://127.0.0.1:5556/api/models
```

The first provider-backed voice turn may incur model charges. Confirm the selected provider and model in the UI before recording it.

If `just` and `lsof` are installed, Bob can instead run as managed background processes:

```bash
just up
just status
just logs server
just down
```

If the setup agent is Claude Code and Bob is configured to use the Claude harness, start Bob from a terminal outside that Claude Code process or remove `CLAUDECODE` from Bob's server environment. Claude otherwise rejects the nested session. The `just up` lifecycle already removes that variable for the managed server.

To opt into the Headroom stack, install the `headroom` command and run:

```bash
just up-headroom
```

This starts cache mode on `127.0.0.1:8787` and token mode on `127.0.0.1:8788`, waits for both readiness endpoints, and sets Bob's `HEADROOM_BASE_URL` to the cache proxy. Plain `just up` starts no proxies. `just down` stops the server, UI, and both managed proxies together.

## Remote access

To accept a named host on a trusted network, bind Vite to the network interface and declare each accepted hostname:

```dotenv
BOB_UI_HOST=0.0.0.0
BOB_UI_ALLOWED_HOSTS=localhost,127.0.0.1,my-machine.local
```

The API may remain bound to `127.0.0.1`; browser requests under `/api` are proxied by Vite. Bob has no authentication, so only use this development configuration on a trusted network.

Bob has no built-in login or tenant boundary. Keep the default localhost binding. For remote access, put Bob behind an authenticated HTTPS reverse proxy or use a local SSH tunnel. Do not expose the development servers directly to a LAN or the public internet.
