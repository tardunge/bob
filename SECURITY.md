# Security and privacy

## Threat model

Bob is a single-user local application. It does not provide authentication, authorization between users, tenant isolation, TLS termination, or a hardened public-server mode. The safe default is one trusted user with the API and UI bound to `127.0.0.1`.

Changing `BOB_HOST` or `BOB_UI_HOST` can expose conversation data and agent controls. Remote deployments require an authenticated HTTPS reverse proxy, host firewall rules, and explicit CORS origins.

## Trusted profile code

A profile can influence an agent system prompt, filesystem permissions, skills, MCP servers, Pi extensions, and operator commands. Installing a profile is equivalent to installing local code. Review all profile files before enabling it.

Keep write roots narrow. The generic sample profile has no write roots or operator commands. Bob projects declared permissions into Claude and supplies Pi with the same workspace and write-root boundaries. Profile extensions remain responsible for any additional tools they register.

## Data locations

- Conversations and usage records are stored in the SQLite file selected by `DATABASE_PATH`.
- SQLite WAL and shared-memory sidecars can contain recent conversation data.
- Uploaded browser audio is processed from the operating system temporary directory and removed after the turn.
- Synthesized response audio is retained under the operating system temporary directory for up to 24 hours.
- Pi continuation files are stored in `BOB_PI_SESSION_DIR` or Bob’s local `.bob/agent-sessions/pi` directory.

Bob does not encrypt these files. Use operating-system disk encryption and filesystem permissions where confidentiality matters. Backups containing the database or Pi session files contain private conversation history.

## Provider data flow

Normal Pi or Claude turns can send the profile prompt, user message, resumed context, and tool results to the configured model provider. Provider retention and training policies are outside Bob’s control. Whisper, ffmpeg, and Piper are launched locally; Bob does not upload speech to a separate speech API.

`BOB_TEST_MODE=offline` disables agent and speech subprocesses for installation testing. It is deterministic and records zero model cost.

## Secrets

Do not put API keys, access tokens, or credentials in `profile.json`, prompts, skills, MCP files committed to source control, browser code, or conversation text. Use the harness’s credential store or process environment. `.env` is ignored; `.env.example` contains names only.

## Reporting vulnerabilities

Report vulnerabilities privately to the repository maintainers before opening a public issue containing exploit details, secrets, or private conversation data.
