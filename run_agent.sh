#!/bin/bash
# Wrapper so launchd (which doesn't load nvm/shell profiles) can find Node 20.
set -euo pipefail
NODE_BIN="$HOME/.nvm/versions/node/v20.20.2/bin/node"
cd "$(dirname "$0")/agent"
exec "$NODE_BIN" main.js
