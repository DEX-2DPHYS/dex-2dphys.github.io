// Gray–Scott reaction–diffusion — a DSW example experiment.
//
// Demonstrates the shape of a native DEX core: a big field, an OpenMP-
// parallel update loop that runs as fast as the host lets it, RGBA frames
// streamed to a canvas, and a handful of JSON control messages.
//
// Model (Karl Sims discretization): two chemicals U and V on a torus,
//   u += (Du lap(u) - u v^2 + F (1 - u)) dt
//   v += (Dv lap(v) + u v^2 - (F + k) v) dt
// with a 3x3 Laplacian (center -1, edge 0.2, corner 0.05), dt = 1.

#include "../../../include/dex_plugin.h"
#include "../../../include/dex_msg.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

constexpr int W = 512, H = 512;
constexpr double DU = 1.0, DV = 0.5, DT = 1.0;

struct Instance {
    std::vector<float> u, v, u2, v2;
    std::vector<uint8_t> frame;
    double F = 0.0545, k = 0.062; // "coral"
    int steps_per_tick = 20;
    bool paused = false;
    long long steps_done = 0;
    double stats_clock = 0, steps_window = 0;
    std::deque<std::string> outbox;
    std::string handout; // storage for the poll_message return pointer

    Instance()
        : u((size_t)W * H), v((size_t)W * H), u2((size_t)W * H),
          v2((size_t)W * H), frame((size_t)W * H * 4) {
        reset();
    }

    void reset() {
        std::fill(u.begin(), u.end(), 1.0f);
        std::fill(v.begin(), v.end(), 0.0f);
        seed(0.5, 0.5, 0.04);
        steps_done = 0;
    }

    // Drop a square of chemical V at normalized coords.
    void seed(double nx, double ny, double nr) {
        int cx = (int)(nx * W), cy = (int)(ny * H), r = (int)(nr * W);
        for (int y = cy - r; y <= cy + r; y++)
            for (int x = cx - r; x <= cx + r; x++) {
                int xi = (x % W + W) % W, yi = (y % H + H) % H;
                v[(size_t)yi * W + xi] = 1.0f;
                u[(size_t)yi * W + xi] = 0.5f;
            }
    }

    void step() {
        const float f = (float)F, kk = (float)k;
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int y = 0; y < H; y++) {
            const int ym = (y - 1 + H) % H, yp = (y + 1) % H;
            const float *uy = &u[(size_t)y * W], *uym = &u[(size_t)ym * W],
                        *uyp = &u[(size_t)yp * W];
            const float *vy = &v[(size_t)y * W], *vym = &v[(size_t)ym * W],
                        *vyp = &v[(size_t)yp * W];
            float *ou = &u2[(size_t)y * W], *ov = &v2[(size_t)y * W];
            for (int x = 0; x < W; x++) {
                const int xm = (x - 1 + W) % W, xp = (x + 1) % W;
                const float lu = 0.2f * (uy[xm] + uy[xp] + uym[x] + uyp[x]) +
                                 0.05f * (uym[xm] + uym[xp] + uyp[xm] + uyp[xp]) -
                                 uy[x];
                const float lv = 0.2f * (vy[xm] + vy[xp] + vym[x] + vyp[x]) +
                                 0.05f * (vym[xm] + vym[xp] + vyp[xm] + vyp[xp]) -
                                 vy[x];
                const float uvv = uy[x] * vy[x] * vy[x];
                ou[x] = uy[x] + (float)DT * ((float)DU * lu - uvv + f * (1.0f - uy[x]));
                ov[x] = vy[x] + (float)DT * ((float)DV * lv + uvv - (f + kk) * vy[x]);
            }
        }
        u.swap(u2);
        v.swap(v2);
        steps_done++;
        steps_window++;
    }

    void paint() {
        // V concentration through a deep-sea palette: dark navy -> teal -> white.
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int i = 0; i < W * H; i++) {
            float t = v[i] * 2.5f; // typical V tops out near 0.4
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            float r, g, b;
            if (t < 0.5f) {
                float s = t * 2.0f;
                r = 10 + s * (20 - 10);
                g = 14 + s * (150 - 14);
                b = 40 + s * (170 - 40);
            } else {
                float s = (t - 0.5f) * 2.0f;
                r = 20 + s * (245 - 20);
                g = 150 + s * (252 - 150);
                b = 170 + s * (255 - 170);
            }
            uint8_t *px = &frame[(size_t)i * 4];
            px[0] = (uint8_t)r;
            px[1] = (uint8_t)g;
            px[2] = (uint8_t)b;
            px[3] = 255;
        }
    }
};

void handle(Instance *s, const std::string &m) {
    std::string t = dexmsg::type_of(m);
    if (t == "set") {
        std::string key = dexmsg::get_str(m, "k");
        double val = dexmsg::get_num(m, "v");
        if (key == "F") s->F = val;
        else if (key == "k") s->k = val;
        else if (key == "speed") s->steps_per_tick = (int)val;
    } else if (t == "brush") {
        s->seed(dexmsg::get_num(m, "x", 0.5), dexmsg::get_num(m, "y", 0.5),
                dexmsg::get_num(m, "r", 0.02));
    } else if (t == "reset") s->reset();
    else if (t == "pause") s->paused = true;
    else if (t == "resume") s->paused = false;
}

// ---------------------------------------------------------------- ABI

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

int advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    if (s->paused) return 0;

    // Run the requested number of steps, but never hog more than ~10 ms so
    // control messages and frame requests stay snappy.
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < s->steps_per_tick; i++) {
        s->step();
        if (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0)
                .count() > 0.010)
            break;
    }

    s->stats_clock += dt;
    if (s->stats_clock >= 0.5) {
        char buf[160];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"stats\",\"steps\":%lld,\"sps\":%.0f}",
                 s->steps_done, s->steps_window / s->stats_clock);
        s->outbox.push_back(buf);
        s->stats_clock = 0;
        s->steps_window = 0;
    }
    return 1;
}

void on_message(void *p, const char *json, size_t len) {
    handle((Instance *)p, std::string(json, len));
}

const char *poll_message(void *p) {
    Instance *s = (Instance *)p;
    if (s->outbox.empty()) return nullptr;
    s->handout = std::move(s->outbox.front());
    s->outbox.pop_front();
    return s->handout.c_str();
}

int render(void *p, dex_frame *out) {
    Instance *s = (Instance *)p;
    s->paint();
    out->width = W;
    out->height = H;
    out->rgba = s->frame.data();
    return 1;
}

const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "gray-scott",
    "Gray–Scott Reaction–Diffusion",
    "1.0",
    create, destroy, advance, on_message, poll_message, render,
};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) {
    return &API;
}
