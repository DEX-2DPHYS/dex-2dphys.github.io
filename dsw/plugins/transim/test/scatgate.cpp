// scatgate -- gates for the scattering / tracer upgrade (2026-10-06).
//
//   scatgate new.dll [base.dll]
//
// With a base (pre-upgrade) DLL it first proves the defaults are untouched:
// every configuration the old engine could express with isotropic or no bulk
// scattering and specular or absorbing edges must give the SAME counts,
// trajectory for trajectory.  Then it measures the new physics.
#include "dex_plugin.h"
#include "dex_msg.h"

#include <windows.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <regex>

static int fails = 0;
static void check(bool ok, const std::string &what) {
    std::printf("%s %s\n", ok ? "[ OK ]" : "[FAIL]", what.c_str());
    if (!ok) ++fails;
}

struct Core {
    const dex_plugin_api *api = nullptr; void *inst = nullptr;
    explicit Core(const char *path) {
        HMODULE dll = LoadLibraryA(path);
        if (!dll) { std::printf("cannot load %s\n", path); std::exit(3); }
        auto entry = reinterpret_cast<dex_plugin_entry_fn>(GetProcAddress(dll, "dex_plugin_entry"));
        api = entry(); inst = api->create(); drain();
    }
    void send(const std::string &m) { api->on_message(inst, m.c_str(), m.size()); }
    void drain() { while (api->poll_message(inst)) {} }
    std::vector<std::string> run(const std::string &mode, double *ms = nullptr) {
        send("{\"t\":\"run\",\"mode\":\"" + mode + "\"}");
        std::vector<std::string> out;
        const auto t0 = std::chrono::steady_clock::now();
        for (int g = 0; g < 200000; ++g) {
            const int w = api->advance(inst, 0.004);
            while (const char *m = api->poll_message(inst)) out.emplace_back(m);
            if (!w) break;
        }
        if (ms) *ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        return out;
    }
    std::string last(const std::vector<std::string> &v, const std::string &type) {
        for (auto it = v.rbegin(); it != v.rend(); ++it) if (dexmsg::type_of(*it) == type) return *it;
        return {};
    }
    std::string derived() {
        send("{\"t\":\"hello\"}");
        std::string d;
        while (const char *m = api->poll_message(inst)) { std::string q(m); if (dexmsg::type_of(q) == "derived") d = q; }
        return d;
    }
};

// The comparable part of a traj message: counts and the transmission table,
// without timing or the new fields.
static std::string core(const std::string &m) {
    std::string out;
    for (const char *k : {"\"n\":", "\"meanPath_um\":", "\"meanScatters\":", "\"statuses\":", "\"transmission\":"}) {
        const size_t a = m.find(k); if (a == std::string::npos) { out += "?"; continue; }
        size_t b = a + std::strlen(k);
        int depth = 0; size_t e = b;
        for (; e < m.size(); ++e) {
            const char c = m[e];
            if (c == '{' || c == '[') ++depth;
            else if (c == '}' || c == ']') { if (depth == 0) break; --depth; if (depth == 0) { ++e; break; } }
            else if (c == ',' && depth == 0) break;
        }
        out += std::string(k) + m.substr(b, e - b) + ";";
    }
    // the counting statistics added 2026-10-08 (hits, N, dT) are new fields, not new numbers:
    // the comparison is of what the old engine reported
    out = std::regex_replace(out, std::regex(R"re(,"hits":[0-9]+,"N":[0-9]+,"dT":[-+0-9.eE]+)re"), "");
    // single runs no longer list source -> probe rows (zero by construction, 2026-10-08):
    // compare only the rows that carry a transmission
    out = std::regex_replace(out, std::regex(R"re(\{"source":"[^"]*","target":"[^"]*","T":0,"G":0\})re"), "");
    out = std::regex_replace(out, std::regex(R"re(,,+)re"), ",");
    out = std::regex_replace(out, std::regex(R"re(\[,)re"), "[");
    out = std::regex_replace(out, std::regex(R"re(,\])re"), "]");
    return out;
}

// T(source -> drain) from a traj message
static double Tsd(const std::string &m) {
    const std::string key = "\"source\":\"source\",\"target\":\"drain\",\"T\":";
    const size_t a = m.find(key); if (a == std::string::npos) return -1;
    return std::atof(m.c_str() + a + key.size());
}

static const char *BASECFG = "\"W_um\":4,\"H_um\":2,\"n_cm2\":1e12,\"mu_cm\":50000,\"Vsource\":0.001,\"Vdrain\":0,"
    "\"res\":64,\"seed\":7,\"femIter\":4000,\"femTol\":1e-7,\"maxSteps\":8000,\"threads\":0";

int main(int argc, char **argv) {
    if (argc < 2) { std::printf("usage: scatgate new.dll [base.dll]\n"); return 2; }
    Core nw(argv[1]);

    // ------------------------------------------------ 1. defaults reproduce the old engine
    if (argc > 2) {
        Core old(argv[2]);
        struct Case { const char *name, *cfg, *mode, *preset; };
        const Case cases[] = {
            {"isotropic, mobility, specular, B=0",       "\"B\":0,\"mfpFromMobility\":1,\"scattering\":\"isotropic\",\"edge\":\"specular\",\"nTraj\":3000,\"maxPath_um\":80", "quasi", "hall_bar"},
            {"isotropic, mobility, specular, B=0.3 T",   "\"B\":0.3,\"mfpFromMobility\":1,\"scattering\":\"isotropic\",\"edge\":\"specular\",\"nTraj\":3000,\"maxPath_um\":80", "quasi", "hall_bar"},
            {"isotropic, l=0.05 um, absorbing edges",    "\"B\":-0.5,\"mfpFromMobility\":0,\"mfp_um\":0.05,\"scattering\":\"isotropic\",\"edge\":\"absorbing\",\"nTraj\":1500,\"maxPath_um\":40", "quasi", "four_probe"},
            {"ballistic, B=1 T, specular",                "\"B\":1,\"mfpFromMobility\":1,\"scattering\":\"isotropic\",\"edge\":\"specular\",\"nTraj\":3000,\"maxPath_um\":80", "ballistic", "hall_cross"},
            {"none, two-terminal, B=0.1 T",               "\"B\":0.1,\"mfpFromMobility\":1,\"scattering\":\"none\",\"edge\":\"specular\",\"nTraj\":3000,\"maxPath_um\":80", "quasi", "two_terminal"},
        };
        for (const Case &c : cases) {
            for (Core *k : {&old, &nw}) {
                k->send(std::string("{\"t\":\"preset\",\"name\":\"") + c.preset + "\"}");
                // seedMix:0 / pathAuto:0: the old seed mixing and fixed path budget (2026-10-08 changed both on purpose)
                k->send(std::string("{\"t\":\"configure\",") + BASECFG + "," + c.cfg + ",\"seedMix\":0,\"pathAuto\":0}");
                k->drain();
            }
            const std::string a = core(old.last(old.run(c.mode), "traj"));
            const std::string b = core(nw.last(nw.run(c.mode), "traj"));
            check(a == b && a.find('?') == std::string::npos, std::string("identical to the old engine: ") + c.name);
            if (a != b) std::printf("   old %s\n   new %s\n", a.c_str(), b.c_str());
        }
        // FEM untouched with phonons off
        for (Core *k : {&old, &nw}) { k->send("{\"t\":\"preset\",\"name\":\"hall_bar\"}"); k->send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"B\":0.4}"); k->drain(); }
        const std::string fa = old.last(old.run("fem"), "fem"), fb = nw.last(nw.run("fem"), "fem");
        check(dexmsg::get_num(fa, "R", 0) == dexmsg::get_num(fb, "R", 1), "FEM identical with phonons off");
    }

    // ------------------------------------------------ 2. partial edges at p = 1 are specular
    {
        auto runEdge = [&](const char *edge) {
            nw.send("{\"t\":\"preset\",\"name\":\"hall_bar\"}");
            nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"B\":0.3,\"mfpFromMobility\":1,\"scattering\":\"isotropic\",\"specularity\":1,\"edge\":\"" + edge + "\",\"nTraj\":2000,\"maxPath_um\":80}");
            nw.drain(); return core(nw.last(nw.run("quasi"), "traj"));
        };
        check(runEdge("partial") == runEdge("specular"), "partial edge with specularity 1 == specular, trajectory for trajectory");
    }

    // ------------------------------------------------ 3. mobility means the same thing for every angular law
    // Drude: in the diffusive limit the conductance depends only on the TRANSPORT length.
    // 12 x 2 um two-terminal bar, l_tr = 0.12 um (L/l_tr = 100).
    {
        auto T = [&](const std::string &extra) {
            nw.send("{\"t\":\"preset\",\"name\":\"two_terminal\"}");
            nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"W_um\":12,\"H_um\":2,\"B\":0,\"mfpFromMobility\":0,\"mfp_um\":0.12,\"edge\":\"specular\",\"nTraj\":20000,\"maxPath_um\":400,\"maxSteps\":2000000," + extra + "}");
            nw.drain(); return Tsd(nw.last(nw.run("quasi"), "traj"));
        };
        const double ti = T("\"scattering\":\"isotropic\"");
        const double tg = T("\"scattering\":\"gaussian\",\"fwdSigmaDeg\":20");
        const double tf = T("\"scattering\":\"forward\"");
        const double ts = T("\"scattering\":\"smallangle\"");
        std::printf("   T(iso) %.4f  T(gauss 20 deg) %.4f  T(forward) %.4f  T(smallangle) %.4f\n", ti, tg, tf, ts);
        check(ti > 0 && std::abs(tg / ti - 1) < 0.15, "gaussian 20 deg at the same l_tr gives the isotropic Drude transmission (within 15 %)");
        check(ti > 0 && std::abs(tf / ti - 1) < 0.15, "forward (legacy law) at the same l_tr gives the isotropic transmission");
        check(ti > 0 && std::abs(ts / ti - 1) < 0.20, "small-angle (legacy law) at the same l_tr gives the isotropic transmission");
    }

    // ------------------------------------------------ 4. phonons
    {
        nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"mfpFromMobility\":0,\"mfp_um\":1,\"phMfp300_um\":2,\"tempK\":150}");
        const std::string d = nw.derived();
        // 2026-10-08 law: l_ph = l300 * sqrt(n_ref/n) * rho(300)/rho(T), rho(T) ~ T^4/(T^3 + T_BG^3)
        auto f = [](double T, double tb) { return T * T * T * T / (T * T * T + tb * tb * tb); };
        auto TBG = [](double ncm2) { return 2 * 1.0545718e-34 * 2.1e4 * std::sqrt(3.14159265358979 * ncm2 * 1e4) / 1.380649e-23; };
        const double lph150 = 2 * f(300, TBG(1e12)) / f(150, TBG(1e12));
        std::printf("   l_ph(150 K, 1e12) %.4f um (expected %.4f; high-T limit 4)\n", dexmsg::get_num(d, "mfpPh_um", 0), lph150);
        check(std::abs(dexmsg::get_num(d, "mfpPh_um", 0) - lph150) < 1e-6, "l_ph(T) follows rho ~ T above T_BG (4 um at 150 K within 2 %)");
        check(std::abs(lph150 / 4 - 1) < 0.06, "  ... within 6 % of the 300/T law at 150 K (T_BG = 57 K, so the T^4 tail still shows)");
        check(std::abs(dexmsg::get_num(d, "mfp_um", 0) - 1.0 / (1.0 + 1.0 / lph150)) < 1e-6, "Matthiessen: 1 um impurity + phonon");
        // graphene's phonon resistivity does not depend on density: l_ph ~ 1/kF
        nw.send("{\"t\":\"configure\",\"n_cm2\":4e12,\"tempK\":300}");
        const double l4 = dexmsg::get_num(nw.derived(), "mfpPh_um", 0);
        nw.send("{\"t\":\"configure\",\"n_cm2\":1e12,\"tempK\":300}");
        const double l1 = dexmsg::get_num(nw.derived(), "mfpPh_um", 0);
        std::printf("   l_ph(300 K): %.4f um at 1e12, %.4f um at 4e12 -> rho ratio %.4f\n", l1, l4, (1 / (2 * l4)) / (1 / (1 * l1)));
        check(std::abs(l4 / l1 - 0.5) < 0.02, "l_ph halves when n quadruples, so rho_ph = 1/(kF l) is density-independent");
        // Bloch-Gruneisen: well below T_BG (57 K at 1e12) rho ~ T^4
        nw.send("{\"t\":\"configure\",\"tempK\":10}"); const double a10 = dexmsg::get_num(nw.derived(), "mfpPh_um", 0);
        nw.send("{\"t\":\"configure\",\"tempK\":5}");  const double a5 = dexmsg::get_num(nw.derived(), "mfpPh_um", 0);
        std::printf("   l_ph(5 K)/l_ph(10 K) = %.2f (T^4 law: 16)\n", a5 / a10);
        check(a5 / a10 > 14 && a5 / a10 < 16.5, "Bloch-Gruneisen: l_ph ~ T^-4 well below T_BG");
        nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"mfpFromMobility\":0,\"mfp_um\":1,\"phMfp300_um\":2,\"tempK\":150}");
        // a phonon-only run matches an impurity-only run of the same length (both isotropic)
        auto T = [&](const std::string &extra) {
            nw.send("{\"t\":\"preset\",\"name\":\"two_terminal\"}");
            nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"W_um\":6,\"H_um\":2,\"B\":0,\"edge\":\"specular\",\"nTraj\":20000,\"maxPath_um\":300,\"maxSteps\":2000000," + extra + "}");
            nw.drain(); return Tsd(nw.last(nw.run("quasi"), "traj"));
        };
        const double timp = T("\"scattering\":\"isotropic\",\"mfpFromMobility\":0,\"mfp_um\":0.3,\"phMfp300_um\":0");
        const double tph = T("\"scattering\":\"none\",\"phMfp300_um\":0.6,\"tempK\":600");
        std::printf("   T(impurity 0.3 um) %.4f  T(phonon 0.3 um at 600 K) %.4f\n", timp, tph);
        check(std::abs(tph / timp - 1) < 0.06, "a phonon channel of the same length scatters like an isotropic impurity channel");
        // FEM sees the phonons
        nw.send("{\"t\":\"preset\",\"name\":\"two_terminal\"}");
        nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"B\":0,\"phMfp300_um\":0}"); nw.drain();
        const double r0 = dexmsg::get_num(nw.last(nw.run("fem"), "fem"), "R", 0);
        nw.send("{\"t\":\"configure\",\"phMfp300_um\":1,\"tempK\":300}"); nw.drain();
        const double r1 = dexmsg::get_num(nw.last(nw.run("fem"), "fem"), "R", 0);
        // mu 50000 cm2/Vs at 1e12: l_imp = 0.584 um ; with a 1 um phonon length R scales by (1/0.584+1)/(1/0.584)
        const double limp = 1.0545718e-34 * 5.0 * std::sqrt(3.14159265358979 * 1e16) / 1.602176634e-19;
        const double want = (1 / limp + 1 / 1e-6) / (1 / limp);
        std::printf("   FEM R %.3f -> %.3f ohm, ratio %.4f (Matthiessen %.4f)\n", r0, r1, r1 / r0, want);
        check(std::abs(r1 / r0 / want - 1) < 0.01, "FEM resistance rises by the Matthiessen factor when phonons are on");
        nw.send("{\"t\":\"configure\",\"phMfp300_um\":0}"); nw.drain();
    }

    // ------------------------------------------------ 5. exact arcs agree with the stepped tracer
    {
        auto runT = [&](const char *tracer, const char *cfg, const char *mode, double *ms, std::string *msg) {
            nw.send("{\"t\":\"preset\",\"name\":\"hall_bar\"}");
            nw.send(std::string("{\"t\":\"configure\",") + BASECFG + "," + cfg + ",\"tracer\":\"" + tracer + "\"}");
            nw.drain(); *msg = nw.last(nw.run(mode, ms), "traj");
            return *msg;
        };
        struct Case { const char *name, *cfg, *mode; };
        const Case cases[] = {
            {"ballistic, B = 0.4 T", "\"B\":0.4,\"scattering\":\"isotropic\",\"edge\":\"specular\",\"nTraj\":40000,\"maxPath_um\":80", "ballistic"},
            {"isotropic l = 0.58 um, B = 0.2 T", "\"B\":0.2,\"mfpFromMobility\":1,\"scattering\":\"isotropic\",\"edge\":\"specular\",\"nTraj\":40000,\"maxPath_um\":80", "quasi"},
            {"gaussian 15 deg, diffuse edges, B = -0.3 T", "\"B\":-0.3,\"mfpFromMobility\":1,\"scattering\":\"gaussian\",\"fwdSigmaDeg\":15,\"edge\":\"diffuse\",\"nTraj\":40000,\"maxPath_um\":80", "quasi"},
        };
        for (const Case &c : cases) {
            double ms1 = 0, ms2 = 0; std::string m1, m2;
            runT("step", c.cfg, c.mode, &ms1, &m1); runT("arc", c.cfg, c.mode, &ms2, &m2);
            const double n = dexmsg::get_num(m1, "n", 1);
            const double t1 = dexmsg::get_num(m1, "transmitted", 0) / n, t2 = dexmsg::get_num(m2, "transmitted", 0) / n;
            const double sig = std::sqrt(t1 * (1 - t1) / n) * std::sqrt(2.0);
            std::printf("   %s: step %.4f (%.0f ms)  arc %.4f (%.0f ms)  diff %.1f sigma\n", c.name, t1, ms1, t2, ms2, std::abs(t1 - t2) / sig);
            check(m2.find("\"tracer\":\"arc\"") != std::string::npos, std::string("arc tracer actually ran: ") + c.name);
            check(std::abs(t1 - t2) < 4 * sig + 2e-3, std::string("arc agrees with stepped: ") + c.name);
        }
        // with a density map the arc request falls back to the stepper and says so
        nw.send("{\"t\":\"map\",\"kind\":\"density\",\"w\":2,\"h\":1,\"data\":[1e12,1e12]}");
        std::string m; double ms = 0;
        runT("arc", "\"B\":0.2,\"nTraj\":500,\"maxPath_um\":40", "quasi", &ms, &m);
        check(m.find("\"tracer\":\"step\"") != std::string::npos, "a density map forces the stepped tracer");
        nw.send("{\"t\":\"clear_map\",\"kind\":\"density\"}"); nw.drain();
    }

    // ------------------------------------------------ 6. refraction: total internal reflection at a density step
    // 8 x 2 um, ballistic, specular walls, n 4e12 -> 1e12 across a smooth step at x = 4 um.
    // kF halves, so rays with sin(theta) > 1/2 are totally reflected; with Landauer
    // (cos-weighted) injection the transmitted fraction is exactly sin(30 deg) = 0.5.
    {
        std::string data = "[";
        const int w = 256;
        for (int i = 0; i < w; ++i) {
            const double xf = i / double(w - 1), xum = xf * 8.0;
            const double n = 2.5e12 - 1.5e12 * std::tanh((xum - 4.0) / 0.15);
            data += (i ? "," : "") + std::to_string(n);
        }
        data += "]";
        auto T = [&](int refract, const char *preset) {
            nw.send(std::string("{\"t\":\"preset\",\"name\":\"") + preset + "\"}");
            nw.send("{\"t\":\"map\",\"kind\":\"density\",\"w\":256,\"h\":1,\"data\":" + data + "}");
            nw.send(std::string("{\"t\":\"configure\",") + BASECFG + ",\"W_um\":8,\"H_um\":2,\"n_cm2\":2.5e12,\"B\":0,\"edge\":\"specular\",\"nTraj\":20000,\"maxPath_um\":200,\"tracer\":\"step\",\"refract\":" + std::to_string(refract) + "}");
            nw.drain(); return Tsd(nw.last(nw.run("ballistic"), "traj"));
        };
        const double off = T(0, "two_terminal"), on = T(1, "two_terminal");
        std::printf("   high -> low density: T = %.4f without refraction, %.4f with (theory 0.5)\n", off, on);
        check(off > 0.95, "without refraction the step is invisible (T ~ 1)");
        check(std::abs(on - 0.5) < 0.03, "with refraction the transmitted fraction is the critical-angle value 0.5");
        nw.send("{\"t\":\"clear_map\",\"kind\":\"density\"}"); nw.drain();
    }

    std::printf(fails ? "\n%d FAILURES\n" : "\nALL SCATTERING GATES CLEAR\n", fails);
    return fails ? 1 : 0;
}
