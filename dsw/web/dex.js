/*
 * dex.js — browser-side shim for DSW experiment UIs.
 *
 * A plugin UI includes this with <script src="/dex.js"></script> and calls:
 *
 *   const dex = DEX.connect({
 *     canvas:   el,              // optional <canvas>: frames auto-draw here
 *     onMessage(obj) {},        // JSON messages from the C++ core
 *     onFrame(w, h, rgba) {},   // optional: raw frames instead of / besides canvas
 *     onStatus(state) {},       // 'connecting' | 'open' | 'closed'
 *   });
 *
 *   dex.send({ t: 'set', k: 'feed', v: 0.034 });   // any JSON to the core
 *   dex.close();
 *
 * Frame flow control: the shim asks the C++ core for at most one frame per
 * display refresh (requestAnimationFrame) and never has more than one frame
 * in flight, so a slow simulation never piles up latency and a fast one
 * never renders more than the screen can show.
 */
(function () {
  "use strict";

  function pluginIdFromLocation() {
    // /plugins/<id>/ui/... -> <id>
    const m = location.pathname.match(/^\/plugins\/([^/]+)\//);
    return m ? m[1] : null;
  }

  function connect(opts) {
    opts = opts || {};
    const id = opts.plugin || pluginIdFromLocation();
    if (!id) throw new Error("DEX.connect: cannot infer plugin id from URL; pass {plugin: 'id'}");

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws/" + id);
    ws.binaryType = "arraybuffer";

    let ctx = null, imageData = null;
    if (opts.canvas) ctx = opts.canvas.getContext("2d");

    const api = {
      state: "connecting",
      send(obj) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
      },
      close() { ws.close(); },
    };

    let frameInFlight = false;
    let raf = 0;
    function pump() {
      raf = requestAnimationFrame(pump);
      if (!frameInFlight && ws.readyState === WebSocket.OPEN) {
        frameInFlight = true;
        ws.send("f");
      }
    }

    function setStatus(s) {
      api.state = s;
      if (opts.onStatus) opts.onStatus(s);
    }

    ws.onopen = function () {
      setStatus("open");
      pump();
    };

    ws.onmessage = function (ev) {
      if (typeof ev.data === "string") {
        if (opts.onMessage) {
          try { opts.onMessage(JSON.parse(ev.data)); }
          catch (e) { console.warn("DEX: bad JSON from core", ev.data, e); }
        }
        return;
      }
      // Binary frame: "DXF1" + u32le width + u32le height + RGBA8.
      frameInFlight = false;
      const dv = new DataView(ev.data);
      if (ev.data.byteLength < 12 || dv.getUint32(0, true) !== 0x31465844) return;
      const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
      const rgba = new Uint8ClampedArray(ev.data, 12, w * h * 4);
      if (opts.onFrame) opts.onFrame(w, h, rgba);
      if (ctx) {
        if (!imageData || imageData.width !== w || imageData.height !== h) {
          opts.canvas.width = w;
          opts.canvas.height = h;
          imageData = ctx.createImageData(w, h);
        }
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);
      }
    };

    ws.onclose = function () {
      cancelAnimationFrame(raf);
      setStatus("closed");
    };
    ws.onerror = ws.onclose;

    return api;
  }

  window.DEX = { connect: connect, pluginId: pluginIdFromLocation };
})();
