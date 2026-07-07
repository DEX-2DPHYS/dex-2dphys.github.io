/* =================================================================
   landau2.js  --  Landau Quantization & SdH Explorer  (rewrite)
   Pure ASCII.  Publication-quality canvas rendering (Arial, 2px
   axes, inside ticks, mirror frames, clear axis titles).
   Same physics as the original; code cleaned up & reorganised.
   ================================================================= */

// ======================== Constants ===============================
var E_CHARGE  = 1.602176634e-19;
var HBAR      = 1.054571817e-34;
var H_PLANCK  = 6.62607015e-34;
var K_B       = 1.380649e-23;
var TWO_PI    = 2 * Math.PI;
var E2_OVER_H = (E_CHARGE * E_CHARGE) / H_PLANCK;

var OMEGA_VIS_SCALE = 2.5e-13;
var PX_PER_M        = 2.5e9;
var QHE_SAMPLES     = 260;

// ======================== DOM refs =================================
var ui = {
  toggleBtn:    document.getElementById("toggleBtn"),
  playBtn:      document.getElementById("playBtn"),
  resetBtn:     document.getElementById("resetBtn"),
  sweepRate:    document.getElementById("sweepRate"),
  sweepRateVal: document.getElementById("sweepRateVal"),
  spinSpeed:    document.getElementById("spinSpeed"),
  spinSpeedVal: document.getElementById("spinSpeedVal"),
  bField:       document.getElementById("bField"),
  bFieldVal:    document.getElementById("bFieldVal"),
  tempK:        document.getElementById("tempK"),
  tempVal:      document.getElementById("tempVal"),
  lphi1k:       document.getElementById("lphi1k"),
  lphi1kVal:    document.getElementById("lphi1kVal"),
  fermi:        document.getElementById("fermi"),
  fermiVal:     document.getElementById("fermiVal"),
  vFermi:       document.getElementById("vFermi"),
  vFermiVal:    document.getElementById("vFermiVal"),
  trail:        document.getElementById("trail"),
  trailVal:     document.getElementById("trailVal"),
  fanQuantity:  document.getElementById("fanQuantity"),
  dephaseModel: document.getElementById("dephaseModel"),
  modelBRates:  document.getElementById("modelBRates"),
  mu:           document.getElementById("mu"),
  muVal:        document.getElementById("muVal"),
  tauQfs:       document.getElementById("tauQfs"),
  tauQfsVal:    document.getElementById("tauQfsVal"),
  alphaB:       document.getElementById("alphaB"),
  alphaBVal:    document.getElementById("alphaBVal"),
  peakE2h:      document.getElementById("peakE2h"),
  peakE2hVal:   document.getElementById("peakE2hVal"),
  nStar:        document.getElementById("nStar"),
  nStarVal:     document.getElementById("nStarVal"),
  aqRate:       document.getElementById("aqRate"),
  aqRateVal:    document.getElementById("aqRateVal"),
  aphiRate:     document.getElementById("aphiRate"),
  aphiRateVal:  document.getElementById("aphiRateVal"),
  bphiRate:     document.getElementById("bphiRate"),
  bphiRateVal:  document.getElementById("bphiRateVal"),
  mOmega:       document.getElementById("mOmega"),
  mRadius:      document.getElementById("mRadius"),
  mLambda:      document.getElementById("mLambda"),
  mCirc:        document.getElementById("mCirc"),
  mLphi:        document.getElementById("mLphi"),
  mCoherence:   document.getElementById("mCoherence"),
  mDensity:     document.getElementById("mDensity"),
  mHalf:        document.getElementById("mHalf"),
  mWaves:       document.getElementById("mWaves"),
  mDeltaE:      document.getElementById("mDeltaE"),
  mLandau:      document.getElementById("mLandau"),
  mSdh:         document.getElementById("mSdh"),
  mRhoxxNow:    document.getElementById("mRhoxxNow"),
  mRhoxyNow:    document.getElementById("mRhoxyNow"),
  narrative:    document.getElementById("narrative"),
  trajCanvas:   document.getElementById("trajectoryCanvas"),
  landauCanvas: document.getElementById("landauCanvas"),
  qheCanvas:    document.getElementById("qheCanvas"),
  fanCanvas:    document.getElementById("qheFanCanvas")
};

// ======================== State ====================================
var state = {
  autoplay: false,
  sweepDir: 1,
  collapsed: false,
  lastTs: 0,
  elapsed: 0,
  trajSize:   { w: 1, h: 1 },
  landauSize: { w: 1, h: 1 },
  qheSize:    { w: 1, h: 1 },
  fanSize:    { w: 1, h: 1 },
  fanPalette: "orange",
  paletteDot: { x: 0, y: 0, r: 0 },
  rhoRange: { min: null, max: null, next: "min" },
  fanCache: {
    key: "", canvas: null,
    nMinM2: -1, nMaxM2: 1,
    bMin: 0, bMax: 1,
    vMin: 0, vMax: 1, qty: "rhoxx"
  },
  traj: { theta: -0.45, pathM: 0, trail: [] }
};

// ======================== Helpers ==================================
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function smoothstep(e0, e1, x) {
  var t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function thermalFactor(x) {
  if (x < 1e-5) return 1;
  if (x > 45) return 2 * x * Math.exp(-x);
  return x / Math.sinh(x);
}

function fmtExp(v, d) {
  if (typeof d === "undefined") d = 2;
  if (!isFinite(v)) return "-";
  return v.toExponential(d);
}

function erfApprox(x) {
  var s  = (x < 0) ? -1 : 1;
  var ax = Math.abs(x);
  var t  = 1 / (1 + 0.3275911 * ax);
  var y  = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}

function normCdf(x) { return 0.5 * (1 + erfApprox(x / Math.SQRT2)); }

function niceTicks(lo, hi, count) {
  if (typeof count === "undefined") count = 5;
  var span = hi - lo;
  if (!(span > 0)) return [lo, hi];
  var raw   = span / Math.max(1, count - 1);
  var mag   = Math.pow(10, Math.floor(Math.log10(raw)));
  var norm  = raw / mag;
  var step  = mag;
  if (norm >= 7.5)      step = 10 * mag;
  else if (norm >= 3.5) step =  5 * mag;
  else if (norm >= 1.5) step =  2 * mag;
  var ticks = [];
  var first = Math.ceil(lo / step) * step;
  for (var v = first; v <= hi + 1e-12; v += step) ticks.push(+v.toFixed(10));
  return ticks.length ? ticks : [lo, hi];
}

// ======================== Heat-map colour ===========================
function heatColour(val, lo, hi, palette) {
  var t = clamp((val - lo) / Math.max(hi - lo, 1e-20), 0, 1);
  var stops = (palette === "blue") ? [
    [0.00, 30,64,175], [0.22, 82,143,218], [0.50, 255,255,255],
    [0.78, 244,130,116], [1.00, 185,28,37]
  ] : [
    [0.00, 0,23,45],  [0.12, 17,75,139], [0.24, 42,130,181],
    [0.36, 107,181,202],[0.48, 185,224,234],[0.60, 255,247,214],
    [0.72, 255,210,122],[0.84, 255,154,74], [0.92, 231,91,58],
    [1.00, 183,34,43]
  ];
  var i = 0;
  while (i < stops.length - 1 && t > stops[i + 1][0]) i++;
  var s0 = stops[i], s1 = stops[Math.min(i + 1, stops.length - 1)];
  var f  = (t - s0[0]) / Math.max(1e-9, s1[0] - s0[0]);
  return [
    Math.round(s0[1] + f * (s1[1] - s0[1])),
    Math.round(s0[2] + f * (s1[2] - s0[2])),
    Math.round(s0[3] + f * (s1[3] - s0[3]))
  ];
}

// ======================== HiDPI canvas ==============================
function setupCanvas(canvas, assignSize) {
  var ctx = canvas.getContext("2d");
  var resize = function () {
    var r   = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    assignSize(r.width, r.height);
  };
  resize();
  return { ctx: ctx, resize: resize };
}

// ======================== Controls =================================
function setCollapsed(flag) {
  state.collapsed = flag;
  document.body.classList.toggle("collapsed", flag);
  ui.toggleBtn.innerHTML = flag ? "&raquo;" : "&laquo;";
  ui.toggleBtn.title     = flag ? "Expand" : "Collapse";
}

function readControls() {
  return {
    sweepRate:   +ui.sweepRate.value,
    spinSpeed:   +ui.spinSpeed.value,
    bField:      +ui.bField.value,
    tempK:       +ui.tempK.value,
    lphi1kUm:    +ui.lphi1k.value,
    fermiMeV:    +ui.fermi.value,
    vFermiM:     +ui.vFermi.value * 1e6,
    trailPts:    +ui.trail.value,
    dephaseModel: ui.dephaseModel.value,
    mu:          +ui.mu.value,
    tauQfs:      +ui.tauQfs.value,
    alphaBMeV:   +ui.alphaB.value,
    peakE2h:     +ui.peakE2h.value,
    nStar10cm2:  +ui.nStar.value,
    aqRate:      +ui.aqRate.value,
    aphiRate:    +ui.aphiRate.value,
    bphiRate:    +ui.bphiRate.value
  };
}

function bRange() {
  return { min: +ui.bField.min, max: +ui.bField.max };
}

// ======================== Graphene Landau physics ====================
function landauEJ(n, vF, B) {
  return n <= 0 ? 0 : vF * Math.sqrt(2 * E_CHARGE * HBAR * B * n);
}
function landauEmeV(n, vF, B) {
  return (landauEJ(n, vF, B) / E_CHARGE) * 1e3;
}

function computeTau(ctrl, vF) {
  var T      = Math.max(ctrl.tempK, 1);
  var tauQ1  = Math.max(1e-15, ctrl.tauQfs * 1e-15);
  var lPhi1  = Math.max(1e-12, ctrl.lphi1kUm * 1e-6);
  var tauQB  = tauQ1;
  var tauPhi;

  if (ctrl.dephaseModel === "modelB") {
    var aqSI   = Math.max(0, ctrl.aqRate) * 1e12;
    var aphiSI = Math.max(0, ctrl.aphiRate) * 1e12;
    var bphiSI = Math.max(0, ctrl.bphiRate) * 1e12;
    tauQB  = 1 / (1 / tauQ1 + aqSI * Math.max(0, T - 1));
    var tP1 = lPhi1 / Math.max(vF, 1e3);
    tauPhi = 1 / (1 / tP1 + aphiSI * Math.max(0, T - 1) + bphiSI * Math.max(0, T * T - 1));
  } else {
    tauPhi = (lPhi1 / Math.max(vF, 1e3)) / Math.sqrt(T);
  }
  tauQB  = Math.max(1e-15, tauQB);
  tauPhi = Math.max(1e-15, tauPhi);
  return { tauQBase: tauQB, tauPhi: tauPhi, lPhi: tauPhi * vF };
}

function physicsAtB(ctrl, B) {
  var efJ   = ctrl.fermiMeV * 1e-3 * E_CHARGE;
  var vF    = ctrl.vFermiM;
  var efAbs = Math.max(Math.abs(efJ), 1e-30);
  var bAbs  = Math.max(Math.abs(B), 1e-12);
  var kF    = efAbs / (HBAR * vF);
  var pF    = HBAR * kF;
  var nM2   = (kF * kF) / Math.PI;
  var lamF  = TWO_PI / kF;
  var rc    = pF / (E_CHARGE * bAbs);
  var circ  = TWO_PI * rc;
  var mCyc  = efAbs / (vF * vF);
  var wc    = (E_CHARGE * bAbs) / mCyc;

  var tm    = computeTau(ctrl, vF);
  var tauTr = Math.max(1e-15, (Math.max(ctrl.mu, 0.02) * efAbs) / (E_CHARGE * vF * vF));
  var tauQE = Math.min(tm.tauQBase, tauTr);
  var lPhi  = tm.lPhi;
  var coh   = lPhi / circ;

  var freqT      = (HBAR * kF * kF) / (2 * E_CHARGE);
  var nF         = freqT / bAbs;
  var wavesOrbit = circ / lamF;

  var xTh   = (2 * Math.PI * Math.PI * K_B * ctrl.tempK) / (HBAR * wc);
  var rTh   = thermalFactor(xTh);
  var rD    = Math.exp(-Math.PI / Math.max(wc * tauQE, 1e-9));
  var sdhA  = clamp(rTh * rD, 0, 1);

  var nBel  = Math.max(0, Math.floor(nF));
  var dEmeV = landauEmeV(nBel + 1, vF, bAbs) - landauEmeV(nBel, vF, bAbs);

  return {
    efJ: efJ, vF: vF, kF: kF, pF: pF, nM2: nM2, lamF: lamF,
    rc: rc, circ: circ, mCyc: mCyc, wc: wc,
    tauQBase: tm.tauQBase, tauQE: tauQE, tauTr: tauTr,
    tauPhi: tm.tauPhi, lPhi: lPhi, coh: coh,
    freqT: freqT, nF: nF, wavesOrbit: wavesOrbit,
    rTh: rTh, rD: rD, sdhA: sdhA,
    nBel: nBel, dEmeV: dEmeV
  };
}

// ======================== QHE transport =============================
function makeQHEParams(ctrl) {
  var tm = computeTau(ctrl, ctrl.vFermiM);
  return {
    vF: ctrl.vFermiM,
    mu: Math.max(ctrl.mu, 0.02),
    tauQB:    tm.tauQBase,
    alphaJ:   ctrl.alphaBMeV * 1e-3 * E_CHARGE,
    peakAmp:  Math.max(0.1, ctrl.peakE2h) * E2_OVER_H,
    sigMin:   5e-7,
    nStarM2:  Math.max(0, ctrl.nStar10cm2) * 1e14,
    T:        ctrl.tempK,
    gamma0:   0.35e-3 * E_CHARGE
  };
}

function qheFromDensity(nSigned, B, qp) {
  var bA = Math.max(Math.abs(B), 1e-9);
  var sB = (B >= 0 ? 1 : -1);
  var nRaw = Math.abs(nSigned);
  var nE = Math.max(nRaw, qp.nStarM2, 1e8);
  var sN = (nSigned >= 0 ? 1 : -1);
  var ef = nRaw > 0 ? sN * HBAR * qp.vF * Math.sqrt(Math.PI * nRaw) : 0;
  var eA = HBAR * qp.vF * Math.sqrt(Math.PI * nE);

  var tM  = Math.max(1e-15, (qp.mu * eA) / (E_CHARGE * qp.vF * qp.vF));
  var tQE = Math.min(qp.tauQB, tM);
  var gM  = HBAR / (2 * tM);
  var gQ  = HBAR / (2 * tQE);
  var gT  = 1.5 * K_B * qp.T;
  var gB  = qp.alphaJ * Math.sqrt(bA);
  var g   = Math.sqrt(gM * gM + gQ * gQ + gT * gT + gB * gB + qp.gamma0 * qp.gamma0);

  var eCut = eA + 8 * g;
  var nMx  = Math.min(140, Math.max(1, Math.ceil((eCut * eCut) / (2 * E_CHARGE * HBAR * bA * qp.vF * qp.vF))));

  var sxx  = qp.sigMin + 0.25 * qp.peakAmp * Math.exp(-(ef * ef) / (2 * g * g));
  var stair = 0.5 * Math.tanh(ef / (Math.SQRT2 * g));

  for (var n = 1; n <= nMx; n++) {
    var eN = landauEJ(n, qp.vF, bA);
    var d1 = ef - eN, d2 = ef + eN;
    sxx   += qp.peakAmp * Math.exp(-(d1 * d1) / (2 * g * g));
    sxx   += qp.peakAmp * Math.exp(-(d2 * d2) / (2 * g * g));
    stair += normCdf(d1 / g) - normCdf(-d2 / g);
  }

  var sxy  = 4 * E2_OVER_H * sB * stair;
  var den  = sxx * sxx + sxy * sxy + 1e-30;
  var rhoxx = sxx / den;
  var llDegM2 = 4 * E_CHARGE * bA / H_PLANCK;
  var n0Width = Math.sqrt(Math.pow(2e13, 2) + Math.pow(0.12 * llDegM2, 2));
  var n0Ridge = Math.exp(-(nSigned * nSigned) / (2 * n0Width * n0Width));
  rhoxx += 0.35 * (1 / E2_OVER_H) * n0Ridge;
  return { sigxx: sxx, sigxy: sxy, rhoxx: rhoxx, rhoxy: -sxy / den };
}

function qheAtB(ctrl, B, phys) {
  var p  = phys || physicsAtB(ctrl, B);
  var qp = makeQHEParams(ctrl);
  var nS = ((ctrl.fermiMeV >= 0) ? 1 : -1) * p.nM2;
  return qheFromDensity(nS, B, qp);
}

function fanValue(qty, qhe) {
  if (qty === "sigxx") return Math.log10(Math.max(qhe.sigxx, 1e-24));
  if (qty === "sigxy") return qhe.sigxy / E2_OVER_H;
  return Math.log10(Math.max(qhe.rhoxx, 1e-24));
}

function fanLabel(qty) {
  if (qty === "sigxx") return "log10 sigma_xx";
  if (qty === "sigxy") return "sigma_xy / (e^2/h)";
  return "log10 rho_xx";
}
function rhoRangeText() {
  var r = state.rhoRange;
  if (r.min === null && r.max === null) return "";
  var a = (r.min === null) ? "auto" : r.min.toFixed(2);
  var b = (r.max === null) ? "auto" : r.max.toFixed(2);
  return " [" + a + ".." + b + "]";
}

function coherenceField(phys) {
  return (TWO_PI * phys.pF) / (E_CHARGE * phys.lPhi);
}

function coherenceText(ratio) {
  if (ratio > 1.2) return "coherent";
  if (ratio > 0.9) return "near onset";
  return "dephased";
}

// ======================== UI label updates ===========================
function updateLabels(ctrl, phys, qhe) {
  ui.modelBRates.style.display = (ctrl.dephaseModel === "modelB") ? "grid" : "none";

  ui.sweepRateVal.textContent = ctrl.sweepRate.toFixed(2) + " T/s";
  ui.spinSpeedVal.textContent = (ctrl.spinSpeed === 0) ? "stopped" : (ctrl.spinSpeed * 100).toFixed(0) + "%";
  ui.bFieldVal.textContent    = ctrl.bField.toFixed(2) + " T";
  ui.tempVal.textContent      = ctrl.tempK.toFixed(1) + " K";
  ui.lphi1kVal.textContent    = ctrl.lphi1kUm.toFixed(2) + " um";
  ui.fermiVal.textContent     = ctrl.fermiMeV.toFixed(1) + " meV";
  ui.vFermiVal.textContent    = (ctrl.vFermiM / 1e6).toFixed(2);
  ui.trailVal.textContent     = "" + ctrl.trailPts;

  ui.muVal.textContent       = ctrl.mu.toFixed(2);
  ui.tauQfsVal.textContent   = ctrl.tauQfs.toFixed(0) + " fs";
  ui.alphaBVal.textContent   = ctrl.alphaBMeV.toFixed(2);
  ui.peakE2hVal.textContent  = ctrl.peakE2h.toFixed(2);
  ui.nStarVal.textContent    = ctrl.nStar10cm2.toFixed(1);
  ui.aqRateVal.textContent   = ctrl.aqRate.toFixed(3);
  ui.aphiRateVal.textContent = ctrl.aphiRate.toFixed(3);
  ui.bphiRateVal.textContent = ctrl.bphiRate.toFixed(4);

  var nCm2 = phys.nM2 / 1e4;
  ui.mOmega.textContent     = fmtExp(phys.wc, 2) + " rad/s";
  ui.mRadius.textContent    = (phys.rc * 1e9).toFixed(1) + " nm";
  ui.mLambda.textContent    = (phys.lamF * 1e9).toFixed(2) + " nm";
  ui.mCirc.textContent      = (phys.circ * 1e9).toFixed(1) + " nm";
  ui.mLphi.textContent      = (phys.lPhi * 1e9).toFixed(1) + " nm";
  ui.mCoherence.textContent = phys.coh.toFixed(2) + " (" + coherenceText(phys.coh) + ")";
  ui.mDensity.textContent   = (nCm2 / 1e12).toFixed(2) + " x 10^12 cm^-2";
  ui.mHalf.textContent      = phys.wavesOrbit.toFixed(2) + " (=2n_F)";
  var nBS = phys.nF;  // Onsager index, integer at Landau-level centers in graphene
  var iSc = interferenceScore(phys);
  var iLbl = (iSc < 0.08) ? "LL center" : (iSc > 0.42) ? "between LLs" : "partial";
  ui.mWaves.textContent     = "n_F=" + nBS.toFixed(2) + " (" + iLbl + ")";
  ui.mDeltaE.textContent    = phys.dEmeV.toFixed(2) + " meV";
  ui.mLandau.textContent    = phys.nBel + " (nF=" + phys.nF.toFixed(2) + ")";
  ui.mSdh.textContent       = phys.sdhA.toFixed(3) + " (RT=" + phys.rTh.toFixed(3) + ", RD=" + phys.rD.toFixed(3) + ")";
  ui.mRhoxxNow.textContent  = qhe.rhoxx.toExponential(2) + " Ohm/sq";
  ui.mRhoxyNow.textContent  = Math.abs(qhe.rhoxy).toExponential(2) + " Ohm/sq";

  var br  = bRange();
  var bCo = coherenceField(phys);
  var bTxt;
  if (bCo > br.max)      bTxt = "B_coh ~ " + bCo.toFixed(2) + " T (above range)";
  else if (bCo < br.min) bTxt = "B_coh ~ " + bCo.toFixed(2) + " T (below range)";
  else                    bTxt = "B_coh ~ " + bCo.toFixed(2) + " T";

  var mTxt = (ctrl.dephaseModel === "modelB")
    ? "Mode B: tau_q(T)=1/(1/tau_q0 + Aq(T-1)), tau_phi(T)=1/(1/tau_phi0 + A_phi(T-1) + B_phi(T^2-1))."
    : "Mode A: L_phi(T) for orbit visual; transport damping uses RT x RD(tau_q) with tau_q clipped by tau_tr.";

  ui.narrative.textContent =
    "Graphene: E_F = hbar k_F v_F, n = k_F^2/pi. " + mTxt +
    " QHE line-scan and fan map share the same transport model. Coherence ref: " + bTxt + ".";
}

// ======================== Trajectory ================================
function resetTrail() {
  state.traj.theta = -0.45;
  state.traj.pathM = 0;
  state.traj.trail = [];
}

function trajGeom(phys) {
  var w = state.trajSize.w, h = state.trajSize.h;
  var rPx = clamp(phys.rc * PX_PER_M, 18, Math.max(w, h) * 2.3);
  return { w: w, h: h, cx: w * 0.38, cy: h * 0.56, rPx: rPx, wVis: phys.wc * OMEGA_VIS_SCALE };
}

function advanceTrail(dt, ctrl, phys, g) {
  // Only advance the angle; trail array no longer used
  state.traj.theta -= g.wVis * dt * ctrl.spinSpeed;
}

// Graphene Onsager quantization: n_F = F/B = C/(2*lambda_F).
// The raw kinetic de Broglie count is C/lambda_F = 2n_F at a Landau
// level.  rho_xx peaks in the transport panel when E_F sits at a
// broadened Landau-level center, not merely because the raw wave closes.
// Score 0 = LL center, 0.5 = farthest between adjacent LL centers.
function interferenceScore(phys) {
  var nBS = phys.nF;
  var frac = nBS - Math.round(nBS);
  return Math.abs(frac);  // 0 = on a Landau-level center
}

// Returns rgba string: green when constructive (score~0), red when destructive (score~0.5)
function interferenceColour(phys, alpha) {
  var score = interferenceScore(phys);
  // score 0 -> green, score 0.5 -> red, smooth cosine blend
  var t = 0.5 * (1 + Math.cos(Math.PI * score / 0.5));  // 1 at score=0, 0 at score=0.5
  var r = Math.round(220 * (1 - t) + 16 * t);
  var g = Math.round(40 * (1 - t) + 185 * t);
  var b = Math.round(40 * (1 - t) + 50 * t);
  return "rgba(" + r + "," + g + "," + b + "," + alpha.toFixed(3) + ")";
}

// ======================== Drawing helpers ============================
var FONT  = "Arial, Helvetica, sans-serif";
var AXIS_W = 2;
var TICK_W = 1.5;
var TICK_L = 5;

function pubFrame(ctx, l, t, w, h) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = AXIS_W;
  ctx.strokeRect(l, t, w, h);
}

function drawGridBg(ctx, w, h) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(180,195,215,0.30)";
  ctx.lineWidth = 0.5;
  var sp = 40;
  for (var x = sp; x < w; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (var y = sp; y < h; y += sp) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

// ======================== Panel 1: Graphene Onsager orbits ==========
function drawTrajPanel(ctx, ctrl, phys, g) {
  drawGridBg(ctx, g.w, g.h);

  // Reference circle (dashed)
  ctx.strokeStyle = "rgba(160,178,200,0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.rPx, 0, TWO_PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // Wave parameters
  var segs = 500;
  var wAmp = clamp(g.rPx * 0.14, 5, 18);

  // Wave point helper ---------------------------------------------
  // f in [0,2]: f=0..1 is first orbit, f=1..2 is second orbit.
  // Arc length s = f * C.  The drawn phase is the Onsager index
  // n_F = C/(2*lambda_F), so closure marks a graphene Landau-level
  // center.  The raw kinetic de Broglie count would be C/lambda_F.
  function waveR(f) {
    var s = f * phys.circ;
    return g.rPx + wAmp * Math.sin(Math.PI * s / phys.lamF);
  }
  function waveXY(f) {
    var r = waveR(f);
    var angle = f * TWO_PI;   // fixed orientation, no rotation
    return { x: g.cx + r * Math.cos(angle), y: g.cy + r * Math.sin(angle) };
  }

  // --- Draw orbit 1 (blue) ----------------------------------------
  ctx.beginPath();
  for (var j = 0; j <= segs; j++) {
    var p1 = waveXY(j / segs);
    if (j === 0) ctx.moveTo(p1.x, p1.y); else ctx.lineTo(p1.x, p1.y);
  }
  ctx.strokeStyle = "rgba(40,110,220,0.55)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // --- Draw orbit 2 (red/green by interference) -------------------
  ctx.beginPath();
  for (var k = 0; k <= segs; k++) {
    var p2 = waveXY(1 + k / segs);
    if (k === 0) ctx.moveTo(p2.x, p2.y); else ctx.lineTo(p2.x, p2.y);
  }
  ctx.strokeStyle = interferenceColour(phys, 0.80);
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // --- Seam markers (start of orbit 1 vs end of orbit 2) ----------
  var seamA = waveXY(0);    // orbit 1 start
  var seamB = waveXY(2);    // orbit 2 end  (same angle, different r if destructive)
  // dashed line between the two to highlight any gap
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(seamA.x, seamA.y);
  ctx.lineTo(seamB.x, seamB.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // orbit 1 start dot (blue)
  ctx.fillStyle = "rgba(40,110,220,0.92)";
  ctx.beginPath(); ctx.arc(seamA.x, seamA.y, 4.5, 0, TWO_PI); ctx.fill();
  // orbit 2 end dot (interference colour)
  ctx.fillStyle = interferenceColour(phys, 0.92);
  ctx.beginPath(); ctx.arc(seamB.x, seamB.y, 4.5, 0, TWO_PI); ctx.fill();

  // --- Animated electron dot moving along the wave ----------------
  var totalAngle = -state.traj.theta;
  var modAngle   = ((totalAngle % (2 * TWO_PI)) + 2 * TWO_PI) % (2 * TWO_PI);
  var dotF       = modAngle / TWO_PI;   // 0..2 over two orbits
  var dotPt      = waveXY(dotF);
  // white outline + filled dot
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(dotPt.x, dotPt.y, 5, 0, TWO_PI); ctx.stroke();
  ctx.fillStyle = (dotF < 1) ? "rgba(40,110,220,0.95)" : interferenceColour(phys, 0.95);
  ctx.beginPath(); ctx.arc(dotPt.x, dotPt.y, 5, 0, TWO_PI); ctx.fill();

  // --- Labels -----------------------------------------------------
  var nBS = phys.nF;
  var iScore = interferenceScore(phys);
  var iLabel = (iScore < 0.08) ? "LL center" : (iScore > 0.42) ? "between LLs" : "partial";
  var colWord = (iScore < 0.08) ? "green" : (iScore > 0.42) ? "red" : "mixed";
  ctx.fillStyle = "rgba(20,35,60,0.92)";
  ctx.font = "bold 12px " + FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Graphene Onsager: n_F = " + nBS.toFixed(2) + "  [" + iLabel + "]", 10, 10);
  ctx.font = "11px " + FONT;
  ctx.fillText("C/lambda_F = " + phys.wavesOrbit.toFixed(2) + " = 2n_F.  rho_xx peak at LL center.", 10, 27);
  ctx.fillText("B=" + ctrl.bField.toFixed(2) + " T   r_c=" + (phys.rc * 1e9).toFixed(1) + " nm   lambda_F=" + (phys.lamF * 1e9).toFixed(1) + " nm", 10, 42);

  // border
  pubFrame(ctx, 0.5, 0.5, g.w - 1, g.h - 1);
}

// ======================== Panel 2: Landau fan =======================
function drawLandauPanel(ctx, ctrl, phys) {
  var w = state.landauSize.w, h = state.landauSize.h;
  var br = bRange();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  var L = 56, R = 16, T = 24, B = 36;
  var pW = w - L - R, pH = h - T - B;

  var xB = function (b) { return L + ((b - br.min) / (br.max - br.min)) * pW; };
  var eTop = Math.max(ctrl.fermiMeV * 1.5, landauEmeV(20, ctrl.vFermiM, br.max) * 1.1);
  var yE = function (e) { return T + (1 - clamp(e / eTop, 0, 1)) * pH; };

  // frame & grid lines
  pubFrame(ctx, L, T, pW, pH);

  // Landau levels
  var nMax = 18, samp = 150;
  for (var n = 0; n <= nMax; n++) {
    ctx.beginPath();
    for (var ii = 0; ii <= samp; ii++) {
      var frac = ii / samp;
      var b = br.min + frac * (br.max - br.min);
      var x = xB(b), y = yE(landauEmeV(n, ctrl.vFermiM, b));
      if (ii === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = (n % 2 === 0) ? "rgba(37,99,235,0.70)" : "rgba(100,150,210,0.55)";
    ctx.lineWidth = (n === 0) ? 2 : 1.3;
    ctx.stroke();
  }

  // current B line
  var xN = xB(ctrl.bField);
  ctx.strokeStyle = "rgba(217,119,6,0.9)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(xN, T); ctx.lineTo(xN, T + pH); ctx.stroke();
  ctx.setLineDash([]);

  // E_F line
  var yEf = yE(ctrl.fermiMeV);
  ctx.strokeStyle = "rgba(220,38,38,0.7)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(L, yEf); ctx.lineTo(L + pW, yEf); ctx.stroke();
  ctx.setLineDash([]);

  // bracketing Landau-level centers
  var yN0 = yE(landauEmeV(phys.nBel, ctrl.vFermiM, ctrl.bField));
  var yN1 = yE(landauEmeV(phys.nBel + 1, ctrl.vFermiM, ctrl.bField));
  ctx.strokeStyle = "rgba(5,150,105,0.85)";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(xN, yN0, 4.5, 0, TWO_PI); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(xN, yN1, 4.5, 0, TWO_PI); ctx.fill(); ctx.stroke();
  var llLblLeft = xN < L + pW - 78;
  var llLblX = llLblLeft ? xN + 8 : xN - 8;
  ctx.fillStyle = "#047857";
  ctx.font = "11px " + FONT;
  ctx.textAlign = llLblLeft ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillText("LL " + phys.nBel, llLblX, yN0);
  ctx.fillText("LL " + (phys.nBel + 1), llLblX, yN1);

  // dE bracket
  ctx.strokeStyle = "rgba(217,119,6,0.85)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(xN + 48, yN0); ctx.lineTo(xN + 48, yN1); ctx.stroke();
  ctx.fillStyle = "#92400e";
  ctx.font = "11px " + FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("dE ~ " + phys.dEmeV.toFixed(2) + " meV", xN + 54, (yN0 + yN1) * 0.5);

  // selected Fermi energy
  if (xN >= L && xN <= L + pW && yEf >= T && yEf <= T + pH) {
    ctx.strokeStyle = "#991b1b";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(xN, yEf, 7, 0, TWO_PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#dc2626";
    ctx.beginPath(); ctx.arc(xN, yEf, 3.4, 0, TWO_PI); ctx.fill();
    var efLblLeft = xN < L + pW - 68;
    var efLblX = efLblLeft ? xN + 10 : xN - 10;
    var efLblY = (yEf < T + 18) ? yEf + 13 : yEf - 14;
    ctx.fillStyle = "#991b1b";
    ctx.font = "bold 12px " + FONT;
    ctx.textAlign = efLblLeft ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillText("E_F", efLblX, efLblY);
  }

  // axis labels
  ctx.fillStyle = "#1a2233";
  ctx.font = "bold 12px " + FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Graphene Landau fan: E_n = sgn(n) v_F sqrt(2 e hbar B |n|)", 6, 6);
  ctx.font = "11px " + FONT;
  ctx.fillText("n_F ~ " + phys.nF.toFixed(2) + "  |  C/lambda_F ~ " + phys.wavesOrbit.toFixed(2), 6, 22);

  // B axis ticks
  ctx.font = "11px " + FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#334";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = TICK_W;
  var bTicks = niceTicks(br.min, br.max, 7);
  for (var bi = 0; bi < bTicks.length; bi++) {
    var xt = xB(bTicks[bi]);
    ctx.beginPath(); ctx.moveTo(xt, T + pH); ctx.lineTo(xt, T + pH + TICK_L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xt, T); ctx.lineTo(xt, T - TICK_L); ctx.stroke();
    ctx.fillText(bTicks[bi].toFixed(1), xt, T + pH + 7);
  }

  // E axis ticks
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  var eTicks = niceTicks(0, eTop, 5);
  for (var ei = 0; ei < eTicks.length; ei++) {
    var yt = yE(eTicks[ei]);
    ctx.beginPath(); ctx.moveTo(L - TICK_L, yt); ctx.lineTo(L, yt); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L + pW, yt); ctx.lineTo(L + pW + TICK_L, yt); ctx.stroke();
    ctx.fillText(eTicks[ei].toFixed(0), L - 7, yt);
  }

  // axis titles
  ctx.font = "bold 12px " + FONT;
  ctx.textAlign = "center";
  ctx.fillText("B (T)", L + pW / 2, h - 10);
  ctx.save();
  ctx.translate(14, T + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("E (meV)", 0, 0);
  ctx.restore();
}

// ======================== Panel 3: QHE line-scan ====================
function drawQHEPanel(ctx, ctrl, phys) {
  var w = state.qheSize.w, h = state.qheSize.h;
  var br = bRange();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  var L = 66, R = 72, T_pad = 24, B_pad = 38;
  var pW = w - L - R, pH = h - T_pad - B_pad;

  var xB = function (b) { return L + ((b - br.min) / (br.max - br.min)) * pW; };

  // compute curves
  var pts = [];
  var rhoMin = Infinity, rhoMax = -Infinity, rxyMax = 0;
  for (var i = 0; i <= QHE_SAMPLES; i++) {
    var frac = i / QHE_SAMPLES;
    var b = br.min + frac * (br.max - br.min);
    var q = qheAtB(ctrl, b);
    var ra = Math.abs(q.rhoxy);
    pts.push({ b: b, rhoxx: q.rhoxx, rxyA: ra });
    if (q.rhoxx < rhoMin) rhoMin = q.rhoxx;
    if (q.rhoxx > rhoMax) rhoMax = q.rhoxx;
    if (ra > rxyMax) rxyMax = ra;
  }
  var rhoSpan = Math.max(rhoMax - rhoMin, 1e-12);
  rhoMin -= 0.02 * rhoSpan;
  rhoMax += 0.06 * rhoSpan;
  var rxyTop = Math.max(rxyMax, 1e-12) * 1.08;

  var yRho = function (v) { return T_pad + (1 - (v - rhoMin) / Math.max(rhoMax - rhoMin, 1e-20)) * pH; };
  var yRxy = function (v) { return T_pad + (1 - v / Math.max(rxyTop, 1e-20)) * pH; };

  // frame
  pubFrame(ctx, L, T_pad, pW, pH);

  // coherence shading (model B)
  var bCo = coherenceField(phys);
  if (ctrl.dephaseModel === "modelB" && bCo > br.min) {
    var xSh = xB(Math.min(bCo, br.max));
    ctx.fillStyle = "rgba(254,205,211,0.35)";
    ctx.fillRect(L, T_pad, Math.max(0, xSh - L), pH);
    ctx.fillStyle = "rgba(176,47,67,0.85)";
    ctx.font = "10px " + FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("C > L_phi region", L + 6, T_pad + 4);
  }

  // rho_xx curve
  ctx.beginPath();
  for (var k = 0; k < pts.length; k++) {
    var xk = xB(pts[k].b), yk = yRho(pts[k].rhoxx);
    if (k === 0) ctx.moveTo(xk, yk); else ctx.lineTo(xk, yk);
  }
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // |rho_xy| curve
  ctx.beginPath();
  for (var m = 0; m < pts.length; m++) {
    var xm = xB(pts[m].b), ym = yRxy(pts[m].rxyA);
    if (m === 0) ctx.moveTo(xm, ym); else ctx.lineTo(xm, ym);
  }
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // current B markers
  var qNow = qheAtB(ctrl, ctrl.bField, phys);
  var xNow = xB(ctrl.bField);
  ctx.strokeStyle = "rgba(217,119,6,0.9)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(xNow, T_pad); ctx.lineTo(xNow, T_pad + pH); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#d97706";
  ctx.beginPath(); ctx.arc(xNow, yRho(qNow.rhoxx), 4.5, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = "#dc2626";
  ctx.beginPath(); ctx.arc(xNow, yRxy(Math.abs(qNow.rhoxy)), 4.5, 0, TWO_PI); ctx.fill();

  // B ticks
  ctx.font = "11px " + FONT;
  ctx.fillStyle = "#334";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = TICK_W;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var bTk = niceTicks(br.min, br.max, 7);
  for (var bi = 0; bi < bTk.length; bi++) {
    var xt = xB(bTk[bi]);
    ctx.beginPath(); ctx.moveTo(xt, T_pad + pH); ctx.lineTo(xt, T_pad + pH + TICK_L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xt, T_pad); ctx.lineTo(xt, T_pad - TICK_L); ctx.stroke();
    ctx.fillText(bTk[bi].toFixed(1), xt, T_pad + pH + 7);
  }

  // left axis ticks (rho_xx)
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  var rTk = niceTicks(rhoMin, rhoMax, 5);
  for (var ri = 0; ri < rTk.length; ri++) {
    var yr = yRho(rTk[ri]);
    ctx.beginPath(); ctx.moveTo(L - TICK_L, yr); ctx.lineTo(L, yr); ctx.stroke();
    ctx.fillText(rTk[ri].toExponential(1), L - 7, yr);
  }

  // right axis ticks (|rho_xy|)
  ctx.textAlign = "left";
  ctx.fillStyle = "#dc2626";
  ctx.strokeStyle = "#dc2626";
  var sTk = niceTicks(0, rxyTop, 5);
  for (var si = 0; si < sTk.length; si++) {
    var ys = yRxy(sTk[si]);
    ctx.beginPath(); ctx.moveTo(L + pW, ys); ctx.lineTo(L + pW + TICK_L, ys); ctx.stroke();
    ctx.fillText(sTk[si].toExponential(1), L + pW + 7, ys);
  }

  // axis titles
  ctx.font = "bold 12px " + FONT;
  ctx.fillStyle = "#1a2233";
  ctx.textAlign = "center";
  ctx.fillText("B (T)", L + pW / 2, h - 10);

  ctx.save();
  ctx.translate(14, T_pad + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#000";
  ctx.fillText("rho_xx (Ohm/sq)", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(L + pW + R - 10, T_pad + pH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#dc2626";
  ctx.fillText("|rho_xy| (Ohm/sq)", 0, 0);
  ctx.restore();

  // header
  ctx.fillStyle = "#1a2233";
  ctx.font = "bold 12px " + FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("QHE line scan: rho_xx (black) and |rho_xy| (red)", 6, 6);
}

// ======================== Panel 4: Fan heat map =====================
function buildFanCache(ctrl, phys, pW, pH) {
  var br  = bRange();
  var qty = ui.fanQuantity.value;
  var nMaxM2  = 1.5e16;
  var nMinM2  = -nMaxM2;

  var rr = state.rhoRange;
  var key = [qty, state.fanPalette, rr.min === null ? "auto" : rr.min.toFixed(4), rr.max === null ? "auto" : rr.max.toFixed(4), ctrl.dephaseModel, br.min.toFixed(4), br.max.toFixed(4),
    nMaxM2.toExponential(3), ctrl.tempK.toFixed(3), ctrl.vFermiM.toFixed(0),
    ctrl.mu.toFixed(3), ctrl.tauQfs.toFixed(3), ctrl.aqRate.toFixed(4),
    ctrl.aphiRate.toFixed(4), ctrl.bphiRate.toFixed(5), ctrl.alphaBMeV.toFixed(3),
    ctrl.peakE2h.toFixed(3), ctrl.nStar10cm2.toFixed(3), pW, pH].join("|");

  if (state.fanCache.key === key && state.fanCache.canvas) return;

  var gW = 240, gH = 180;
  var qp = makeQHEParams(ctrl);
  if (!state.fanCache.canvas) state.fanCache.canvas = document.createElement("canvas");
  state.fanCache.canvas.width = gW;
  state.fanCache.canvas.height = gH;

  var bCtx = state.fanCache.canvas.getContext("2d");
  var img  = bCtx.createImageData(gW, gH);
  var vals = new Float64Array(gW * gH);
  var vMin = Infinity, vMax = -Infinity;

  for (var y = 0; y < gH; y++) {
    var bF = br.max - ((br.max - br.min) * y) / Math.max(gH - 1, 1);
    var row = y * gW;
    for (var x = 0; x < gW; x++) {
      var nS = nMinM2 + ((nMaxM2 - nMinM2) * x) / Math.max(gW - 1, 1);
      var q  = qheFromDensity(nS, bF, qp);
      var v  = fanValue(qty, q);
      vals[row + x] = v;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  if (qty === "sigxy") {
    var ma = Math.max(Math.abs(vMin), Math.abs(vMax));
    vMin = -ma; vMax = ma;
  }
  if (qty === "rhoxx") {
    if (rr.min !== null) vMin = rr.min;
    if (rr.max !== null) vMax = rr.max;
    if (!(vMax > vMin)) vMax = vMin + 0.01;
  }
  if (!(vMax > vMin)) { vMin -= 1; vMax += 1; }

  var palette = (qty === "rhoxx") ? state.fanPalette : "orange";
  for (var ii = 0; ii < vals.length; ii++) {
    var c = heatColour(vals[ii], vMin, vMax, palette);
    var j = 4 * ii;
    img.data[j]     = c[0];
    img.data[j + 1] = c[1];
    img.data[j + 2] = c[2];
    img.data[j + 3] = 255;
  }
  bCtx.putImageData(img, 0, 0);

  state.fanCache.key    = key;
  state.fanCache.nMinM2 = nMinM2;
  state.fanCache.nMaxM2 = nMaxM2;
  state.fanCache.bMin   = br.min;
  state.fanCache.bMax   = br.max;
  state.fanCache.vMin   = vMin;
  state.fanCache.vMax   = vMax;
  state.fanCache.qty    = qty;
}

function drawFanPanel(ctx, ctrl, phys) {
  var w = state.fanSize.w, h = state.fanSize.h;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  var L = 66, R = 18, T_pad = 24, B_pad = 38;
  var pW = Math.max(30, w - L - R), pH = Math.max(30, h - T_pad - B_pad);

  buildFanCache(ctrl, phys, pW, pH);
  var fc = state.fanCache;

  var xN = function (n) { return L + ((n - fc.nMinM2) / Math.max(fc.nMaxM2 - fc.nMinM2, 1e-24)) * pW; };
  var yB = function (b) { return T_pad + ((fc.bMax - b) / Math.max(fc.bMax - fc.bMin, 1e-24)) * pH; };

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fc.canvas, L, T_pad, pW, pH);
  ctx.imageSmoothingEnabled = true;

  // n=0 line
  var x0 = xN(0);
  if (x0 >= L && x0 <= L + pW) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x0, T_pad); ctx.lineTo(x0, T_pad + pH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // crosshair at current (n, B)
  var nNow = ((ctrl.fermiMeV >= 0) ? 1 : -1) * phys.nM2;
  var xC = clamp(xN(nNow), L, L + pW);
  var yC = clamp(yB(ctrl.bField), T_pad, T_pad + pH);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(xC, T_pad); ctx.lineTo(xC, T_pad + pH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L, yC); ctx.lineTo(L + pW, yC); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#d97706";
  ctx.beginPath(); ctx.arc(xC, yC, 4.5, 0, TWO_PI); ctx.fill();

  // frame
  pubFrame(ctx, L, T_pad, pW, pH);

  // n ticks (in units of 10^16 m^-2 -> show as 10^12 cm^-2)
  ctx.font = "11px " + FONT;
  ctx.fillStyle = "#334";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = TICK_W;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var nTk = niceTicks(fc.nMinM2 / 1e16, fc.nMaxM2 / 1e16, 7);
  for (var ni = 0; ni < nTk.length; ni++) {
    var xTk = xN(nTk[ni] * 1e16);
    ctx.beginPath(); ctx.moveTo(xTk, T_pad + pH); ctx.lineTo(xTk, T_pad + pH + TICK_L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xTk, T_pad); ctx.lineTo(xTk, T_pad - TICK_L); ctx.stroke();
    ctx.fillText(nTk[ni].toFixed(1), xTk, T_pad + pH + 7);
  }

  // B ticks
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  var bTk = niceTicks(fc.bMin, fc.bMax, 5);
  for (var bi = 0; bi < bTk.length; bi++) {
    var yTk = yB(bTk[bi]);
    ctx.beginPath(); ctx.moveTo(L - TICK_L, yTk); ctx.lineTo(L, yTk); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L + pW, yTk); ctx.lineTo(L + pW + TICK_L, yTk); ctx.stroke();
    ctx.fillText(bTk[bi].toFixed(1), L - 7, yTk);
  }

  // axis titles
  ctx.font = "bold 12px " + FONT;
  ctx.fillStyle = "#1a2233";
  ctx.textAlign = "center";
  ctx.fillText("n (10^12 cm^-2)", L + pW / 2, h - 10);

  ctx.save();
  ctx.translate(14, T_pad + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("B (T)", 0, 0);
  ctx.restore();

  // header
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  var title = "Landau fan (" + fanLabel(fc.qty) + ")" + rhoRangeText();
  ctx.fillText(title, 6, 6);
  var tw = ctx.measureText(title).width;
  var dotX = 14 + tw, dotY = 13, dotR = 5;
  state.paletteDot = { x: dotX, y: dotY, r: dotR };
  var grad = ctx.createLinearGradient(dotX - dotR, dotY, dotX + dotR, dotY);
  if (state.fanPalette === "blue") {
    grad.addColorStop(0, "#1e40af"); grad.addColorStop(0.5, "#fff"); grad.addColorStop(1, "#b91c1c");
  } else {
    grad.addColorStop(0, "#0f4c81"); grad.addColorStop(0.58, "#fff7d6"); grad.addColorStop(1, "#b7222b");
  }
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, TWO_PI); ctx.fill();
  ctx.strokeStyle = "rgba(20,35,60,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ======================== Animation loop ============================
function animate(ts) {
  if (!state.lastTs) state.lastTs = ts;
  var dt = clamp((ts - state.lastTs) / 1000, 0, 1 / 30);
  state.lastTs = ts;

  var ctrl = readControls();
  state.elapsed += dt * ctrl.spinSpeed;
  var br   = bRange();

  if (state.autoplay) {
    var nb = ctrl.bField + state.sweepDir * ctrl.sweepRate * dt;
    if (nb >= br.max) { nb = br.max; state.sweepDir = -1; }
    else if (nb <= br.min) { nb = br.min; state.sweepDir = 1; }
    ui.bField.value = nb.toFixed(3);
    ctrl = readControls();
  }

  var phys = physicsAtB(ctrl, ctrl.bField);
  var qhe  = qheAtB(ctrl, ctrl.bField, phys);
  updateLabels(ctrl, phys, qhe);

  var g = trajGeom(phys);
  advanceTrail(dt, ctrl, phys, g);

  drawTrajPanel(trajCtx, ctrl, phys, g);
  drawLandauPanel(landauCtx, ctrl, phys);
  drawQHEPanel(qheCtx, ctrl, phys);
  drawFanPanel(fanCtx, ctrl, phys);

  requestAnimationFrame(animate);
}

// ======================== Wiring ====================================
function wireUI() {
  var refresh = function () {
    var c = readControls();
    var p = physicsAtB(c, c.bField);
    var q = qheAtB(c, c.bField, p);
    updateLabels(c, p, q);
  };

  var sliders = [
    ui.sweepRate, ui.spinSpeed, ui.bField, ui.tempK, ui.lphi1k, ui.fermi, ui.vFermi, ui.trail,
    ui.mu, ui.tauQfs, ui.alphaB, ui.peakE2h, ui.nStar,
    ui.aqRate, ui.aphiRate, ui.bphiRate
  ];
  for (var i = 0; i < sliders.length; i++) {
    sliders[i].addEventListener("input", refresh);
  }

  ui.fanQuantity.addEventListener("change", refresh);
  ui.dephaseModel.addEventListener("change", refresh);

  ui.fanCanvas.addEventListener("mousedown", function (e) {
    var rect = ui.fanCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var fc = state.fanCache;
    var pW = state.fanSize.w - 66 - 18, pH = state.fanSize.h - 24 - 38;
    if (e.shiftKey && fc.canvas && pW > 0 && pH > 0 && x >= 66 && x <= 66 + pW && y >= 24 && y <= 24 + pH) {
      var xFrac = clamp((x - 66) / pW, 0, 1);
      var yFrac = clamp((y - 24) / pH, 0, 1);
      var nM2 = fc.nMinM2 + xFrac * (fc.nMaxM2 - fc.nMinM2);
      var B = fc.bMax - yFrac * (fc.bMax - fc.bMin);
      var q = qheFromDensity(nM2, B, makeQHEParams(readControls()));
      var v = Math.log10(Math.max(q.rhoxx, 1e-24));
      var r = state.rhoRange;
      if (r.next === "min") { r.min = v; r.next = "max"; } else { r.max = v; r.next = "min"; }
      if (r.min !== null && r.max !== null && r.min > r.max) { var tmp = r.min; r.min = r.max; r.max = tmp; }
      state.fanCache.key = "";
      return;
    }
    var d = state.paletteDot;
    if (d && Math.hypot(x - d.x, y - d.y) <= d.r + 5) {
      state.fanPalette = (state.fanPalette === "orange") ? "blue" : "orange";
      state.fanCache.key = "";
    }
  });

  ui.fanCanvas.addEventListener("mousemove", function (e) {
    var rect = ui.fanCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var d = state.paletteDot;
    ui.fanCanvas.style.cursor = (d && Math.hypot(x - d.x, y - d.y) <= d.r + 5) ? "pointer" : "crosshair";
  });

  ui.toggleBtn.addEventListener("click", function () { setCollapsed(!state.collapsed); });

  ui.playBtn.addEventListener("click", function () {
    state.autoplay = !state.autoplay;
    ui.playBtn.textContent = state.autoplay ? "Pause" : "Sweep B";
  });

  ui.resetBtn.addEventListener("click", function () { resetTrail(); });

  refresh();
  setCollapsed(false);
}

// ======================== Boot ======================================
var trajSetup   = setupCanvas(ui.trajCanvas,   function (w, h) { state.trajSize   = { w: w, h: h }; });
var landauSetup = setupCanvas(ui.landauCanvas, function (w, h) { state.landauSize = { w: w, h: h }; });
var qheSetup    = setupCanvas(ui.qheCanvas,    function (w, h) { state.qheSize    = { w: w, h: h }; });
var fanSetup    = setupCanvas(ui.fanCanvas,    function (w, h) { state.fanSize    = { w: w, h: h }; });

var trajCtx   = trajSetup.ctx;
var landauCtx = landauSetup.ctx;
var qheCtx    = qheSetup.ctx;
var fanCtx    = fanSetup.ctx;

window.addEventListener("resize", function () {
  trajSetup.resize();
  landauSetup.resize();
  qheSetup.resize();
  fanSetup.resize();
  state.fanCache.key = "";
  resetTrail();
});

wireUI();
resetTrail();
requestAnimationFrame(animate);
