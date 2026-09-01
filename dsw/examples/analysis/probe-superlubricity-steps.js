// Verify that the user-controlled angle and translation increments reach the
// native resumable sweep jobs and determine successive recorded samples.
const ws = new WebSocket("ws://127.0.0.1:8090/ws/superlubricity");
const points = [];
let lastState = null;
let failures = 0;
const send = message => ws.send(JSON.stringify(message));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = (name, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};
ws.onmessage = event => {
  if (typeof event.data !== "string") return;
  try { const message = JSON.parse(event.data);
    if (message.t === "point") points.push(message);
    if (message.t === "state") lastState = message;
  }
  catch (_) {}
};
async function waitPoints(count) {
  for (let i = 0; i < 400 && points.length < count; i++) {
    if (i % 20 === 0) send({ t:"state" });
    await sleep(25);
  }
  return points.length >= count;
}
ws.onopen = async () => {
  // Disabling relaxation makes this a quick control-path test rather than a
  // benchmark of the expensive production relaxation jobs.
  for (const [k, v] of [["tail",0],["relaxXY",0],["relaxD",0]])
    send({ t:"set", k, v });
  await sleep(200);

  console.log("=== rotation step ===");
  send({ t:"set", k:"angleStep", v:7.5 });
  points.length = 0;
  send({ t:"sweeprot" }); send({ t:"state" });
  await waitPoints(2);
  if (points.length < 2) console.log("  state", JSON.stringify(lastState));
  const da = points.length >= 2 ? points[1].ang - points[0].ang : NaN;
  ok("successive rotation samples use 7.5 deg", Math.abs(da - 7.5) < 1e-6,
     `measured ${Number(da).toFixed(3)} deg`);
  send({ t:"stop" });

  console.log("\n=== translation step ===");
  send({ t:"set", k:"angle", v:0 });
  send({ t:"set", k:"tx", v:0 });
  send({ t:"set", k:"translationStep", v:0.37 });
  points.length = 0;
  send({ t:"sweeptx", dir:1 }); send({ t:"state" });
  await waitPoints(2);
  if (points.length < 2) console.log("  state", JSON.stringify(lastState));
  const dx = points.length >= 2 ? points[1].tx - points[0].tx : NaN;
  ok("successive translation samples use 0.37 A", Math.abs(dx - 0.37) < 1e-6,
     `measured ${Number(dx).toFixed(4)} A`);
  send({ t:"stop" });

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CLEAR");
  ws.close();
  process.exitCode = failures ? 1 : 0;
  clearTimeout(timeout);
};
ws.onerror = error => { console.error(error); process.exit(1); };
const timeout = setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 30000);
