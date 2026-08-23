set shell := ["bash", "-cu"]
set dotenv-load := true

root := justfile_directory()

# Cross-platform users can run the equivalent npm commands directly.
install:
    npm run install:all

# Configure a private localhost installation interactively.
setup:
    npm run setup

# Validate configuration, runtimes, speech tools, and network policy.
doctor:
    npm run doctor

dev:
    npm run dev

build:
    npm run build

test:
    cd server && npm test -- --runInBand

smoke-offline:
    npm run smoke:offline

# Start the Bob API and UI in the background. Headroom is not started.
up: (_up "false")

# Start the Headroom cache and token proxies, then route Bob through cache mode.
up-headroom: (_up "true")

# Stop the managed API, UI, and Headroom proxies.
down:
    #!/usr/bin/env bash
    set -u
    cd {{root}}
    STATE_DIR="${BOB_STATE_DIR:-.bob}"
    case "$STATE_DIR" in /*) ;; *) STATE_DIR="$(pwd)/$STATE_DIR" ;; esac
    TAILSCALE_ENABLED="${BOB_TAILSCALE_ENABLED:-false}"
    TAILSCALE_HTTPS_PORT="${BOB_TAILSCALE_HTTPS_PORT:-8555}"
    if [ "$TAILSCALE_ENABLED" = "true" ] && command -v tailscale >/dev/null; then
        tailscale serve --https="$TAILSCALE_HTTPS_PORT" off >/dev/null 2>&1 || true
    fi

    stop_tree() {
        local pid="$1"
        local child
        for child in $(pgrep -P "$pid" 2>/dev/null || true); do
            stop_tree "$child"
        done
        kill "$pid" 2>/dev/null || true
    }

    stop_managed() {
        local name="$1"
        local pidfile="$STATE_DIR/pids/${name}.pid"
        if [ ! -f "$pidfile" ]; then
            return 0
        fi
        local pid
        pid="$(cat "$pidfile")"
        if kill -0 "$pid" 2>/dev/null; then
            stop_tree "$pid"
            for _ in $(seq 1 20); do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.1
            done
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$pidfile"
    }

    stop_managed server
    stop_managed ui
    stop_managed headroom-cache
    stop_managed headroom-token
    echo "Bob stack stopped"

# Stop the Headroom proxies after Bob has stopped.
down-headroom:
    #!/usr/bin/env bash
    set -u
    cd {{root}}
    STATE_DIR="${BOB_STATE_DIR:-.bob}"
    case "$STATE_DIR" in /*) ;; *) STATE_DIR="$(pwd)/$STATE_DIR" ;; esac
    server_pidfile="$STATE_DIR/pids/server.pid"
    if [ -f "$server_pidfile" ] && kill -0 "$(cat "$server_pidfile")" 2>/dev/null; then
        echo "Bob is still running; use 'just down' so provider requests are not stranded" >&2
        exit 1
    fi
    for name in headroom-cache headroom-token; do
        pidfile="$STATE_DIR/pids/${name}.pid"
        if [ -f "$pidfile" ]; then
            pid="$(cat "$pidfile")"
            kill "$pid" 2>/dev/null || true
            rm -f "$pidfile"
        fi
    done
    echo "Headroom proxies stopped"

# Show managed process state.
status:
    #!/usr/bin/env bash
    set -u
    cd {{root}}
    STATE_DIR="${BOB_STATE_DIR:-.bob}"
    case "$STATE_DIR" in /*) ;; *) STATE_DIR="$(pwd)/$STATE_DIR" ;; esac
    for name in server ui headroom-cache headroom-token; do
        pidfile="$STATE_DIR/pids/${name}.pid"
        if [ -f "$pidfile" ]; then
            pid="$(cat "$pidfile")"
            if kill -0 "$pid" 2>/dev/null; then
                printf '%-15s running pid=%s\n' "$name" "$pid"
            else
                printf '%-15s stale pid=%s\n' "$name" "$pid"
            fi
        else
            printf '%-15s stopped\n' "$name"
        fi
    done

# Follow one managed log: server, ui, headroom-cache, or headroom-token.
logs service="server":
    #!/usr/bin/env bash
    set -eu
    cd {{root}}
    STATE_DIR="${BOB_STATE_DIR:-.bob}"
    case "$STATE_DIR" in /*) ;; *) STATE_DIR="$(pwd)/$STATE_DIR" ;; esac
    case "{{service}}" in
        server|ui|headroom-cache|headroom-token) ;;
        *) echo "unknown service '{{service}}'" >&2; exit 2 ;;
    esac
    mkdir -p "$STATE_DIR/logs"
    touch "$STATE_DIR/logs/{{service}}.log"
    exec tail -f "$STATE_DIR/logs/{{service}}.log"

[private]
_up with_headroom:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{root}}
    STATE_DIR="${BOB_STATE_DIR:-.bob}"
    case "$STATE_DIR" in /*) ;; *) STATE_DIR="$(pwd)/$STATE_DIR" ;; esac
    SERVER_PORT="${BOB_PORT:-5556}"
    UI_PORT="${BOB_UI_PORT:-5555}"
    HEADROOM_CACHE_PORT="${BOB_HEADROOM_PORT:-8787}"
    HEADROOM_TOKEN_PORT="${BOB_HEADROOM_TOKEN_PORT:-8788}"
    TAILSCALE_ENABLED="${BOB_TAILSCALE_ENABLED:-false}"
    TAILSCALE_HTTPS_PORT="${BOB_TAILSCALE_HTTPS_PORT:-8555}"
    mkdir -p "$STATE_DIR/pids" "$STATE_DIR/logs"

    command -v lsof >/dev/null || {
        echo "lsof is required by the optional Just lifecycle recipes" >&2
        exit 1
    }

    ports=("$SERVER_PORT" "$UI_PORT")
    if [ "{{with_headroom}}" = "true" ]; then
        ports+=("$HEADROOM_CACHE_PORT" "$HEADROOM_TOKEN_PORT")
    fi
    for port in "${ports[@]}"; do
        if lsof -ti ":$port" >/dev/null 2>&1; then
            echo "port :$port is already bound — run 'just down' or choose another port" >&2
            exit 1
        fi
    done

    headroom_url=""
    if [ "{{with_headroom}}" = "true" ]; then
        command -v headroom >/dev/null || {
            echo "headroom is not installed or not on PATH" >&2
            exit 1
        }
        command -v curl >/dev/null || {
            echo "curl is required for the Headroom readiness checks" >&2
            exit 1
        }

        start_proxy() {
            local name="$1" mode="$2" port="$3"
            (exec nohup headroom proxy --port "$port" --mode "$mode" >"$STATE_DIR/logs/$name.log" 2>&1) &
            echo $! >"$STATE_DIR/pids/$name.pid"
            for _ in $(seq 1 30); do
                curl -sf "http://127.0.0.1:$port/readyz" >/dev/null 2>&1 && return 0
                sleep 0.5
            done
            return 1
        }

        if ! start_proxy headroom-cache cache "$HEADROOM_CACHE_PORT"; then
            kill "$(cat "$STATE_DIR/pids/headroom-cache.pid")" 2>/dev/null || true
            rm -f "$STATE_DIR/pids/headroom-cache.pid"
            echo "Headroom cache proxy failed readiness — see $STATE_DIR/logs/headroom-cache.log" >&2
            exit 1
        fi
        if ! start_proxy headroom-token token "$HEADROOM_TOKEN_PORT"; then
            kill "$(cat "$STATE_DIR/pids/headroom-token.pid")" 2>/dev/null || true
            kill "$(cat "$STATE_DIR/pids/headroom-cache.pid")" 2>/dev/null || true
            rm -f "$STATE_DIR/pids/headroom-token.pid" "$STATE_DIR/pids/headroom-cache.pid"
            echo "Headroom token proxy failed readiness — see $STATE_DIR/logs/headroom-token.log" >&2
            exit 1
        fi
        headroom_url="http://127.0.0.1:$HEADROOM_CACHE_PORT"
    fi

    if [ -n "$headroom_url" ]; then
        (cd server && unset CLAUDECODE && exec nohup env BOB_PORT="$SERVER_PORT" HEADROOM_BASE_URL="$headroom_url" npm run start:dev >"$STATE_DIR/logs/server.log" 2>&1) &
    else
        (cd server && unset CLAUDECODE && exec nohup env BOB_PORT="$SERVER_PORT" npm run start:dev >"$STATE_DIR/logs/server.log" 2>&1) &
    fi
    echo $! >"$STATE_DIR/pids/server.pid"
    (cd ui && exec nohup env BOB_UI_PORT="$UI_PORT" BOB_PORT="$SERVER_PORT" npm run dev >"$STATE_DIR/logs/ui.log" 2>&1) &
    echo $! >"$STATE_DIR/pids/ui.pid"

    if [ "$TAILSCALE_ENABLED" = "true" ]; then
        command -v tailscale >/dev/null || {
            echo "tailscale is required when BOB_TAILSCALE_ENABLED=true" >&2
            exit 1
        }
        tailscale serve --bg --https="$TAILSCALE_HTTPS_PORT" "http://127.0.0.1:$UI_PORT"
    fi

    echo "server         pid=$(cat "$STATE_DIR/pids/server.pid") log=$STATE_DIR/logs/server.log"
    echo "ui             pid=$(cat "$STATE_DIR/pids/ui.pid") log=$STATE_DIR/logs/ui.log"
    if [ "$TAILSCALE_ENABLED" = "true" ]; then
        echo "tailscale      https=:$TAILSCALE_HTTPS_PORT -> http://127.0.0.1:$UI_PORT"
    fi
    if [ -f "$STATE_DIR/pids/headroom-cache.pid" ]; then
        echo "headroom-cache pid=$(cat "$STATE_DIR/pids/headroom-cache.pid") log=$STATE_DIR/logs/headroom-cache.log"
    fi
    if [ -f "$STATE_DIR/pids/headroom-token.pid" ]; then
        echo "headroom-token pid=$(cat "$STATE_DIR/pids/headroom-token.pid") log=$STATE_DIR/logs/headroom-token.log"
    fi
