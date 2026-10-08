#include "dex_plugin.h"
#include "dex_msg.h"

#include <windows.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

static void check(bool ok, const std::string &what) {
    std::cout << (ok ? "[ OK ] " : "[FAIL] ") << what << '\n';
    if (!ok) std::exit(2);
}

int main(int argc, char **argv) {
    check(argc > 1, "DLL path supplied");
    HMODULE dll = LoadLibraryA(argv[1]);
    check(dll != nullptr, "DLL loads");
    auto entry = reinterpret_cast<dex_plugin_entry_fn>(GetProcAddress(dll, "dex_plugin_entry"));
    check(entry != nullptr, "entry point resolves");
    const dex_plugin_api *api = entry();
    check(api && api->abi_version == DEX_ABI_VERSION && std::string(api->id) == "transim", "ABI and id match");
    void *inst = api->create();
    check(inst != nullptr, "instance creates");
    dex_frame initial{};
    check(api->render(inst, &initial) == 1 && initial.rgba && initial.width == 960, "initial frame memory is readable");

    auto send = [&](const std::string &m) { api->on_message(inst, m.c_str(), m.size()); };
    auto run = [&](const std::string &mode) {
        send("{\"t\":\"run\",\"mode\":\"" + mode + "\"}");
        std::vector<std::string> msgs;
        const auto t0 = std::chrono::steady_clock::now();
        for (int guard = 0; guard < 10000; ++guard) {
            const int work = api->advance(inst, 0.004);
            while (const char *m = api->poll_message(inst)) msgs.emplace_back(m);
            if (!work) break;
        }
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        std::cout << "       " << mode << " wall time " << ms << " ms\n";
        return msgs;
    };
    while (api->poll_message(inst)) {}
    send("{\"t\":\"configure\",\"W_um\":4,\"H_um\":2,\"n_cm2\":1e12,\"mu_cm\":50000,\"B\":0,\"mfpFromMobility\":1,\"Vsource\":0.001,\"Vdrain\":0,\"res\":64,\"nTraj\":1200,\"seed\":7,\"femIter\":4000,\"femTol\":1e-7,\"maxSteps\":8000,\"maxPath_um\":80,\"threads\":0,\"scattering\":\"isotropic\",\"edge\":\"specular\"}");
    while (api->poll_message(inst)) {}

    auto fm = run("fem");
    auto fi = std::find_if(fm.begin(), fm.end(), [](const std::string &m){ return dexmsg::type_of(m) == "fem"; });
    check(fi != fm.end(), "FEM result returned");
    check(dexmsg::get_num(*fi, "converged", 0) == 1, "FEM converges");
    check(dexmsg::get_num(*fi, "G", 0) > 0, "FEM conductance is positive");
    check(dexmsg::get_num(*fi, "residual", 1) < 5e-6, "FEM residual is small");

    dex_frame frame{};
    std::cerr << "probe before render " << &frame << '\n';
    check(api->render(inst, &frame) == 1 && frame.width == 960 && frame.height == 540 && frame.rgba, "16:9 frame renders");
    std::cerr << "probe after render " << static_cast<const void *>(frame.rgba) << ' ' << frame.width << 'x' << frame.height << '\n';
    int different = 0;
    for (size_t i = 4; i < static_cast<size_t>(frame.width) * frame.height * 4; i += 4)
        if (frame.rgba[i] != frame.rgba[0] || frame.rgba[i+1] != frame.rgba[1] || frame.rgba[i+2] != frame.rgba[2]) { different++; if (different > 1000) break; }
    check(different > 1000, "rendered frame contains device data");

    send("{\"t\":\"configure\",\"scattering\":\"none\",\"B\":0,\"nTraj\":1200}");
    while (api->poll_message(inst)) {}
    auto tm1 = run("ballistic");
    auto ti1 = std::find_if(tm1.begin(), tm1.end(), [](const std::string &m){ return dexmsg::type_of(m) == "traj"; });
    check(ti1 != tm1.end(), "trajectory result returned");
    const double trans1 = dexmsg::get_num(*ti1, "transmitted", -1);
    check(trans1 > 0, "ballistic carriers reach terminals");

    auto tm2 = run("ballistic");
    auto ti2 = std::find_if(tm2.begin(), tm2.end(), [](const std::string &m){ return dexmsg::type_of(m) == "traj"; });
    check(ti2 != tm2.end() && dexmsg::get_num(*ti2, "transmitted", -2) == trans1, "fixed seed is deterministic across all threads");

    send("{\"t\":\"configure\",\"scattering\":\"isotropic\",\"mfpFromMobility\":0,\"mfp_um\":0.05,\"nTraj\":300,\"maxPath_um\":15}");
    while (api->poll_message(inst)) {}
    auto qm = run("quasi");
    auto qi = std::find_if(qm.begin(), qm.end(), [](const std::string &m){ return dexmsg::type_of(m) == "traj"; });
    check(qi != qm.end() && dexmsg::get_num(*qi, "meanScatters", 0) > 5, "adaptive short-mfp run resolves multiple scattering events");

    send("{\"t\":\"sweep\",\"sweepType\":\"b\",\"bFrom\":-0.2,\"bTo\":0.2,\"bN\":5,\"wantFem\":1,\"wantBal\":0,\"measure\":\"2t\",\"quantity\":\"G\"}");
    int points = 0; bool done = false;
    for (int guard = 0; guard < 1000; ++guard) {
        int work = api->advance(inst, .004);
        while (const char *m = api->poll_message(inst)) { std::string q(m); points += dexmsg::type_of(q) == "sweep_point"; done |= dexmsg::type_of(q) == "sweep_done"; }
        if (!work) break;
    }
    check(points == 5 && done, "progressive native sweep completes all points");
    api->destroy(inst);
    FreeLibrary(dll);
    std::cout << "\nALL TRANSIM PROBES CLEAR\n";
}
