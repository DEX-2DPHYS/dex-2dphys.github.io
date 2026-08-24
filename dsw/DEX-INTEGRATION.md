# Integrating DSW into dex-2dphys.github.io

The integration below has been applied and visually verified in a local clone
of the DEX site (nav tab, tool card, "Native app" filter label, landing page,
light + dark themes, no JS errors). To publish it, run these steps in a clone
of `DEX-2DPHYS/dex-2dphys.github.io` — or paste this whole file as the prompt
of a Claude Code session started on that repo.

## Steps

1. **Copy the DSW tree** from `peterboggild/BrokildApps`, branch
   `claude/dex-server-host-9jkd55`, into the site root:

   ```sh
   git clone --depth 1 -b claude/dex-server-host-9jkd55 \
       https://github.com/peterboggild/BrokildApps /tmp/ba
   cp -r /tmp/ba/dsw ./dsw
   ```

   Copy verbatim; there should be no `dsw/build/`, `dsw/dsw` binary or `*.so`
   files (delete them if present). `dsw/index.html` is the site-styled
   landing page and works as-is.

2. **Card preview image:**

   ```sh
   cp dsw/docs/wave-tank.png assets/tool-previews/dsw.png
   ```

3. **Create `tools/dsw/tool.json`** with exactly:

   ```json
   {
     "slug": "dsw",
     "name": "DSW — Digital Science Workstation",
     "description": "A DAW for science: a native host that runs C++/HTML experiment plugins. Drop a bundle in a folder, the browser is the GUI, the heavy math runs native. Ships with Gray–Scott and double-slit wave-tank experiments.",
     "status": "live",
     "url": "dsw/",
     "icon": "device",
     "tags": ["native", "simulations", "educational"],
     "note": "Native desktop app — built from source; experiments then run in your browser."
   }
   ```

4. **Edit `tools/manifest.json`:** append to the `labels` array (after the
   `phone` label):

   ```json
   {
     "id": "native",
     "name": "Native app",
     "description": "Runs as a native program on your computer — built from source, not in the browser."
   }
   ```

   and add `"dsw"` as the **first** entry of the `tools` array. Keep the JSON
   valid; change nothing else.

5. **Edit `index.html`:** in the topbar `.nav-links`, insert between the
   Tools and About links:

   ```html
   <a href="dsw/">DSW</a>
   ```

   so the nav reads *Tools | DSW | About | GitHub →*. No other change.

6. **Verify, then commit to `main` and push** in a single commit:

   ```sh
   python3 -c "import json; json.load(open('tools/manifest.json')); json.load(open('tools/dsw/tool.json'))"
   git status   # only: dsw/, tools/dsw/tool.json, assets/tool-previews/dsw.png, tools/manifest.json, index.html
   ```

   Suggested commit message:

   > Add DSW — Digital Science Workstation: native host for C++/HTML experiments
   >
   > New nav tab and tool card linking to dsw/, a site-styled landing page,
   > and the full DSW source tree (host, plugin ABI, Gray-Scott and Wave Tank
   > example experiments). Developed in peterboggild/BrokildApps.
