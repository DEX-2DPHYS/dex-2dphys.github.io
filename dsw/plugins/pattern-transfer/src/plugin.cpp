// EBL Pattern Transfer — a DSW experiment.
//
// Native port of the DEX pattern-transfer simulator's compute core: a 3D
// voxel grid (cross-section × depth slices) of materials, mutated by
// nanofabrication process steps — spin resist, expose (EBL/UV), develop
// with a contrast curve, directional/conformal deposition, RIE / wet / SF6
// etch, O2 descum, lift-off and strip. The browser UI sends steps as JSON;
// the core keeps the process flow and replays it from the bare substrate
// for undo / step deletion / reordering, and renders either the 2D
// cross-section or a painter-sorted isometric 3D view as RGBA frames.

#include "../../../include/dex_plugin.h"
#include "../../../include/dex_msg.h"

#include <algorithm>
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

// ---------------------------------------------------------------- materials

enum Mat : uint8_t {
    AIR = 0, RESIST, RESIST_EXP, METAL, POLYSI, SIO2, SI3N4, SI,
    PMMA, PMMA_EXP, CSAR, CSAR_EXP, MEDUSA, MEDUSA_EXP,
    S1813, S1813_EXP, AZ5214E, AZ5214E_EXP, SU8, SU8_EXP,
    MAN2400, MAN2400_EXP, GRAPHENE, MOS2, HBN, MAT_COUNT
};

const uint8_t MAT_COLOR[MAT_COUNT][3] = {
    {255, 255, 255}, {255, 170, 195}, {255, 120, 160}, {180, 190, 210},
    {160, 140, 120}, {140, 210, 245}, {180, 230, 180}, {70, 80, 95},
    {255, 190, 160}, {235, 130, 100}, {200, 175, 240}, {155, 120, 210},
    {150, 225, 210}, {95, 185, 170},  {255, 236, 153}, {234, 196, 72},
    {255, 214, 170}, {239, 161, 95},  {198, 255, 184}, {119, 209, 100},
    {174, 235, 214}, {103, 197, 173}, {128, 128, 128}, {245, 220, 80},
    {110, 165, 255},
};

// The enum interleaves METAL..SI at 3..7 between the generic and named
// resists, so resist checks must skip that gap.
bool isResist(uint8_t m) {
    return m == RESIST || m == RESIST_EXP || (m >= PMMA && m <= MAN2400_EXP);
}
bool isResistUnexp(uint8_t m) {
    return m == RESIST || (m >= PMMA && m <= MAN2400_EXP && (m - PMMA) % 2 == 0);
}
uint8_t toExposed(uint8_t m) { return isResistUnexp(m) ? (uint8_t)(m + 1) : m; }
bool is2DFlake(uint8_t m) { return m == GRAPHENE || m == MOS2 || m == HBN; }
float matAlpha(uint8_t m) { return isResist(m) ? 0.64f : (m == SIO2 ? 0.58f : 1.0f); }

uint8_t matFromName(const std::string &n, uint8_t fallback) {
    if (n == "METAL") return METAL;
    if (n == "POLYSI") return POLYSI;
    if (n == "SIO2") return SIO2;
    if (n == "SI3N4") return SI3N4;
    if (n == "SI") return SI;
    if (n == "GRAPHENE") return GRAPHENE;
    if (n == "MOS2") return MOS2;
    if (n == "HBN") return HBN;
    return fallback;
}

uint8_t resistFromPreset(const std::string &n) {
    if (n == "PMMA") return PMMA;
    if (n == "CSAR") return CSAR;
    if (n == "MEDUSA") return MEDUSA;
    if (n == "S1813") return S1813;
    if (n == "AZ5214E") return AZ5214E;
    if (n == "SU8") return SU8;
    if (n == "MAN2400") return MAN2400;
    return RESIST; // "custom"
}

// ---------------------------------------------------------------- base64

const char B64C[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64encode(const uint8_t *p, size_t n) {
    std::string out;
    out.reserve((n + 2) / 3 * 4);
    for (size_t i = 0; i < n; i += 3) {
        uint32_t v = (uint32_t)p[i] << 16;
        if (i + 1 < n) v |= (uint32_t)p[i + 1] << 8;
        if (i + 2 < n) v |= p[i + 2];
        out += B64C[(v >> 18) & 63];
        out += B64C[(v >> 12) & 63];
        out += i + 1 < n ? B64C[(v >> 6) & 63] : '=';
        out += i + 2 < n ? B64C[v & 63] : '=';
    }
    return out;
}

std::vector<uint8_t> b64decode(const std::string &s) {
    static int8_t rev[256];
    static bool init = false;
    if (!init) {
        memset(rev, -1, sizeof rev);
        for (int i = 0; i < 64; i++) rev[(uint8_t)B64C[i]] = (int8_t)i;
        init = true;
    }
    std::vector<uint8_t> out;
    out.reserve(s.size() / 4 * 3);
    uint32_t v = 0;
    int bits = 0;
    for (char c : s) {
        int8_t d = rev[(uint8_t)c];
        if (d < 0) continue;
        v = (v << 6) | (uint32_t)d;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((uint8_t)(v >> bits));
        }
    }
    return out;
}

// ---------------------------------------------------------------- custom mask

// Shapes travel as "r,x,y,w,h,dose;c,x,y,w,h,dose;..." (nm units, dose absolute).
struct MaskShape {
    bool rect;
    double x, y, w, h, dose;
};

std::vector<MaskShape> parseShapes(const std::string &enc) {
    std::vector<MaskShape> out;
    size_t pos = 0;
    while (pos < enc.size()) {
        size_t end = enc.find(';', pos);
        if (end == std::string::npos) end = enc.size();
        std::string item = enc.substr(pos, end - pos);
        pos = end + 1;
        MaskShape s;
        double f[5];
        char kind;
        if (sscanf(item.c_str(), "%c,%lf,%lf,%lf,%lf,%lf", &kind, &f[0], &f[1],
                   &f[2], &f[3], &f[4]) == 6) {
            s.rect = kind != 'c';
            s.x = f[0]; s.y = f[1]; s.w = f[2]; s.h = f[3]; s.dose = f[4];
            out.push_back(s);
        }
    }
    return out;
}

// Grayscale dose image: values 0..255 = 0..fullDose, spanning the whole sample.
struct MaskImage {
    int w = 0, h = 0;
    double fullDose = 0;
    std::vector<uint8_t> v;
    bool ok() const { return w > 0 && h > 0 && (int)v.size() >= w * h; }
    double sample(double u, double vv) const { // u,v in [0,1], bilinear
        double x = std::max(0.0, std::min((double)w - 1, u * (w - 1)));
        double y = std::max(0.0, std::min((double)h - 1, vv * (h - 1)));
        int x0 = (int)x, y0 = (int)y;
        int x1 = std::min(w - 1, x0 + 1), y1 = std::min(h - 1, y0 + 1);
        double tx = x - x0, ty = y - y0;
        double a = v[(size_t)y0 * w + x0], b = v[(size_t)y0 * w + x1];
        double c = v[(size_t)y1 * w + x0], d = v[(size_t)y1 * w + x1];
        return ((a * (1 - tx) + b * tx) * (1 - ty) +
                (c * (1 - tx) + d * tx) * ty) / 255.0 * fullDose;
    }
};

// ---------------------------------------------------------------- instance

struct ResistState {
    std::string name; // preset name ("PMMA", ... or "custom")
    bool positive = true;
    uint8_t matId = RESIST, matExpId = RESIST_EXP;
    bool exposed = false;
    double resistThickNm = 120;
    std::vector<std::vector<float>> doseMaps; // per z slice, W entries
};

struct Instance {
    // grid
    int W = 0, H = 0, D = 0;
    double nmPx = 2.0, sampleDepthNm = 300;
    double sampWNm = 300, siNm = 200, oxNm = 80;
    std::vector<uint8_t> grid; // D * W * H, slice-major
    std::vector<ResistState> resists;
    std::vector<std::string> flow; // executed step messages, verbatim

    // view
    double slicePct = 50;
    bool isoView = false;
    double camAz = 38, camEl = 26, camZoom = 1.0;
    bool perspective = false;
    uint8_t bgR = 255, bgG = 255, bgB = 255; // theme background for frames
    std::vector<uint8_t> frame;
    uint32_t frameW = 0, frameH = 0;

    std::deque<std::string> outbox;
    std::string handout;

    Instance() { build(); }

    uint8_t *slice(int z) { return &grid[(size_t)z * W * H]; }
    size_t idx(int x, int y) const { return (size_t)y * W + x; }
    int displaySlice() const {
        return std::min(std::max(0, (int)lround(slicePct / 100 * (D - 1))), D - 1);
    }

    void say(const std::string &m) { outbox.push_back(m); }
    void sayErr(const std::string &msg, long q) {
        say("{\"t\":\"err\",\"q\":" + std::to_string(q) + ",\"msg\":\"" + msg + "\"}");
    }

    int globalTop(int z) {
        uint8_t *g = slice(z);
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
                if (g[idx(x, y)] != AIR) return y;
        return H;
    }

    void sayState(double stepMs, long q) {
        // First resist row per column of the display slice (for mask overlays).
        int z = displaySlice();
        uint8_t *g = slice(z);
        std::vector<int16_t> rtop(W, -1);
        for (int x = 0; x < W; x++)
            for (int y = 0; y < H; y++)
                if (isResist(g[idx(x, y)])) { rtop[x] = (int16_t)y; break; }
        char buf[360];
        snprintf(buf, sizeof buf,
                 "{\"t\":\"state\",\"q\":%ld,\"w\":%d,\"h\":%d,\"d\":%d,"
                 "\"nmpx\":%g,\"wnm\":%.0f,\"hnm\":%.0f,\"dnm\":%.0f,"
                 "\"steps\":%d,\"ms\":%.1f,\"top\":%d,\"top0\":%d,\"rtop\":\"",
                 q, W, H, D, nmPx, W * nmPx, H * nmPx, sampleDepthNm,
                 (int)flow.size(), stepMs, globalTop(z), globalTop(0));
        std::string msg(buf);
        msg += b64encode((const uint8_t *)rtop.data(), rtop.size() * 2);
        msg += "\"}";
        say(msg);
    }

    // ---------------------------------------------------------- substrate

    void build() {
        nmPx = std::max(0.2, nmPx);
        double pxPerNm = 1.0 / nmPx;
        int siPx = std::max(1, (int)lround(siNm * pxPerNm));
        int oxPx = std::max(0, (int)lround(oxNm * pxPerNm));
        int airPx = std::max(20, (int)lround(300 * pxPerNm));
        H = siPx + oxPx + airPx;
        W = std::max(10, (int)lround(sampWNm * pxPerNm));
        sampleDepthNm = std::max(20.0, sampleDepthNm);
        int depthPx = std::max(10, (int)lround(sampleDepthNm / nmPx));
        D = std::min(std::max(1, depthPx), 120);
        grid.assign((size_t)D * W * H, AIR);
        int siTop = H - siPx, oxTop = siTop - oxPx;
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            for (int y = oxTop; y < H; y++)
                for (int x = 0; x < W; x++)
                    g[idx(x, y)] = y >= siTop ? SI : SIO2;
        }
        resists.clear();
    }

    // First non-air y per column of one slice.
    std::vector<int> findSurface(int z) {
        std::vector<int> surf(W);
        uint8_t *g = slice(z);
        for (int x = 0; x < W; x++) {
            int y = 0;
            while (y < H && g[idx(x, y)] == AIR) y++;
            surf[x] = y;
        }
        return surf;
    }

    bool hasResist() {
        for (uint8_t m : grid)
            if (isResist(m)) return true;
        return false;
    }

    // ---------------------------------------------------------- steps

    void doDeposit(uint8_t matId, double thickNm, bool conformal) {
        int thickPx = std::max(1, (int)lround(thickNm / nmPx));
        if (!conformal) {
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
            for (int z = 0; z < D; z++) {
                uint8_t *g = slice(z);
                for (int x = 0; x < W; x++) {
                    int y = 0;
                    while (y < H && g[idx(x, y)] == AIR) y++;
                    for (int k = 0; k < thickPx; k++) {
                        int dy = y - 1 - k;
                        if (dy >= 0) g[idx(x, dy)] = matId;
                    }
                }
            }
        } else {
            std::vector<size_t> toFill;
            for (int layer = 0; layer < thickPx; layer++) {
                for (int z = 0; z < D; z++) {
                    uint8_t *g = slice(z);
                    toFill.clear();
                    for (int y = 0; y < H; y++)
                        for (int x = 0; x < W; x++) {
                            if (g[idx(x, y)] != AIR) continue;
                            bool nb = (x > 0 && g[idx(x - 1, y)] != AIR) ||
                                      (x < W - 1 && g[idx(x + 1, y)] != AIR) ||
                                      (y > 0 && g[idx(x, y - 1)] != AIR) ||
                                      (y < H - 1 && g[idx(x, y + 1)] != AIR);
                            if (nb) toFill.push_back(idx(x, y));
                        }
                    for (size_t i : toFill) g[i] = matId;
                }
            }
        }
    }

    void depositSquare(uint8_t matId, double sizeNm, int thickPx, double rotDeg) {
        double half = sizeNm * 0.5;
        double ang = rotDeg * M_PI / 180, ca = cos(ang), sa = sin(ang);
        double cxNm = W * nmPx * 0.5, czNm = sampleDepthNm * 0.5;
        for (int z = 0; z < D; z++) {
            double dz = (z + 0.5) * sampleDepthNm / D - czNm;
            auto surf = findSurface(z);
            uint8_t *g = slice(z);
            for (int x = 0; x < W; x++) {
                double dx = (x + 0.5) * nmPx - cxNm;
                double u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
                if (fabs(u) > half || fabs(v) > half) continue;
                for (int k = 0; k < thickPx; k++) {
                    int dy = surf[x] - 1 - k;
                    if (dy >= 0 && g[idx(x, dy)] == AIR) g[idx(x, dy)] = matId;
                }
            }
        }
    }

    void doTransfer2D(const std::string &material, double flakeNm, double layerNm) {
        int layerPx = std::max(1, (int)lround(layerNm / nmPx));
        if (material == "GRAPHENE") { depositSquare(GRAPHENE, flakeNm, layerPx, 0); return; }
        if (material == "MOS2") { depositSquare(MOS2, flakeNm, layerPx, 0); return; }
        // hBN / graphene / hBN stack, top flake slightly rotated
        int hbnPx = std::max(1, (int)lround(layerPx * 1.2));
        int grPx = std::max(1, (int)lround(layerPx * 0.6));
        depositSquare(HBN, flakeNm, hbnPx, 0);
        depositSquare(GRAPHENE, flakeNm * 0.84, grPx, 0);
        depositSquare(HBN, flakeNm * 0.98, hbnPx, 8);
    }

    void doSpinResist(double thickNm, bool positive, const std::string &preset) {
        int resPx = std::max(1, (int)lround(thickNm / nmPx));
        uint8_t matId = resistFromPreset(preset);
        auto surf = findSurface(0); // spin coating planarizes: use slice 0
        int minSurf = H;
        for (int x = 0; x < W; x++) minSurf = std::min(minSurf, surf[x]);
        int resistTop = std::max(0, minSurf - resPx);
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            for (int x = 0; x < W; x++)
                for (int y = resistTop; y < surf[x]; y++)
                    if (g[idx(x, y)] == AIR) g[idx(x, y)] = matId;
        }
        ResistState rs;
        rs.name = preset;
        rs.positive = positive;
        rs.matId = matId;
        rs.matExpId = toExposed(matId);
        rs.resistThickNm = thickNm;
        resists.push_back(rs);
    }

    // Per-column exposure mask at depth zNm (only dots vary with z).
    std::vector<uint8_t> exposurePattern(const std::string &pattern, double pitch,
                                         double duty, double lineW, double dotPitch,
                                         double dotDiam, double zNm) {
        std::vector<uint8_t> open(W, 0);
        double pxPerNm = 1.0 / nmPx;
        if (pattern == "grating") {
            int pitchPx = std::max(1, (int)lround(pitch * pxPerNm));
            int openPx = std::max(1, (int)lround(pitchPx * duty / 100));
            for (int x = 0; x < W; x++)
                open[x] = (x % pitchPx) < openPx ? 1 : 0;
        } else if (pattern == "single" || pattern == "iso_trench") {
            int wPx = std::max(1, (int)lround(lineW * pxPerNm));
            int x0 = (W - wPx) / 2;
            for (int x = std::max(0, x0); x < x0 + wPx && x < W; x++) open[x] = 1;
        } else if (pattern == "dots") {
            int pitchPx = std::max(1, (int)lround(dotPitch * pxPerNm));
            double rNm = dotDiam / 2;
            double rem = fmod(fmod(zNm, dotPitch) + dotPitch, dotPitch);
            double dzNm = std::min(rem, dotPitch - rem);
            double chordHalf = dzNm < rNm ? sqrt(rNm * rNm - dzNm * dzNm) : 0;
            int chordHalfPx = (int)lround(chordHalf * pxPerNm);
            if (chordHalfPx > 0)
                for (int x = 0; x < W; x++) {
                    double dx = (x % pitchPx) - pitchPx / 2.0;
                    open[x] = fabs(dx) < chordHalfPx ? 1 : 0;
                }
        } else { // blanket
            std::fill(open.begin(), open.end(), 1);
        }
        return open;
    }

    // Per-column dose at depth zNm from custom mask shapes + image (nm units).
    std::vector<float> customDoseMap(const std::vector<MaskShape> &shapes,
                                     const MaskImage &img, double zNm) {
        std::vector<float> dose(W, 0.0f);
        if (img.ok())
            for (int x = 0; x < W; x++)
                dose[x] += (float)img.sample((x + 0.5) * nmPx / sampWNm,
                                             zNm / sampleDepthNm);
        for (const MaskShape &s : shapes) {
            if (s.rect) {
                if (zNm < s.y || zNm > s.y + s.h) continue;
                int x0 = std::max(0, (int)floor(s.x / nmPx));
                int x1 = std::min(W, (int)ceil((s.x + s.w) / nmPx));
                for (int x = x0; x < x1; x++) dose[x] += (float)s.dose;
            } else {
                double cx = s.x + s.w / 2, cy = s.y + s.h / 2;
                double rx = s.w / 2, ry = s.h / 2;
                if (rx <= 0 || ry <= 0) continue;
                int x0 = std::max(0, (int)floor(s.x / nmPx));
                int x1 = std::min(W, (int)ceil((s.x + s.w) / nmPx));
                double dy = (zNm - cy) / ry;
                for (int x = x0; x < x1; x++) {
                    double dx = (x * nmPx - cx) / rx;
                    if (dx * dx + dy * dy <= 1) dose[x] += (float)s.dose;
                }
            }
        }
        return dose;
    }

    // The step message carries all exposure parameters; for pattern=="custom"
    // it also carries the mask (shapes string + optional base64 dose image).
    bool doExpose(const std::string &m) {
        if (!hasResist()) return false;
        std::string pattern = dexmsg::get_str(m, "pattern");
        double pitch = dexmsg::get_num(m, "pitch", 200);
        double duty = dexmsg::get_num(m, "duty", 50);
        double lineW = dexmsg::get_num(m, "lineW", 100);
        double dotPitch = dexmsg::get_num(m, "dotPitch", 100);
        double dotDiam = dexmsg::get_num(m, "dotDiam", 50);
        double dose = dexmsg::get_num(m, "dose", 150);
        bool custom = pattern == "custom";
        std::vector<MaskShape> shapes;
        MaskImage img;
        if (custom) {
            shapes = parseShapes(dexmsg::get_str(m, "shapes"));
            std::string data = dexmsg::get_str(m, "imgdata");
            if (!data.empty()) {
                img.w = (int)dexmsg::get_num(m, "imw", 0);
                img.h = (int)dexmsg::get_num(m, "imh", 0);
                img.fullDose = dexmsg::get_num(m, "imfull", 0);
                img.v = b64decode(data);
            }
            if (shapes.empty() && !img.ok()) return false; // empty custom mask
        }
        for (auto &rs : resists)
            if ((int)rs.doseMaps.size() < D)
                rs.doseMaps.resize(D, std::vector<float>(W, 0.0f));
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            double zNm = (z + 0.5) * sampleDepthNm / D;
            std::vector<float> doseCol;
            std::vector<uint8_t> open;
            if (custom) {
                doseCol = customDoseMap(shapes, img, zNm);
                open.assign(W, 0);
                for (int x = 0; x < W; x++) open[x] = doseCol[x] > 0 ? 1 : 0;
            } else {
                open = exposurePattern(pattern, pitch, duty, lineW, dotPitch,
                                       dotDiam, zNm);
            }
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                    if (open[x] && isResistUnexp(g[idx(x, y)]))
                        g[idx(x, y)] = toExposed(g[idx(x, y)]);
            for (auto &rs : resists) {
                std::vector<float> &dm = rs.doseMaps[z];
                for (int x = 0; x < W; x++) {
                    if (!open[x]) continue;
                    bool has = false;
                    for (int y = 0; y < H; y++) {
                        uint8_t mm = g[idx(x, y)];
                        if (mm == rs.matId || mm == rs.matExpId) { has = true; break; }
                    }
                    if (has) dm[x] += custom ? doseCol[x] : (float)dose;
                }
            }
        }
        for (auto &rs : resists) rs.exposed = true;
        return true;
    }

    // Returns 0 ok, 1 no such resist, 2 not exposed.
    int doDevelop(const std::string &target, double sidewallDeg, double contrast,
                  double devTimeSec, double darkErosionNmMin, double D100val,
                  double scumNm) {
        ResistState *rs = nullptr;
        for (auto &r : resists)
            if (r.name == target) { rs = &r; break; }
        if (!rs) return 1;
        if (!rs->exposed) return 2;

        uint8_t matUnexp = rs->matId, matExp = rs->matExpId;
        bool isPositive = rs->positive;
        double gamma = std::max(0.5, contrast > 0 ? contrast : 3.0);
        double tDev = std::max(1.0, devTimeSec > 0 ? devTimeSec : 60.0);
        double darkRate = std::max(0.0, darkErosionNmMin);
        double d100 = std::max(1.0, D100val > 0 ? D100val : 120.0);
        double D0 = d100 * pow(10, -1 / gamma);
        double scumFrac = rs->resistThickNm > 0
            ? std::min(0.9, std::max(0.0, scumNm) / rs->resistThickNm) : 0;
        int darkLossPx = (int)lround(darkRate * (tDev / 60) / nmPx);

#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            const std::vector<float> *doseMap =
                (int)rs->doseMaps.size() > z ? &rs->doseMaps[z] : nullptr;

            for (size_t i = 0; i < (size_t)W * H; i++)
                if (g[i] == matExp) g[i] = matUnexp;

            // dose-dependent removal per column (contrast curve)
            std::vector<uint8_t> hadRemoval(W, 0);
            for (int x = 0; x < W; x++) {
                int topR = -1, botR = -1;
                for (int y = 0; y < H; y++)
                    if (g[idx(x, y)] == matUnexp) { if (topR < 0) topR = y; botR = y; }
                if (topR < 0) continue;
                int resistH = botR - topR + 1;
                double dose = doseMap ? (*doseMap)[x] : 0;
                double t;
                if (dose <= D0) {
                    t = 1;
                } else {
                    double logDose = log10(dose);
                    double tBase = std::max(0.0, 1 - gamma * (logDose - log10(D0)));
                    double scumTail =
                        scumFrac * exp(-6 * std::max(0.0, logDose - log10(d100)));
                    t = std::max(tBase, scumTail);
                }
                if (!isPositive) t = 1 - t;
                int removePx = (int)lround((1 - t) * resistH);
                if (removePx > 0) {
                    hadRemoval[x] = 1;
                    for (int k = 0; k < removePx; k++) g[idx(x, topR + k)] = AIR;
                }
            }

            // dark erosion thins untouched columns from the top
            if (darkLossPx > 0)
                for (int x = 0; x < W; x++) {
                    if (hadRemoval[x]) continue;
                    int topR = -1, botR = -1;
                    for (int y = 0; y < H; y++)
                        if (g[idx(x, y)] == matUnexp) { if (topR < 0) topR = y; botR = y; }
                    if (topR < 0) continue;
                    int remove = std::min(darkLossPx, botR - topR + 1);
                    for (int k = 0; k < remove; k++) g[idx(x, topR + k)] = AIR;
                }

            // sidewall shaping at development-created edges
            if (sidewallDeg != 90) {
                double slopePerRow = tan((sidewallDeg - 90) * M_PI / 180);
                struct Edge { int resistX, airDir, resistTop, resistBot; };
                std::vector<Edge> edges;
                std::vector<uint8_t> snap(g, g + (size_t)W * H);
                for (int x = 0; x < W - 1; x++) {
                    if (!hadRemoval[x] && !hadRemoval[x + 1]) continue;
                    for (int y = 0; y < H; y++) {
                        uint8_t a = snap[idx(x, y)], b = snap[idx(x + 1, y)];
                        if (!((a == matUnexp && b == AIR) || (a == AIR && b == matUnexp)))
                            continue;
                        int resistX = a == matUnexp ? x : x + 1;
                        int airDir = a == matUnexp ? 1 : -1;
                        int rTop = y, rBot = y;
                        while (rTop > 0 && snap[idx(resistX, rTop - 1)] == matUnexp) rTop--;
                        while (rBot < H - 1 && snap[idx(resistX, rBot + 1)] == matUnexp) rBot++;
                        edges.push_back({resistX, airDir, rTop, rBot});
                        y = rBot;
                    }
                }
                for (const Edge &e : edges) {
                    int resistH = e.resistBot - e.resistTop + 1;
                    for (int dy = 0; dy < resistH; dy++) {
                        int shift = (int)lround(fabs(slopePerRow) * dy);
                        for (int s = 0; s < shift && s < 6; s++) {
                            if (sidewallDeg < 90) {
                                int rowY = e.resistBot - dy, ox = e.resistX - e.airDir * s;
                                if (ox >= 0 && ox < W && g[idx(ox, rowY)] == matUnexp)
                                    g[idx(ox, rowY)] = AIR;
                            } else {
                                int rowY = e.resistTop + dy, ox = e.resistX + e.airDir * (s + 1);
                                if (ox >= 0 && ox < W && g[idx(ox, rowY)] == AIR)
                                    g[idx(ox, rowY)] = matUnexp;
                            }
                        }
                    }
                }
            }
        }
        rs->exposed = false;
        return 0;
    }

    void doEtchRIE(uint8_t matId, double depthNm, double selectivity) {
        int depthPx = std::max(1, (int)lround(depthNm / nmPx));
        int resistRemovePx =
            std::max(0, (int)lround(depthPx / std::max(0.1, selectivity)));
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            for (int x = 0; x < W; x++) {
                int y = 0;
                while (y < H && g[idx(x, y)] == AIR) y++;
                int resLeft = resistRemovePx, targetLeft = depthPx;
                while (y < H) {
                    uint8_t m = g[idx(x, y)];
                    if (isResist(m) && resLeft > 0) { g[idx(x, y)] = AIR; resLeft--; y++; }
                    else if (m == matId && targetLeft > 0) { g[idx(x, y)] = AIR; targetLeft--; y++; }
                    else break;
                }
            }
        }
    }

    void doEtchWet(uint8_t matId, double depthNm) {
        int depthPx = std::max(1, (int)lround(depthNm / nmPx));
        std::vector<size_t> toRemove;
        for (int layer = 0; layer < depthPx; layer++) {
            bool any = false;
            for (int z = 0; z < D; z++) {
                uint8_t *g = slice(z);
                toRemove.clear();
                for (int y = 0; y < H; y++)
                    for (int x = 0; x < W; x++) {
                        if (g[idx(x, y)] != matId) continue;
                        bool adj = (x > 0 && g[idx(x - 1, y)] == AIR) ||
                                   (x < W - 1 && g[idx(x + 1, y)] == AIR) ||
                                   (y > 0 && g[idx(x, y - 1)] == AIR) ||
                                   (y < H - 1 && g[idx(x, y + 1)] == AIR);
                        if (adj) toRemove.push_back(idx(x, y));
                    }
                for (size_t i : toRemove) g[i] = AIR;
                if (!toRemove.empty()) any = true;
            }
            if (!any) break;
        }
    }

    void doEtchSF6(double depthNm) {
        int depthPx = std::max(1, (int)lround(depthNm / nmPx));
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            for (int x = 0; x < W; x++) {
                int y = 0;
                while (y < H && g[idx(x, y)] == AIR) y++;
                if (y >= H || isResist(g[idx(x, y)])) continue;
                int left = depthPx;
                while (y < H && left > 0 && is2DFlake(g[idx(x, y)])) {
                    g[idx(x, y)] = AIR;
                    left--;
                    y++;
                }
            }
        }
    }

    void doDescum(double timeSec, double rateNmPerSec) {
        int removePx = std::max(1, (int)lround(timeSec * rateNmPerSec / nmPx));
        std::vector<size_t> toRemove;
        for (int layer = 0; layer < removePx; layer++) {
            bool any = false;
            for (int z = 0; z < D; z++) {
                uint8_t *g = slice(z);
                toRemove.clear();
                for (int y = 0; y < H; y++)
                    for (int x = 0; x < W; x++) {
                        if (!isResist(g[idx(x, y)])) continue;
                        bool adj = (x > 0 && g[idx(x - 1, y)] == AIR) ||
                                   (x < W - 1 && g[idx(x + 1, y)] == AIR) ||
                                   (y > 0 && g[idx(x, y - 1)] == AIR) ||
                                   (y < H - 1 && g[idx(x, y + 1)] == AIR);
                        if (adj) toRemove.push_back(idx(x, y));
                    }
                for (size_t i : toRemove) g[i] = AIR;
                if (!toRemove.empty()) any = true;
            }
            if (!any) break;
        }
    }

    void doLiftoff() {
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
        for (int z = 0; z < D; z++) {
            uint8_t *g = slice(z);
            for (size_t i = 0; i < (size_t)W * H; i++)
                if (isResist(g[i])) g[i] = AIR;
            // BFS from the bottom row: anything not connected to bulk floats away
            std::vector<uint8_t> anchored((size_t)W * H, 0);
            std::vector<int> q;
            q.reserve((size_t)W * H / 4);
            for (int x = 0; x < W; x++) {
                size_t i = idx(x, H - 1);
                if (g[i] != AIR) { anchored[i] = 1; q.push_back((int)i); }
            }
            for (size_t head = 0; head < q.size(); head++) {
                int i = q[head], x = i % W, y = i / W;
                const int nb[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
                for (auto &d : nb) {
                    int nx = x + d[0], ny = y + d[1];
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    size_t j = idx(nx, ny);
                    if (!anchored[j] && g[j] != AIR) { anchored[j] = 1; q.push_back((int)j); }
                }
            }
            for (size_t i = 0; i < (size_t)W * H; i++)
                if (g[i] != AIR && !anchored[i]) g[i] = AIR;
        }
        resists.clear();
    }

    void doStrip() {
        for (uint8_t &m : grid)
            if (isResist(m)) m = AIR;
        resists.clear();
    }

    // ---------------------------------------------------------- flow

    // Execute one step message. Returns "" on success, else an error string.
    std::string applyStep(const std::string &m) {
        std::string type = dexmsg::get_str(m, "type");
        if (type == "deposit") {
            doDeposit(matFromName(dexmsg::get_str(m, "material"), METAL),
                      dexmsg::get_num(m, "thickness", 30),
                      dexmsg::get_str(m, "method") == "conformal");
        } else if (type == "transfer_2d") {
            doTransfer2D(dexmsg::get_str(m, "material"),
                         dexmsg::get_num(m, "flakeSize", 140),
                         dexmsg::get_num(m, "layerThick", 1));
        } else if (type == "spinresist") {
            doSpinResist(dexmsg::get_num(m, "thickness", 120),
                         dexmsg::get_str(m, "rtype") != "negative",
                         dexmsg::get_str(m, "resist"));
        } else if (type == "expose" || type == "uv_expose") {
            if (!doExpose(m)) return "No resist to expose (or empty custom mask)";
        } else if (type == "develop") {
            int r = doDevelop(dexmsg::get_str(m, "target"),
                              dexmsg::get_num(m, "sidewall", 90),
                              dexmsg::get_num(m, "contrast", 3),
                              dexmsg::get_num(m, "devTime", 60),
                              dexmsg::get_num(m, "darkErosion", 2),
                              dexmsg::get_num(m, "D100", 120),
                              dexmsg::get_num(m, "scum", 0));
            if (r == 1) return "No " + dexmsg::get_str(m, "target") + " resist to develop";
            if (r == 2) return dexmsg::get_str(m, "target") + " resist not exposed yet";
        } else if (type == "descum") {
            doDescum(dexmsg::get_num(m, "time", 15), dexmsg::get_num(m, "rate", 0.5));
        } else if (type == "etch_rie") {
            doEtchRIE(matFromName(dexmsg::get_str(m, "target"), SIO2),
                      dexmsg::get_num(m, "depth", 80),
                      dexmsg::get_num(m, "selectivity", 5));
        } else if (type == "etch_sf6") {
            doEtchSF6(dexmsg::get_num(m, "depth", 15));
        } else if (type == "etch_wet") {
            doEtchWet(matFromName(dexmsg::get_str(m, "target"), SIO2),
                      dexmsg::get_num(m, "depth", 50));
        } else if (type == "liftoff") {
            doLiftoff();
        } else if (type == "strip") {
            doStrip();
        } else {
            return "Unknown step type";
        }
        return "";
    }

    // Rebuild the substrate and replay the whole flow (undo/reorder/delete).
    void replayAll() {
        build();
        for (const std::string &m : flow) applyStep(m); // replay errors are benign
    }

    // ---------------------------------------------------------- rendering

    void renderCross() {
        uint8_t *g = slice(displaySlice());
        frameW = W;
        frameH = H;
        frame.resize((size_t)W * H * 4);
        for (size_t i = 0; i < (size_t)W * H; i++) {
            uint8_t m = g[i];
            float a = matAlpha(m);
            uint8_t *px = &frame[i * 4];
            // composite over the theme background so translucent resists blend
            px[0] = (uint8_t)lround(MAT_COLOR[m][0] * a + bgR * (1 - a));
            px[1] = (uint8_t)lround(MAT_COLOR[m][1] * a + bgG * (1 - a));
            px[2] = (uint8_t)lround(MAT_COLOR[m][2] * a + bgB * (1 - a));
            px[3] = 255;
        }
    }

    struct Quad {
        float x[4], y[4];
        float depth;
        uint8_t r, g, b;
        float a;
    };

    void renderIso() {
        const int CW = 1000, CH = 700;
        frameW = CW;
        frameH = CH;
        frame.resize((size_t)CW * CH * 4);
        for (size_t i = 0; i < (size_t)CW * CH; i++) {
            frame[i * 4] = bgR;
            frame[i * 4 + 1] = bgG;
            frame[i * 4 + 2] = bgB;
            frame[i * 4 + 3] = 255;
        }

        double azR = camAz * M_PI / 180, elR = camEl * M_PI / 180;
        double cosAz = cos(azR), sinAz = sin(azR);
        double cosEl = cos(elR), sinEl = sin(elR);
        int depth3d = std::max(10, (int)lround(sampleDepthNm / nmPx));
        int nSlices = D;
        double cx0 = W / 2.0, cy0 = H / 2.0, cz0 = depth3d / 2.0;
        double sc = std::min(CW, CH) / (std::max(W, H) * 1.3) * camZoom;
        double hwx = CW / 2.0, hwy = CH / 2.0 - CH * 0.06;

        auto proj = [&](double x, double y, double z, float *sx, float *sy,
                        float *dep) {
            double dx = x - cx0, dy = y - cy0, dz = z - cz0;
            double rx = dx * cosAz + dz * sinAz;
            double rz = -dx * sinAz + dz * cosAz;
            double ry = dy * cosEl - rz * sinEl;
            double rz2 = dy * sinEl + rz * cosEl;
            double px, py;
            if (perspective) {
                double fov = 600, pz = rz2 + fov + depth3d;
                double s = fov / std::max(pz, 1.0);
                px = rx * s;
                py = ry * s;
            } else {
                px = rx;
                py = ry;
            }
            *sx = (float)(hwx + px * sc);
            *sy = (float)(hwy + py * sc);
            *dep = (float)rz2;
        };

        // Emit quads slice by slice with run-length merged columns, exactly
        // like the original's 3D web-worker, then painter-sort and rasterize.
        std::vector<Quad> quads;
        quads.reserve(20000);
        auto addQ = [&](double X0, double Y0, double Z0, double X1, double Y1,
                        double Z1, double X2, double Y2, double Z2, double X3,
                        double Y3, double Z3, int r, int g, int b, float a) {
            Quad q;
            float d0, d1, d2, d3;
            proj(X0, Y0, Z0, &q.x[0], &q.y[0], &d0);
            proj(X1, Y1, Z1, &q.x[1], &q.y[1], &d1);
            proj(X2, Y2, Z2, &q.x[2], &q.y[2], &d2);
            proj(X3, Y3, Z3, &q.x[3], &q.y[3], &d3);
            q.depth = (d0 + d2) / 2;
            q.r = (uint8_t)std::min(255, std::max(0, r));
            q.g = (uint8_t)std::min(255, std::max(0, g));
            q.b = (uint8_t)std::min(255, std::max(0, b));
            q.a = a;
            quads.push_back(q);
        };

        for (int s = 0; s < nSlices; s++) {
            double z0 = (double)s * depth3d / nSlices;
            double z1 = (double)(s + 1) * depth3d / nSlices;
            double shade = 0.7 + 0.3 * ((double)s / nSlices);
            uint8_t *g = slice(s);
            for (int x = 0; x < W; x++) {
                int y = 0;
                while (y < H) {
                    uint8_t m = g[idx(x, y)];
                    if (m == AIR) { y++; continue; }
                    int yEnd = y;
                    while (yEnd < H && g[idx(x, yEnd)] == m) yEnd++;
                    int tr = MAT_COLOR[m][0], tg = MAT_COLOR[m][1], tb = MAT_COLOR[m][2];
                    int sr = std::max(0, tr - 30), sg = std::max(0, tg - 30),
                        sb = std::max(0, tb - 30);
                    float al = matAlpha(m);
                    addQ(x, y, z0, x + 1, y, z0, x + 1, yEnd, z0, x, yEnd, z0,
                         (int)lround(tr * shade), (int)lround(tg * shade),
                         (int)lround(tb * shade), al);
                    double s3 = 0.55 + 0.2 * ((double)s / nSlices);
                    addQ(x, y, z1, x + 1, y, z1, x + 1, yEnd, z1, x, yEnd, z1,
                         (int)lround(tr * s3), (int)lround(tg * s3),
                         (int)lround(tb * s3), al);
                    uint8_t mA = y > 0 ? g[idx(x, y - 1)] : AIR;
                    if (mA != m) {
                        double s4 = std::min(1.0, shade * 1.15);
                        addQ(x, y, z0, x + 1, y, z0, x + 1, y, z1, x, y, z1,
                             (int)lround(tr * s4), (int)lround(tg * s4),
                             (int)lround(tb * s4), al);
                    }
                    uint8_t mB = yEnd < H ? g[idx(x, yEnd)] : AIR;
                    if (mB != m)
                        addQ(x, yEnd, z0, x + 1, yEnd, z0, x + 1, yEnd, z1, x, yEnd, z1,
                             (int)lround(sr * shade * 0.5), (int)lround(sg * shade * 0.5),
                             (int)lround(sb * shade * 0.5), al);
                    uint8_t mR = x < W - 1 ? g[idx(x + 1, y)] : AIR;
                    if (x == W - 1 || mR != m)
                        addQ(x + 1, y, z0, x + 1, y, z1, x + 1, yEnd, z1, x + 1, yEnd, z0,
                             (int)lround(sr * shade), (int)lround(sg * shade),
                             (int)lround(sb * shade), al);
                    uint8_t mL = x > 0 ? g[idx(x - 1, y)] : AIR;
                    if (x == 0 || mL != m)
                        addQ(x, y, z0, x, y, z1, x, yEnd, z1, x, yEnd, z0,
                             (int)lround(sr * shade * 0.85), (int)lround(sg * shade * 0.85),
                             (int)lround(sb * shade * 0.85), al);
                    y = yEnd;
                }
            }
        }

        std::sort(quads.begin(), quads.end(),
                  [](const Quad &a, const Quad &b) { return a.depth > b.depth; });
        for (const Quad &q : quads) fillQuad(q, CW, CH);
    }

    void fillQuad(const Quad &q, int CW, int CH) {
        // two triangles, barycentric fill with alpha blend over the buffer
        const int tri[2][3] = {{0, 1, 2}, {0, 2, 3}};
        for (auto &t : tri) {
            float x0 = q.x[t[0]], y0 = q.y[t[0]];
            float x1 = q.x[t[1]], y1 = q.y[t[1]];
            float x2 = q.x[t[2]], y2 = q.y[t[2]];
            float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
            if (fabsf(area) < 1e-9f) continue;
            int minX = std::max(0, (int)floorf(std::min({x0, x1, x2})));
            int maxX = std::min(CW - 1, (int)ceilf(std::max({x0, x1, x2})));
            int minY = std::max(0, (int)floorf(std::min({y0, y1, y2})));
            int maxY = std::min(CH - 1, (int)ceilf(std::max({y0, y1, y2})));
            float inv = 1.0f / area;
            for (int py = minY; py <= maxY; py++)
                for (int px = minX; px <= maxX; px++) {
                    float cxp = px + 0.5f, cyp = py + 0.5f;
                    float w0 = ((x1 - cxp) * (y2 - cyp) - (x2 - cxp) * (y1 - cyp)) * inv;
                    float w1 = ((x2 - cxp) * (y0 - cyp) - (x0 - cxp) * (y2 - cyp)) * inv;
                    float w2 = 1.0f - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    uint8_t *dst = &frame[((size_t)py * CW + px) * 4];
                    dst[0] = (uint8_t)lroundf(q.r * q.a + dst[0] * (1 - q.a));
                    dst[1] = (uint8_t)lroundf(q.g * q.a + dst[1] * (1 - q.a));
                    dst[2] = (uint8_t)lroundf(q.b * q.a + dst[2] * (1 - q.a));
                    dst[3] = 255;
                }
        }
    }

    // ---------------------------------------------------------- messages

    // Snapshot: mid-depth cross-section downscaled to <=200 px wide, raw RGBA
    // with the material alpha in the alpha channel (matches the original's
    // flow thumbnails), base64-encoded.
    void saySnapshot(long q) {
        int sw = std::min(W, 200);
        int sh = std::max(1, (int)lround((double)sw * H / W));
        uint8_t *g = slice(D / 2);
        std::vector<uint8_t> px((size_t)sw * sh * 4);
        for (int y = 0; y < sh; y++) {
            int gy = (int)((int64_t)y * H / sh);
            for (int x = 0; x < sw; x++) {
                int gx = (int)((int64_t)x * W / sw);
                uint8_t m = g[idx(gx, gy)];
                uint8_t *p = &px[((size_t)y * sw + x) * 4];
                p[0] = MAT_COLOR[m][0];
                p[1] = MAT_COLOR[m][1];
                p[2] = MAT_COLOR[m][2];
                p[3] = (uint8_t)lround(255 * matAlpha(m));
            }
        }
        say("{\"t\":\"snapres\",\"q\":" + std::to_string(q) +
            ",\"w\":" + std::to_string(sw) + ",\"h\":" + std::to_string(sh) +
            ",\"data\":\"" + b64encode(px.data(), px.size()) + "\"}");
    }

    void handle(const std::string &m) {
        auto t0 = std::chrono::steady_clock::now();
        auto elapsedMs = [&t0] {
            return std::chrono::duration<double, std::milli>(
                       std::chrono::steady_clock::now() - t0).count();
        };
        std::string t = dexmsg::type_of(m);
        long q = (long)dexmsg::get_num(m, "q", -1);
        if (t == "build") {
            nmPx = dexmsg::get_num(m, "nmpx", 2);
            sampWNm = dexmsg::get_num(m, "sampw", 300);
            sampleDepthNm = dexmsg::get_num(m, "sampd", 300);
            siNm = dexmsg::get_num(m, "si", 200);
            oxNm = dexmsg::get_num(m, "ox", 80);
            flow.clear();
            build();
            sayState(elapsedMs(), q);
        } else if (t == "step") {
            std::string err = applyStep(m);
            if (err.empty()) {
                flow.push_back(m);
                sayState(elapsedMs(), q);
            } else {
                sayErr(err, q);
            }
        } else if (t == "snap") {
            saySnapshot(q);
        } else if (t == "undo") {
            if (!flow.empty()) {
                flow.pop_back();
                replayAll();
                sayState(elapsedMs(), q);
            }
        } else if (t == "slice") {
            slicePct = std::min(100.0, std::max(0.0, dexmsg::get_num(m, "v", 50)));
            sayState(0, q); // rtop/top change with the slice
        } else if (t == "view") {
            isoView = dexmsg::get_str(m, "mode") == "iso";
        } else if (t == "cam") {
            camAz = dexmsg::get_num(m, "az", camAz);
            camEl = dexmsg::get_num(m, "el", camEl);
            camZoom = std::min(8.0, std::max(0.2, dexmsg::get_num(m, "zoom", camZoom)));
            perspective = dexmsg::get_num(m, "persp", perspective ? 1 : 0) != 0;
        } else if (t == "bg") {
            bgR = (uint8_t)dexmsg::get_num(m, "r", 255);
            bgG = (uint8_t)dexmsg::get_num(m, "g", 255);
            bgB = (uint8_t)dexmsg::get_num(m, "b", 255);
        }
    }
};

// ---------------------------------------------------------------- ABI

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

// Event-driven experiment: all the work happens in on_message.
int advance(void *, double) { return 0; }

void on_message(void *p, const char *json, size_t len) {
    ((Instance *)p)->handle(std::string(json, len));
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
    if (s->isoView) s->renderIso();
    else s->renderCross();
    out->width = s->frameW;
    out->height = s->frameH;
    out->rgba = s->frame.data();
    return 1;
}

const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "pattern-transfer",
    "EBL Pattern Transfer",
    "1.0",
    create, destroy, advance, on_message, poll_message, render,
};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) {
    return &API;
}
