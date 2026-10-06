#!/bin/sh
# Starts the EBL Workbench Pro backend (on this computer only, 127.0.0.1) and opens the Workbench in
# the browser. Keep this window open while you work; closing it (or Ctrl+C) stops the backend.
cd "$(dirname "$0")/app" || exit 1
NODE=./node/node
[ -x "$NODE" ] || NODE=node
exec "$NODE" desktop/server.mjs "$@"