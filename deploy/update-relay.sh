#!/usr/bin/env bash
set -euo pipefail

# Shardrail Zero-Downtime Relay & Web Console Update Script
# Usage: sudo ./deploy/update-relay.sh [--skip-web] [--skip-relay]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPDATE_RELAY=true
UPDATE_WEB=true

for arg in "$@"; do
    case "$arg" in
        --skip-web) UPDATE_WEB=false ;;
        --skip-relay) UPDATE_RELAY=false ;;
        -h|--help)
            echo "Usage: sudo $0 [--skip-web] [--skip-relay]"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

if [[ "$(id -u)" -ne 0 ]]; then
    echo "Error: update-relay.sh must be run as root (or via sudo)." >&2
    exit 1
fi

echo "=== Shardrail Server Update Starting ==="

# 1. Update Relay Service
if [[ "$UPDATE_RELAY" == true ]]; then
    echo "--- 1. Building and Updating Relay Binary ---"
    
    # Compile release binary if source tree is present
    if [[ -f "${REPO_DIR}/Cargo.toml" ]]; then
        echo "Building shardrail-relay release binary..."
        if id -u daliys >/dev/null 2>&1; then
            su - daliys -c "cd '${REPO_DIR}' && cargo build --release -p shardrail_relay"
        else
            cargo build --release --manifest-path "${REPO_DIR}/Cargo.toml" -p shardrail_relay
        fi
        NEW_BIN="${REPO_DIR}/target/release/shardrail-relay"
    elif [[ -f "/usr/local/bin/shardrail-relay" ]]; then
        NEW_BIN="/usr/local/bin/shardrail-relay"
    else
        echo "Error: No relay binary or Cargo workspace found." >&2
        exit 1
    fi

    # Verify binary before swapping
    echo "Verifying new binary execution..."
    "$NEW_BIN" --version || { echo "Error: New binary failed self-test." >&2; exit 1; }

    # Atomically stage binary
    echo "Installing binary to /usr/local/bin/shardrail-relay..."
    install -m 755 "$NEW_BIN" /usr/local/bin/shardrail-relay.new
    mv /usr/local/bin/shardrail-relay.new /usr/local/bin/shardrail-relay

    # Ensure log directory and logrotate
    echo "Configuring logrotate and log directories..."
    mkdir -p /var/log/shardrail
    if id -u shardrail >/dev/null 2>&1; then
        chown -R shardrail:shardrail /var/log/shardrail
        chmod 750 /var/log/shardrail
    fi
    if [[ -f "${SCRIPT_DIR}/logrotate-shardrail.conf" ]]; then
        install -m 644 "${SCRIPT_DIR}/logrotate-shardrail.conf" /etc/logrotate.d/shardrail
    fi

    # Update systemd service
    if [[ -f "${SCRIPT_DIR}/shardrail-relay.service" ]]; then
        install -m 644 "${SCRIPT_DIR}/shardrail-relay.service" /etc/systemd/system/shardrail-relay.service
        systemctl daemon-reload
    fi

    # Restart service (fast ~15ms transition; daemons and browsers reconnect automatically)
    echo "Restarting shardrail-relay.service..."
    systemctl restart shardrail-relay
    sleep 1

    # Verify service is active
    if systemctl is-active --quiet shardrail-relay; then
        echo "Relay service is active (PID: $(systemctl show -p MainPID --value shardrail-relay))."
    else
        echo "Error: shardrail-relay failed to start!" >&2
        journalctl -u shardrail-relay -n 20 --no-pager
        exit 1
    fi
fi

# 2. Update Web Console SPA
if [[ "$UPDATE_WEB" == true ]]; then
    echo "--- 2. Building and Updating Web Console ---"
    if [[ -d "${REPO_DIR}/apps/web" ]]; then
        echo "Building static SPA..."
        if id -u daliys >/dev/null 2>&1; then
            su - daliys -c "cd '${REPO_DIR}' && npm --prefix apps/web ci && npm --prefix apps/web run build"
        else
            npm --prefix "${REPO_DIR}/apps/web" ci
            npm --prefix "${REPO_DIR}/apps/web" run build
        fi
        
        DIST_SRC="${REPO_DIR}/apps/web/dist"
        TARGET_DIST="/opt/shardrail/dist"
        
        if [[ -d "$DIST_SRC" ]]; then
            echo "Deploying SPA to ${TARGET_DIST}..."
            mkdir -p "$TARGET_DIST"
            rsync -a --delete "${DIST_SRC}/" "${TARGET_DIST}/"
            chown -R www-data:www-data "$TARGET_DIST"
        fi
    fi

    # Update nginx configuration if present
    if [[ -f "${SCRIPT_DIR}/nginx-shardrail.conf" ]]; then
        install -m 644 "${SCRIPT_DIR}/nginx-shardrail.conf" /etc/nginx/sites-available/shardrail
        nginx -t && systemctl reload nginx
        echo "Nginx configuration verified and reloaded."
    fi
fi

echo "=== Shardrail Server Update Completed Successfully ==="
