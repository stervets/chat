#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.maintenance_on"
ACTIVE_FILE="$SCRIPT_DIR/marx-active.routes.caddy"
NORMAL_TARGET="marx-normal.routes.caddy"
MAINTENANCE_TARGET="marx-maintenance.routes.caddy"

if [[ ! -f "$SCRIPT_DIR/$NORMAL_TARGET" ]]; then
  echo "Missing file: $SCRIPT_DIR/$NORMAL_TARGET" >&2
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/$MAINTENANCE_TARGET" ]]; then
  echo "Missing file: $SCRIPT_DIR/$MAINTENANCE_TARGET" >&2
  exit 1
fi

set_active_target() {
  local target="$1"
  ln -sfn "$target" "$ACTIVE_FILE"
}

if [[ -f "$STATE_FILE" ]]; then
  rm -f "$STATE_FILE"
  set_active_target "$NORMAL_TARGET"
  echo "Maintenance mode: OFF"
else
  : > "$STATE_FILE"
  set_active_target "$MAINTENANCE_TARGET"
  echo "Maintenance mode: ON"
fi

echo "Caddy config include: $ACTIVE_FILE -> $(readlink "$ACTIVE_FILE")"
echo "Reload Caddy: sudo systemctl reload caddy"
echo "If you must drop active WS sessions immediately: sudo systemctl restart caddy"
