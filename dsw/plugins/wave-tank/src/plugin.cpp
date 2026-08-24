// Wave Tank — a DSW example experiment.
//
// Damped 2D wave equation on a rectangular pool with optional barrier
// walls (single / double slit). Click pokes the surface; an oscillating
// source drives plane-ish waves for interference experiments.
//
//   u_next = 2u - u_prev + c2 * lap(u),  then multiplied by (1 - damping)
//
// Stability (CFL): c2 <= 0.5 on this 5-point stencil.

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

constexpr int W = 560, H = 360;

struct Instance {
    std::vector<float> u, up, un;  // now, previous, next
    std::vector<float> sponge;     // absorbing "beach" along the pool edges
    std::vector<uint8_t> wall;     // 1 = rigid barrier
    std::vector<uint8_t> frame;
    double c2 = 0.25;
    double damping = 0.002;
    int steps_per_tick = 4;
    bool paused = false;
    bool src_on = false;
    double src_x = 0.12, src_y = 0.5, src_freq = 3.0; // Hz-ish (per sim-second)
    double sim_time = 0;
    long long steps_done = 0;
    double stats_clock = 0, steps_window = 0;
    std::deque<std::string> outbox;
    std::string handout;

    Instance()
        : u((size_t)W * H), up((size_t)W * H), un((size_t)W * H),
          sponge((size_t)W * H), wall((size_t)W * H),
          frame((size_t)W * H * 4) {
        // Absorbing boundary: damping ramps up over the outer 28 cells so
        // waves die on the shore instead of reflecting back into the tank.
        const int B = 28;
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++) {
                int d = std::min(std::min(x, W - 1 - x), std::min(y, H - 1 - y));
                float s = 1.0f;
                if (d < B) {
                    float t = 1.0f - (float)d / B;
                    s = 1.0f - 0.08f * t * t;
                }
                sponge[(size_t)y * W + x] = s;
            }
        set_barrier("double");
        src_on = true;
    }

    void reset_field() {
        std::fill(u.begin(), u.end(), 0.0f);
        std::fill(up.begin(), up.end(), 0.0f);
        sim_time = 0;
        steps_done = 0;
    }

    void set_barrier(const std::string &name) {
        std::fill(wall.begin(), wall.end(), 0);
        reset_field();
        if (name == "none") return;
        const int bx = W * 45 / 100;            // barrier column
        const int thick = 3;
        const int gap = H / 20;                 // slit half-height
        auto solid = [&](int y) {
            if (name == "single") return std::abs(y - H / 2) > gap;
            // double slit: openings centred at 3/8 and 5/8 of the height
            return std::abs(y - (H * 3) / 8) > gap &&
                   std::abs(y - (H * 5) / 8) > gap;
        };
        for (int y = 0; y < H; y++)
            if (solid(y))
                for (int x = bx; x < bx + thick; x++)
                    wall[(size_t)y * W + x] = 1;
    }

    void poke(double nx, double ny, double amp) {
        int cx = (int)(nx * W), cy = (int)(ny * H);
        const int r = 6;
        for (int y = cy - r; y <= cy + r; y++)
            for (int x = cx - r; x <= cx + r; x++) {
                if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
                double d2 = (double)((x - cx) * (x - cx) + (y - cy) * (y - cy));
                u[(size_t)y * W + x] += (float)(amp * std::exp(-d2 / 8.0));
            }
    }

    void step() {
        const float cc = (float)c2, keep = (float)(1.0 - damping);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int y = 1; y < H - 1; y++) {
            const float *cy0 = &u[(size_t)y * W];
            const float *cym = &u[(size_t)(y - 1) * W];
            const float *cyp = &u[(size_t)(y + 1) * W];
            const float *py = &up[(size_t)y * W];
            const float *sy = &sponge[(size_t)y * W];
            const uint8_t *wy = &wall[(size_t)y * W];
            float *ny = &un[(size_t)y * W];
            for (int x = 1; x < W - 1; x++) {
                if (wy[x]) { ny[x] = 0; continue; }
                float lap = cy0[x - 1] + cy0[x + 1] + cym[x] + cyp[x] -
                            4.0f * cy0[x];
                ny[x] = (2.0f * cy0[x] - py[x] + cc * lap) * keep * sy[x];
            }
            ny[0] = ny[W - 1] = 0;
        }
        up.swap(u);
        u.swap(un);

        if (src_on) {
            // Drive a small disk, not one pixel — a point source this tight
            // couples badly to the grid and the waves come out faint.
            const float drive =
                (float)std::sin(2.0 * M_PI * src_freq * sim_time) * 2.0f;
            const int sx = (int)(src_x * W), sy = (int)(src_y * H), r = 3;
            for (int y = sy - r; y <= sy + r; y++)
                for (int x = sx - r; x <= sx + r; x++) {
                    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
                    if ((x - sx) * (x - sx) + (y - sy) * (y - sy) > r * r)
                        continue;
                    u[(size_t)y * W + x] = drive;
                }
        }
        sim_time += 1.0 / 60.0; // one sim step = 1/60 "sim second"
        steps_done++;
        steps_window++;
    }

    void paint() {
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int i = 0; i < W * H; i++) {
            uint8_t *px = &frame[(size_t)i * 4];
            if (wall[i]) { px[0] = 200; px[1] = 205; px[2] = 215; px[3] = 255; continue; }
            float t = u[i] * 3.0f; // display gain: spreading dims 2D waves fast
            if (t > 1) t = 1;
            if (t < -1) t = -1;
            // diverging: deep blue (trough) -> near-black rest -> amber (crest)
            float r, g, b;
            if (t >= 0) {
                r = 12 + t * (255 - 12);
                g = 16 + t * (176 - 16);
                b = 30 + t * (56 - 30);
            } else {
                r = 12 + (-t) * (40 - 12);
                g = 16 + (-t) * (110 - 16);
                b = 30 + (-t) * (255 - 30);
            }
            px[0] = (uint8_t)r; px[1] = (uint8_t)g; px[2] = (uint8_t)b; px[3] = 255;
        }
    }
};

void handle(Instance *s, const std::string &m) {
    std::string t = dexmsg::type_of(m);
    if (t == "set") {
        std::string key = dexmsg::get_str(m, "k");
        double val = dexmsg::get_num(m, "v");
        if (key == "c2") s->c2 = std::min(0.5, std::max(0.01, val));
        else if (key == "damp") s->damping = val;
        else if (key == "speed") s->steps_per_tick = (int)val;
        else if (key == "freq") s->src_freq = val;
    } else if (t == "poke") {
        s->poke(dexmsg::get_num(m, "x", 0.5), dexmsg::get_num(m, "y", 0.5), 3.0);
    } else if (t == "src") {
        s->src_on = dexmsg::get_num(m, "on", 0) != 0;
        double x = dexmsg::get_num(m, "x", -1), y = dexmsg::get_num(m, "y", -1);
        if (x >= 0) s->src_x = x;
        if (y >= 0) s->src_y = y;
    } else if (t == "barrier") s->set_barrier(dexmsg::get_str(m, "name"));
    else if (t == "reset") s->reset_field();
    else if (t == "pause") s->paused = true;
    else if (t == "resume") s->paused = false;
}

// ---------------------------------------------------------------- ABI

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

int advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    if (s->paused) return 0;
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
    "wave-tank",
    "Wave Tank",
    "1.0",
    create, destroy, advance, on_message, poll_message, render,
};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) {
    return &API;
}
