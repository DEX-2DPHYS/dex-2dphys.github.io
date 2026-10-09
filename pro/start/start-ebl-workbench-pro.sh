#!/bin/sh
# Starts the EBL Workbench Pro backend (on this computer only, 127.0.0.1) and opens the Workbench in
# the browser. Keep this window open while you work; closing it (or Ctrl+C) stops the backend.
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/app" || exit 1
NODE=./node/node
[ -x "$NODE" ] || NODE=node
# the native core: say so plainly if it cannot start (the Workbench then computes in JavaScript)
if ! ./desktop/bin/ebw-core --version >/dev/null 2>&1; then
  echo ""
  echo "NOTE: the native core (app/desktop/bin/ebw-core) does not start. The Workbench works, but computes"
  echo "      in JavaScript (Monte Carlo, correction and KOH are slower). Check that the file is executable"
  echo "      (chmod +x app/desktop/bin/ebw-core). The title bar says 'PRO · N threads' when the core runs."
  echo ""
fi
exec "$NODE" desktop/server.mjs "$@"
