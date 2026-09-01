// graphene-phonons — DSW plugin port of the browser sim
// "Graphene Lattice Vibrations 2" (dex-2dphys.github.io/tools/graphene-phonons).
//
// A 2D honeycomb lattice of point masses:
//   * nearest-neighbour bonds, either harmonic (k) or Morse (De, alpha),
//   * second-neighbour "angular" springs (kAng) that give the lattice its
//     shear rigidity — without them a honeycomb of central-force bonds is
//     floppy and collapses,
//   * optional bond breaking (d > L0*fBreak) and re-forming among the ORIGINAL
//     neighbour list only (d < L0*fReform), with a hard valence cap of 3,
//   * viscous damping and a semi-implicit (Euler-Cromer) update.
//
// The physics is a faithful port of the prototype's step(); the numbers are
// intentionally the prototype's own, so a parameter set carries over unchanged.
// What the port adds is speed (OpenMP over atoms and bonds, flat arrays instead
// of objects) and the ability to run sizes the browser could not.
//
// Rendering follows graphene-md: the plugin ships packed float32 geometry
// through the frame channel (height = 1, width = bytes/4) and the page draws
// it, so the prototype's canvas look is preserved exactly.

#include "dex_plugin.h"
#include "dex_msg.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_set>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

struct Params {
    // lattice
    int cells = 12;
    double L0 = 1.0;
    // bonds
    bool useMorse = true;
    double k = 40.0;          // harmonic spring constant
    double De = 5.0;          // Morse well depth
    double alpha = 2.0;       // Morse width
    bool useAng = true;
    double kAng = 8.0;        // second-neighbour spring
    // dynamics
    double g = 0.05;          // viscous damping
    double dt = 0.01;
    double m = 1.0;
    // bond kinetics
    bool doBreak = false, doReform = false;
    double fBreak = 1.35, fReform = 1.15;
    // driving / init
    double off = 0.02;        // random initial displacement, in units of L0
    int stepsPerFrame = 4;
};

inline double clampd(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// Undirected bond key for the "is this pair currently bonded" set.
inline uint64_t bkey(int i, int j) {
    if (i > j) std::swap(i, j);
    return ((uint64_t)(uint32_t)i << 32) | (uint32_t)j;
}

struct Instance {
    Params P;

    // atoms, structure-of-arrays
    std::vector<double> px, py, vx, vy, fx, fy;
    std::vector<double> px0, py0;        // as-built reference (for reset)

    // live bonds
    std::vector<int32_t> bi, bj;
    std::vector<double> bL0;
    // the ORIGINAL nearest-neighbour list: re-forming only ever restores one
    // of these, exactly as the prototype does. A bond that has broken can come
    // back; a pair that was never bonded never becomes one.
    std::vector<int32_t> oi, oj;
    std::vector<double> oL0;
    std::unordered_set<uint64_t> bondSet;
    // second-neighbour springs (fixed for the run)
    std::vector<int32_t> ai, aj;
    std::vector<double> aL0;

    // grabbed atom (mouse spring), -1 for none
    int grab = -1;
    double grabX = 0, grabY = 0, grabK = 20.0;

    double ePot = 0, eKin = 0;
    long long frame = 0;
    bool running = false;
    int pendingSteps = 0;
    double stepMs = 0, statsClock = 0;
    int stepsWindow = 0;

    std::vector<uint8_t> frameBuf;
    bool topologyDirty = true;
    std::string outbox;
    bool haveOut = false;

    uint32_t rng = 22222u;
    double frand() {   // deterministic, so a rebuild is reproducible
        rng = rng * 1664525u + 1013904223u;
        return (double)(rng >> 8) / 16777216.0;
    }

    size_t nAtoms() const { return px.size(); }

    // ------------------------------------------------------------ build

    void build() {
        const int n = std::max(5, std::min(P.cells, 500));
        P.cells = n;
        const double L0 = P.L0;
        const double a1x = std::sqrt(3.0) * L0, a1y = 0.0;
        const double a2x = std::sqrt(3.0) / 2 * L0, a2y = 1.5 * L0;
        const double Bx = std::sqrt(3.0) / 2 * L0, By = 0.5 * L0;

        const size_t N = (size_t)n * n * 2;
        px.assign(N, 0.0); py.assign(N, 0.0);
        vx.assign(N, 0.0); vy.assign(N, 0.0);
        fx.assign(N, 0.0); fy.assign(N, 0.0);

        auto idx = [n](int i, int j, int s) { return ((j * n + i) * 2 + s); };
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                const double Rx = a1x * i + a2x * j, Ry = a1y * i + a2y * j;
                const int A = idx(i, j, 0), B = idx(i, j, 1);
                px[A] = Rx;      py[A] = Ry;
                px[B] = Rx + Bx; py[B] = Ry + By;
            }

        bi.clear(); bj.clear(); bL0.clear();
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                const int A = idx(i, j, 0), B = idx(i, j, 1);
                if (i - 1 >= 0) { bi.push_back(A); bj.push_back(idx(i - 1, j, 1)); bL0.push_back(L0); }
                if (j - 1 >= 0) { bi.push_back(A); bj.push_back(idx(i, j - 1, 1)); bL0.push_back(L0); }
                bi.push_back(A); bj.push_back(B); bL0.push_back(L0);
            }
        oi = bi; oj = bj; oL0 = bL0;

        // second neighbours: same sublattice, six in-plane offsets
        const double L2 = std::sqrt(3.0) * L0;
        const int off[6][2] = {{1,0},{0,1},{1,-1},{-1,0},{0,-1},{-1,1}};
        ai.clear(); aj.clear(); aL0.clear();
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                const int A = idx(i, j, 0), B = idx(i, j, 1);
                for (auto &o : off) {
                    const int I = i + o[0], J = j + o[1];
                    if (I < 0 || I >= n || J < 0 || J >= n) continue;
                    const int A2 = idx(I, J, 0), B2 = idx(I, J, 1);
                    if (A2 > A) { ai.push_back(A); aj.push_back(A2); aL0.push_back(L2); }
                    if (B2 > B) { ai.push_back(B); aj.push_back(B2); aL0.push_back(L2); }
                }
            }

        px0 = px; py0 = py;
        rebuildBondSet();
        topologyDirty = true;
        grab = -1;
        frame = 0;
        randomize(P.off);
        computeForces();
    }

    void rebuildBondSet() {
        bondSet.clear();
        bondSet.reserve(bi.size() * 2);
        for (size_t b = 0; b < bi.size(); b++) bondSet.insert(bkey(bi[b], bj[b]));
    }

    void resetPositions() {
        px = px0; py = py0;
        std::fill(vx.begin(), vx.end(), 0.0);
        std::fill(vy.begin(), vy.end(), 0.0);
        bi = oi; bj = oj; bL0 = oL0;
        rebuildBondSet();
        topologyDirty = true;
        grab = -1;
        frame = 0;
        randomize(P.off);
        computeForces();
    }

    void randomize(double amp) {
        if (amp <= 0) return;
        const double a = amp * P.L0;
        for (size_t i = 0; i < nAtoms(); i++) {
            px[i] += (frand() * 2 - 1) * a;
            py[i] += (frand() * 2 - 1) * a;
        }
    }

    // ------------------------------------------------------------ forces

    double bondForces() {
        double pe = 0;
        const bool morse = P.useMorse;
        const double De = P.De, al = P.alpha, k = P.k;
        // Bond loops are a scatter (two atoms per bond), so they are serial:
        // at these sizes the atom loop dominates anyway and a coloured or
        // atomic version would cost more than it saves.
        for (size_t b = 0; b < bi.size(); b++) {
            const int i = bi[b], j = bj[b];
            const double dx = px[j] - px[i], dy = py[j] - py[i];
            double d = std::sqrt(dx * dx + dy * dy);
            if (d < 1e-12) d = 1e-12;
            const double ux = dx / d, uy = dy / d;
            double fm;
            if (morse) {
                const double ex = std::exp(-al * (d - bL0[b]));
                fm = 2 * De * al * ex * (1 - ex);
                pe += De * ((1 - ex) * (1 - ex) - 1);
            } else {
                const double x = d - bL0[b];
                fm = k * x;
                pe += 0.5 * k * x * x;
            }
            const double Fx = fm * ux, Fy = fm * uy;
            fx[i] += Fx; fy[i] += Fy;
            fx[j] -= Fx; fy[j] -= Fy;
        }
        if (P.useAng && P.kAng > 0) {
            const double ka = P.kAng;
            for (size_t b = 0; b < ai.size(); b++) {
                const int i = ai[b], j = aj[b];
                const double dx = px[j] - px[i], dy = py[j] - py[i];
                double d = std::sqrt(dx * dx + dy * dy);
                if (d < 1e-12) d = 1e-12;
                const double x = d - aL0[b], f = ka * x;
                const double Fx = f * dx / d, Fy = f * dy / d;
                fx[i] += Fx; fy[i] += Fy;
                fx[j] -= Fx; fy[j] -= Fy;
                pe += 0.5 * ka * x * x;
            }
        }
        return pe;
    }

    void computeForces() {
        std::fill(fx.begin(), fx.end(), 0.0);
        std::fill(fy.begin(), fy.end(), 0.0);
        ePot = bondForces();
        if (grab >= 0 && (size_t)grab < nAtoms()) {
            fx[grab] += grabK * (grabX - px[grab]);
            fy[grab] += grabK * (grabY - py[grab]);
        }
    }

    // Break over-stretched bonds, then restore any ORIGINAL bond that has come
    // back within range and whose two atoms both still have a free valence.
    void bondKinetics() {
        if (!P.doBreak && !P.doReform) return;
        const size_t N = nAtoms();
        std::vector<int16_t> val(N, 0);
        for (size_t b = 0; b < bi.size(); b++) { val[bi[b]]++; val[bj[b]]++; }

        bool changed = false;
        if (P.doBreak) {
            const size_t before = bi.size();
            size_t w = 0;
            for (size_t b = 0; b < bi.size(); b++) {
                const int i = bi[b], j = bj[b];
                const double dx = px[j] - px[i], dy = py[j] - py[i];
                const double d = std::sqrt(dx * dx + dy * dy);
                if (d > bL0[b] * P.fBreak) {
                    bondSet.erase(bkey(i, j));
                    val[i]--; val[j]--;
                    continue;                      // drop it
                }
                bi[w] = bi[b]; bj[w] = bj[b]; bL0[w] = bL0[b];
                w++;
            }
            bi.resize(w); bj.resize(w); bL0.resize(w);
            changed = changed || w != before;
        }
        if (P.doReform) {
            for (size_t b = 0; b < oi.size(); b++) {
                const int i = oi[b], j = oj[b];
                if (bondSet.count(bkey(i, j))) continue;
                if (val[i] >= 3 || val[j] >= 3) continue;
                const double dx = px[j] - px[i], dy = py[j] - py[i];
                const double d = std::sqrt(dx * dx + dy * dy);
                if (d < oL0[b] * P.fReform) {
                    bi.push_back(i); bj.push_back(j); bL0.push_back(oL0[b]);
                    bondSet.insert(bkey(i, j));
                    val[i]++; val[j]++;
                    changed = true;
                }
            }
        }
        if (changed) topologyDirty = true;
    }

    void step() {
        computeForces();
        bondKinetics();
        const double g = P.g, dt = P.dt, m = P.m > 0 ? P.m : 1.0;
        double ke = 0;
        const int N = (int)nAtoms();
#ifdef _OPENMP
#pragma omp parallel for reduction(+ : ke) schedule(static)
#endif
        for (int i = 0; i < N; i++) {
            const double ax = (fx[i] - g * vx[i]) / m;
            const double ay = (fy[i] - g * vy[i]) / m;
            vx[i] += ax * dt; vy[i] += ay * dt;   // Euler-Cromer, as the original
            px[i] += vx[i] * dt; py[i] += vy[i] * dt;
            ke += 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i]);
        }
        eKin = ke;
        frame++;
        stepsWindow++;
    }

    // ------------------------------------------------- wire protocol
    //
    //   magic 'GPH1', flags, nAtoms, nBonds, frame, spare, ePot, eKin
    //   float  pos[2n]
    //   int32  bonds[2b]     (only when F_BONDS is set)
    //   float  strain[b]     (d/L0 - 1, so the page can colour without maths)
    static const uint32_t MAGIC = 0x31485047u;  // 'GPH1' little-endian
    static const uint32_t F_BONDS = 1u;

    void packFrame() {
        const uint32_t n = (uint32_t)nAtoms(), b = (uint32_t)bi.size();
        const uint32_t flags = topologyDirty ? F_BONDS : 0u;
        const size_t words = 8 + (size_t)2 * n +
            ((flags & F_BONDS) ? (size_t)2 * b : 0) + b;
        frameBuf.resize(words * 4);
        uint8_t *p = frameBuf.data();
        auto u32 = [&](uint32_t v) { memcpy(p, &v, 4); p += 4; };
        auto f32 = [&](float v) { memcpy(p, &v, 4); p += 4; };
        u32(MAGIC); u32(flags); u32(n); u32(b);
        u32((uint32_t)frame); u32(0);
        f32((float)ePot); f32((float)eKin);
        for (uint32_t i = 0; i < n; i++) { f32((float)px[i]); f32((float)py[i]); }
        if (flags & F_BONDS)
            for (uint32_t k = 0; k < b; k++) { u32((uint32_t)bi[k]); u32((uint32_t)bj[k]); }
        for (uint32_t k = 0; k < b; k++) {
            const int i = bi[k], j = bj[k];
            const double dx = px[j] - px[i], dy = py[j] - py[i];
            const double d = std::sqrt(dx * dx + dy * dy);
            f32((float)(d / (bL0[k] > 0 ? bL0[k] : 1.0) - 1.0));
        }
        topologyDirty = false;
    }

    void say(const std::string &s) { outbox = s; haveOut = true; }

    void sayState(long q) {
        char buf[420];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"q\":%ld,\"n\":%d,\"nbonds\":%d,\"cells\":%d,"
                 "\"frame\":%lld,\"epot\":%.6g,\"ekin\":%.6g,\"etot\":%.6g,"
                 "\"running\":%d,\"ms\":%.4f,\"sps\":%.0f,\"threads\":%d}",
                 q, (int)nAtoms(), (int)bi.size(), P.cells, frame, ePot, eKin,
                 ePot + eKin, running ? 1 : 0, stepMs,
                 statsClock > 0 ? stepsWindow / statsClock : 0.0,
#ifdef _OPENMP
                 omp_get_max_threads()
#else
                 1
#endif
        );
        say(buf);
    }

    void readParams(const std::string &m) {
        auto num = [&](const char *k, double d) { return dexmsg::get_num(m, k, d); };
        P.L0 = num("L0", P.L0);
        P.k = num("k", P.k);
        P.De = num("De", P.De);
        P.alpha = num("alpha", P.alpha);
        P.kAng = num("kAng", P.kAng);
        P.useAng = num("useAng", P.useAng ? 1 : 0) != 0;
        P.useMorse = num("useMorse", P.useMorse ? 1 : 0) != 0;
        P.g = num("g", P.g);
        P.dt = num("dt", P.dt);
        P.m = num("m", P.m);
        P.doBreak = num("doBreak", P.doBreak ? 1 : 0) != 0;
        P.doReform = num("doReform", P.doReform ? 1 : 0) != 0;
        P.fBreak = num("fBreak", P.fBreak);
        P.fReform = num("fReform", P.fReform);
        P.off = num("off", P.off);
        P.stepsPerFrame = std::max(1, (int)num("stepsPerFrame", P.stepsPerFrame));
    }

    void handle(const std::string &m) {
        const std::string t = dexmsg::type_of(m);
        const long q = (long)dexmsg::get_num(m, "q", -1);
        if (t == "build") {
            readParams(m);
            P.cells = (int)dexmsg::get_num(m, "cells", P.cells);
            build();
            sayState(q);
        } else if (t == "params") {
            readParams(m);
            computeForces();
            sayState(q);
        } else if (t == "run") {
            running = dexmsg::get_num(m, "on", 0) != 0;
            sayState(q);
        } else if (t == "step") {
            pendingSteps += std::max(1, (int)dexmsg::get_num(m, "n", 1));
            sayState(q);
        } else if (t == "reset") {
            resetPositions();
            sayState(q);
        } else if (t == "randomize") {
            randomize(dexmsg::get_num(m, "off", P.off));
            computeForces();
            sayState(q);
        } else if (t == "grab") {
            // i = -2 means "keep dragging whatever is already held": the page
            // sends it on every pointermove so it does not have to re-find the
            // atom, and re-finding would let the grab jump to a neighbour.
            const int want = (int)dexmsg::get_num(m, "i", -1);
            if (want != -2) grab = want;
            grabX = dexmsg::get_num(m, "x", 0);
            grabY = dexmsg::get_num(m, "y", 0);
            grabK = dexmsg::get_num(m, "k", grabK);
            if (grab < 0 || (size_t)grab >= nAtoms()) grab = -1;
        } else if (t == "release") {
            grab = -1;
        } else if (t == "state") {
            sayState(q);
        }
    }
};

}  // namespace

extern "C" {

void *dexp_create() {
    Instance *s = new Instance();
    s->build();
    return s;
}
void dexp_destroy(void *p) { delete (Instance *)p; }

int dexp_advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    int budget = 0;
    if (s->running) budget = s->P.stepsPerFrame;
    else if (s->pendingSteps > 0) { budget = s->pendingSteps; s->pendingSteps = 0; }
    if (budget <= 0) return 0;

    const auto t0 = std::chrono::steady_clock::now();
    int done = 0;
    bool cutShort = false;
    for (int i = 0; i < budget; i++) {
        s->step();
        done++;
        if (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() > 0.010) {
            cutShort = true;
            break;
        }
    }
    // Hand back whatever the 10 ms responsiveness cap cut short, or an explicit
    // "step n" request is silently truncated. (graphene-md had exactly this bug.)
    if (cutShort && !s->running) s->pendingSteps += budget - done;

    s->stepMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t0).count() / std::max(done, 1);
    s->statsClock += dt;
    if (s->statsClock >= 0.5) {
        s->sayState(-1);
        s->statsClock = 0;
        s->stepsWindow = 0;
    }
    return 1;
}

void dexp_on_message(void *p, const char *json, size_t len) {
    ((Instance *)p)->handle(std::string(json, len));
}

const char *dexp_poll_message(void *p) {
    Instance *s = (Instance *)p;
    if (!s->haveOut) return nullptr;
    s->haveOut = false;
    return s->outbox.c_str();
}

int dexp_render(void *p, dex_frame *out) {
    Instance *s = (Instance *)p;
    s->packFrame();
    out->width = (uint32_t)(s->frameBuf.size() / 4);
    out->height = 1;
    out->rgba = s->frameBuf.data();
    return 1;
}

}  // extern "C"

static const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "graphene-phonons",
    "Graphene Lattice Vibrations",
    "1.0",
    dexp_create,
    dexp_destroy,
    dexp_advance,
    dexp_on_message,
    dexp_poll_message,
    dexp_render,
};

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
