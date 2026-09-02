// Offline acceptance probe for 2dmd — drives the plugin through its own C API
// (md_create / md_on_message / md_advance / md_render), no DSW host needed.
//
// Build (from the bundle root, toolchain per DSW/tools/probe-2dmd-phase7.js):
//   g++ -std=c++17 -O2 -fopenmp -DDMD_LAMMPS test/probe2dmd.cpp src/plugin.cpp \
//       src/dl_stub.cpp -Isrc -I$LAMMPS/src -L$LAMMPS/build -llammps -lpsapi \
//       -lws2_32 -static -static-libgcc -static-libstdc++ -o test/probe2dmd.exe
//   copy potentials\* beside the exe's folder as test\potentials\  (bundleDir()
//   resolves relative to the running module, which for a static exe is the exe)
//
// What it proves, each item a bug fixed on 2026-09-02:
//   1  subTab vs exact pair sum agree — graphene substrate
//   2  subTab vs exact pair sum agree — MoTe2 substrate under a graphene sheet
//      (the table used to be built from the graphene lattice regardless)
//   3  classic elevate lifts the sheet (table path, liftAt in the read)
//   4  LAMMPS elevate lifts the sheet — the "substrate rises, sheet does not
//      move" report: the LAMMPS callback forgot liftAt in the table read
//   5  MoTe2 builds under LAMMPS, energy finite, species block carries {0,1,2}
//   6  reset under LAMMPS actually restores positions
//   7  a protLoc change zeroes the elevation state
//   8  shape reaches the core ("mesa" was silently dropped by readParams)

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "dex_plugin.h"

extern "C" const dex_plugin_api *dex_plugin_entry(void);

static const dex_plugin_api *api = nullptr;
static int checks = 0, fails = 0;

static void check(bool ok, const char *what) {
    checks++;
    if (!ok) { fails++; printf("FAIL  %s\n", what); }
    else printf("  ok  %s\n", what);
}

static std::string lastMsg;
static std::string say(void *inst, const std::string &json) {
    api->on_message(inst, json.c_str(), json.size());
    const char *r = api->poll_message(inst);
    lastMsg = r ? r : "";
    return lastMsg;
}

static double jnum(const std::string &s, const char *key, double dflt) {
    const std::string k = std::string("\"") + key + "\":";
    const size_t p = s.find(k);
    if (p == std::string::npos) return dflt;
    return atof(s.c_str() + p + k.size());
}
static std::string jstr(const std::string &s, const char *key) {
    const std::string k = std::string("\"") + key + "\":\"";
    const size_t p = s.find(k);
    if (p == std::string::npos) return "";
    const size_t q = s.find('"', p + k.size());
    return s.substr(p + k.size(), q - p - k.size());
}

// ---- minimal 2DM1 reader (spec: DSW/2DMD-FRAME-FORMAT.md) ----
struct Frame {
    uint32_t nL = 0;
    std::vector<uint32_t> n, lflags;
    std::vector<std::vector<float>> pos;      // xyz per present layer
    std::vector<float> species;               // block 3, concatenated
    bool hasSpecies = false;
};
static Frame readFrame(void *inst) {
    dex_frame f{};
    api->render(inst, &f);
    const uint8_t *p = f.rgba;
    const uint8_t *end = p + (size_t)f.width * 4;
    Frame out;
    auto u32 = [&]() { uint32_t v; memcpy(&v, p, 4); p += 4; return v; };
    auto f32 = [&]() { float v; memcpy(&v, p, 4); p += 4; return v; };
    const uint32_t magic = u32();
    if (magic != 0x314D4432u) { printf("bad magic\n"); return out; }
    u32(); u32();                       // version, flags
    out.nL = u32();
    u32(); f32(); f32();                // frame, epot, ekin
    const uint32_t nBlocks = u32();
    out.n.resize(out.nL); out.lflags.resize(out.nL);
    for (uint32_t k = 0; k < out.nL; k++) { out.n[k] = u32(); out.lflags[k] = u32(); }
    out.pos.resize(out.nL);
    for (uint32_t k = 0; k < out.nL; k++) {
        if (!(out.lflags[k] & 2)) continue;
        out.pos[k].resize(3 * out.n[k]);
        memcpy(out.pos[k].data(), p, 12ull * out.n[k]);
        p += 12ull * out.n[k];
    }
    for (uint32_t b = 0; b < nBlocks && p + 16 <= end; b++) {
        const uint32_t kind = u32(); u32();
        const uint32_t nv = u32(); u32();
        if (kind == 3) {
            out.species.resize(nv);
            memcpy(out.species.data(), p, 4ull * nv);
            out.hasSpecies = true;
        }
        p += 4ull * nv;
    }
    return out;
}

static double meanZ(const Frame &F, uint32_t layer) {
    if (layer >= F.nL || F.pos[layer].empty()) return 0.0;
    double s = 0;
    for (uint32_t i = 0; i < F.n[layer]; i++) s += F.pos[layer][3 * i + 2];
    return s / F.n[layer];
}

// The elev/gas handlers set running=true, and advance() then always reports
// work -- so drive a bounded number of advance slices (each capped at ~10 ms
// by the core) rather than waiting for it to go quiet.
static void run(void *inst, int iters) {
    say(inst, "{\"t\":\"run\",\"on\":1}");
    for (int i = 0; i < iters; i++) api->advance(inst, 0.016);
    say(inst, "{\"t\":\"run\",\"on\":0}");
}

int main() {
    api = dex_plugin_entry();

    // ---- 1+2: substrate table vs exact pair sum, both substrate materials --
    for (const char *sub : {"same", "mote2"}) {
        void *s = api->create();
        char b[512];
        // The table is the INFINITE periodic lattice; the pair sum sees the
        // cropped substrate. The sheet must sit deeper inside the substrate
        // than the 3-sigma cutoff or the rim disagreement is real physics,
        // not table error.
        snprintf(b, sizeof b,
                 "{\"t\":\"build\",\"Nnm\":5,\"Nsubnm\":9,\"nLayers\":1,"
                 "\"material\":\"graphene\",\"subMaterial\":\"%s\","
                 "\"engine\":\"classic\",\"subTab\":1,\"subGrid\":64,"
                 "\"zSub\":%s}", sub, strcmp(sub, "mote2") ? "3.35" : "5.71");
        say(s, b);
        const double eTab = jnum(lastMsg, "epot", 1e9);
        say(s, "{\"t\":\"params\",\"subTab\":0}");
        const double eSum = jnum(lastMsg, "epot", -1e9);
        say(s, "{\"t\":\"params\",\"substrateOn\":0}");
        const double eOff = jnum(lastMsg, "epot", 0);
        // compare only the SUBSTRATE'S OWN share: in-plane terms cancel
        const double sTab = eTab - eOff, sSum = eSum - eOff;
        const double rel = std::fabs(sTab - sSum) / std::max(1e-12, std::fabs(sSum));
        printf("      sub=%s  substrate energy: table %.6g  pairs %.6g  rel %.3g\n",
               sub, sTab, sSum, rel);
        char msg[128];
        snprintf(msg, sizeof msg, "substrate table matches pair sum (sub=%s)", sub);
        check(sSum < -1e-4 && rel < 0.02, msg);
        api->destroy(s);
    }

    // ---- 3: classic elevate lifts the sheet through the table -------------
    {
        void *s = api->create();
        say(s, "{\"t\":\"build\",\"Nnm\":6,\"Nsubnm\":6,\"nLayers\":1,"
               "\"material\":\"graphene\",\"engine\":\"classic\",\"subTab\":1,"
               "\"targetDz\":6,\"liftRate\":0.05,\"holdSteps\":100000,"
               "\"shape\":\"gauss\",\"Mxnm\":3,\"Mynm\":3}");
        const double z0 = meanZ(readFrame(s), 1);
        say(s, "{\"t\":\"elev\",\"on\":1}");
        run(s, 800);
        const double z1 = meanZ(readFrame(s), 1);
        printf("      classic lift: sheet mean z %.3f -> %.3f\n", z0, z1);
        check(z1 - z0 > 0.5, "classic elevate lifts the sheet");
        api->destroy(s);
    }

    // ---- 4: LAMMPS elevate lifts the sheet (the reported bug) -------------
    {
        void *s = api->create();
        say(s, "{\"t\":\"build\",\"Nnm\":5,\"Nsubnm\":5,\"nLayers\":1,"
               "\"material\":\"graphene\",\"engine\":\"lammps\",\"subTab\":1,"
               "\"targetDz\":6,\"liftRate\":0.05,\"holdSteps\":100000,"
               "\"shape\":\"gauss\",\"Mxnm\":3,\"Mynm\":3}");
        const std::string eng = jstr(lastMsg, "engine");
        check(eng == "lammps", "LAMMPS engine started for graphene");
        const double z0 = meanZ(readFrame(s), 1);
        say(s, "{\"t\":\"elev\",\"on\":1}");
        run(s, 400);
        const double z1 = meanZ(readFrame(s), 1);
        printf("      lammps lift: sheet mean z %.3f -> %.3f\n", z0, z1);
        check(z1 - z0 > 0.3, "LAMMPS elevate lifts the sheet (liftAt in table read)");

        // ---- 6: reset restores LAMMPS positions --------------------------
        say(s, "{\"t\":\"elev\",\"on\":0}");
        say(s, "{\"t\":\"reset\"}");
        run(s, 1);
        const double z2 = meanZ(readFrame(s), 1);
        printf("      after reset: sheet mean z %.3f (built at %.3f)\n", z2, z0);
        check(std::fabs(z2 - z0) < 0.3, "reset restores positions under LAMMPS");
        api->destroy(s);
    }

    // ---- 5: MoTe2 builds under LAMMPS; species block carries three kinds --
    {
        void *s = api->create();
        say(s, "{\"t\":\"build\",\"Nnm\":5,\"Nsubnm\":5,\"nLayers\":2,"
               "\"material\":\"mote2\",\"engine\":\"lammps\",\"z0\":8.07,"
               "\"zSub\":8.07,\"dtFs\":0.5}");
        const std::string eng = jstr(lastMsg, "engine");
        const std::string mat = jstr(lastMsg, "mat");
        const double n = jnum(lastMsg, "n", 0);
        const double ep = jnum(lastMsg, "epot", 1e9);
        printf("      mote2: engine=%s mat=%s n=%.0f epot=%.4g (%s)\n",
               eng.c_str(), mat.c_str(), n, ep, jstr(lastMsg, "lmpError").c_str());
        check(eng == "lammps", "MoTe2 runs on LAMMPS (SW potential found)");
        check(mat == "mote2", "state names the material");
        check(n > 100 && std::isfinite(ep) && ep < 0, "MoTe2 bound and finite");
        Frame F = readFrame(s);
        check(F.hasSpecies, "frame carries the species block");
        float mx = 0; for (float v : F.species) if (v > mx) mx = v;
        check(mx > 1.5f, "species block distinguishes M / X-top / X-bottom");
        run(s, 40);
        const Frame F2 = readFrame(s);
        double worst = 0;
        for (uint32_t k = 1; k < F2.nL; k++)
            worst = std::max(worst, std::fabs(meanZ(F2, k) - meanZ(F, k)));
        printf("      mote2 40 steps: worst layer drift %.4f A\n", worst);
        check(worst < 1.0, "MoTe2 stack stays put over 40 steps");
        api->destroy(s);
    }

    // ---- 7+8: protLoc change zeroes elevation; shape key lands ------------
    {
        void *s = api->create();
        say(s, "{\"t\":\"build\",\"Nnm\":5,\"Nsubnm\":5,\"nLayers\":1,"
               "\"material\":\"graphene\",\"engine\":\"classic\","
               "\"shape\":\"mesa\",\"targetDz\":4,\"liftRate\":0.05,"
               "\"holdSteps\":100000}");
        say(s, "{\"t\":\"elev\",\"on\":1}");
        run(s, 200);
        const double ez = jnum(say(s, "{\"t\":\"state\"}"), "elevz", 0);
        check(ez > 1.0, "mesa shape elevates (shape key reaches the core)");
        say(s, "{\"t\":\"params\",\"protLoc\":\"between\"}");
        const double ez2 = jnum(say(s, "{\"t\":\"state\"}"), "elevz", 99);
        check(ez2 == 0.0, "protLoc change zeroes the elevation state");
        api->destroy(s);
    }

    printf("\n%d checks, %d failed — %s\n", checks, fails,
           fails ? "SEE ABOVE" : "ALL CLEAR");
    return fails ? 1 : 0;
}
