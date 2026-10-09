#!/bin/sh
# Starts the EBL Workbench Pro backend (on this computer only, 127.0.0.1) and opens the Workbench in
# the browser. Keep this window open while you work; closing it (or Ctrl+C) stops the backend.
HERE="$(cd "$(dirname "$0")" && pwd)"

# macOS: the package is not notarised. A downloaded zip marks every file with a quarantine flag, and
# Gatekeeper then blocks the native core (ebw-core, libomp) — the Workbench would still run, but compute
# in JavaScript. Once this script is allowed to run, it clears the flag for the whole folder itself.
if command -v xattr >/dev/null 2>&1 && xattr -r "$HERE" 2>/dev/null | grep -q com.apple.quarantine; then
  echo "Removing the download quarantine from the EBL Workbench Pro folder (needed once) ..."
  if ! xattr -dr com.apple.quarantine "$HERE" 2>/dev/null; then
    echo "Could not remove it. In Terminal, run:"
    echo "  xattr -dr com.apple.quarantine \"$HERE\""
  fi
fi

cd "$HERE/app" || exit 1
NODE=./node/node
[ -x "$NODE" ] || NODE=node
# the native core: say so plainly if it cannot start (the Workbench then computes in JavaScript)
if ! ./desktop/bin/ebw-core --version >/dev/null 2>&1; then
  echo ""
  echo "NOTE: the native core (app/desktop/bin/ebw-core) does not start. The Workbench works, but computes"
  echo "      in JavaScript (Monte Carlo, correction and KOH are slower). If macOS blocked it, run"
  echo "        xattr -dr com.apple.quarantine \"$HERE\""
  echo "      in Terminal and start again. The title bar says 'PRO · N threads' when the core runs."
  echo ""
fi
exec "$NODE" desktop/server.mjs "$@"
