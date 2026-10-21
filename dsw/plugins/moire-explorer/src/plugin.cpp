// Moiré Explorer — atom view: a DSW compute backend.
//
// The page keeps all of its interactive drawing and bookkeeping; what moves
// here are the two kernels it used to run in Web Workers:
//
//   cslTile  coincidence-site matching between two anchor lattices
//   vdw      Lennard-Jones interlayer energy: current gap + a gap scan
//
// Both are ports of computeCslTile / computeVdwTile in the original page and
// parallelise over the outer atom loop with OpenMP. Tasks arrive as JSON
// ({"t":"task",...}), are queued, and run one per advance() call so results
// stream back as they finish and {"t":"cancel"} can drop queued work.

#include "../../../include/dex_plugin.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

// ---------------------------------------------------------------- JSON
// Just enough JSON for the task schema. Number arrays land in `nums`
// (fast path for atom coordinates), anything else in `items`.

struct Json {
    enum Kind { Null, Num, Str, Arr, Obj } kind = Null;
    double num = 0;
    std::string str;
    std::vector<double> nums;
    std::vector<Json> items;
    std::vector<std::pair<std::string, Json>> members;

    const Json *get(const char *key) const {
        for (const auto &m : members)
            if (m.first == key) return &m.second;
        return nullptr;
    }
    double number(const char *key, double fallback = 0) const {
        const Json *j = get(key);
        return (j && j->kind == Num) ? j->num : fallback;
    }
    std::string string(const char *key) const {
        const Json *j = get(key);
        return (j && j->kind == Str) ? j->str : std::string();
    }
};

struct Parser {
    const char *p, *end;
    bool ok = true;

    void ws() {
        while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++;
    }
    bool lit(const char *s) {
        size_t n = strlen(s);
        if ((size_t)(end - p) >= n && memcmp(p, s, n) == 0) { p += n; return true; }
        return false;
    }
    std::string parse_string() {
        std::string out;
        p++; // opening quote
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) {
                p++;
                switch (*p) {
                case 'n': out += '\n'; break;
                case 't': out += '\t'; break;
                case 'r': out += '\r'; break;
                case 'u': // task strings are element symbols; keep BMP as-is
                    if (end - p >= 5) {
                        unsigned cp = (unsigned)strtoul(std::string(p + 1, 4).c_str(), nullptr, 16);
                        if (cp < 0x80) out += (char)cp;
                        else if (cp < 0x800) {
                            out += (char)(0xC0 | (cp >> 6));
                            out += (char)(0x80 | (cp & 0x3F));
                        } else {
                            out += (char)(0xE0 | (cp >> 12));
                            out += (char)(0x80 | ((cp >> 6) & 0x3F));
                            out += (char)(0x80 | (cp & 0x3F));
                        }
                        p += 4;
                    }
                    break;
                default: out += *p;
                }
                p++;
            } else out += *p++;
        }
        if (p < end) p++; // closing quote
        return out;
    }
    Json value() {
        Json j;
        ws();
        if (p >= end) { ok = false; return j; }
        char c = *p;
        if (c == '{') {
            j.kind = Json::Obj;
            p++; ws();
            if (p < end && *p == '}') { p++; return j; }
            while (ok && p < end) {
                ws();
                if (p >= end || *p != '"') { ok = false; break; }
                std::string k = parse_string();
                ws();
                if (p >= end || *p != ':') { ok = false; break; }
                p++;
                Json v = value();
                j.members.emplace_back(std::move(k), std::move(v));
                ws();
                if (p < end && *p == ',') { p++; continue; }
                if (p < end && *p == '}') { p++; break; }
                ok = false;
            }
        } else if (c == '[') {
            j.kind = Json::Arr;
            p++; ws();
            if (p < end && *p == ']') { p++; return j; }
            while (ok && p < end) {
                ws();
                if (p < end && (*p == '-' || (*p >= '0' && *p <= '9'))) {
                    char *e = nullptr;
                    double d = strtod(p, &e);
                    if (e == p) { ok = false; break; }
                    j.nums.push_back(d);
                    p = e;
                } else {
                    j.items.push_back(value());
                }
                ws();
                if (p < end && *p == ',') { p++; continue; }
                if (p < end && *p == ']') { p++; break; }
                ok = false;
            }
        } else if (c == '"') {
            j.kind = Json::Str;
            j.str = parse_string();
        } else if (c == 't') { ok = lit("true"); j.kind = Json::Num; j.num = 1; }
        else if (c == 'f') { ok = lit("false"); j.kind = Json::Num; j.num = 0; }
        else if (c == 'n') { ok = lit("null"); }
        else {
            char *e = nullptr;
            j.num = strtod(p, &e);
            if (e == p) ok = false;
            j.kind = Json::Num;
            p = e;
        }
        return j;
    }
};

// ---------------------------------------------------------------- output

void put_num(std::string &s, double v) {
    char b[40];
    if (!std::isfinite(v)) { s += "null"; return; }
    snprintf(b, sizeof b, "%.17g", v);
    s += b;
}
void put_array(std::string &s, const std::vector<double> &v) {
    s += '[';
    for (size_t i = 0; i < v.size(); i++) {
        if (i) s += ',';
        put_num(s, v[i]);
    }
    s += ']';
}
void put_str(std::string &s, const std::string &v) {
    s += '"';
    for (char c : v) {
        if (c == '"' || c == '\\') { s += '\\'; s += c; }
        else if ((unsigned char)c < 0x20) s += ' ';
        else s += c;
    }
    s += '"';
}

// ---------------------------------------------------------------- spatial grid
// Cells are `cell` wide; a lookup visits the 3x3 block around a point, which
// is exactly what the page's Map-based spatial hash did.

struct Grid {
    double cell = 1;
    std::vector<int> order;                              // point indices by cell
    std::unordered_map<uint64_t, std::pair<int, int>> range; // cell -> [begin,end) in `order`

    static uint64_t key(int64_t ix, int64_t iy) {
        return ((uint64_t)(uint32_t)ix << 32) | (uint64_t)(uint32_t)iy;
    }
    static int64_t cell_of(double v, double cell) { return (int64_t)std::floor(v / cell); }

    void build(const double *x, const double *y, size_t n, double cell_size) {
        cell = cell_size;
        std::vector<uint64_t> keys(n);
        order.resize(n);
        for (size_t i = 0; i < n; i++) {
            keys[i] = key(cell_of(x[i], cell), cell_of(y[i], cell));
            order[i] = (int)i;
        }
        // stable: points inside one cell keep input order, like the original
        std::stable_sort(order.begin(), order.end(),
                         [&](int a, int b) { return keys[a] < keys[b]; });
        range.reserve(n / 2 + 1);
        size_t i = 0;
        while (i < n) {
            size_t j = i;
            uint64_t k = keys[order[i]];
            while (j < n && keys[order[j]] == k) j++;
            range[k] = {(int)i, (int)j};
            i = j;
        }
    }
    const std::pair<int, int> *find(int64_t ix, int64_t iy) const {
        auto it = range.find(key(ix, iy));
        return it == range.end() ? nullptr : &it->second;
    }
};

// ---------------------------------------------------------------- vdW

struct LJ { double sigma, epsilon; };

struct Atoms {
    std::vector<double> x, y, z;
    std::vector<int> el; // index into the task's element table
};

Atoms read_atoms(const Json &j) {
    Atoms a;
    if (const Json *v = j.get("x")) a.x = v->nums;
    if (const Json *v = j.get("y")) a.y = v->nums;
    if (const Json *v = j.get("z")) a.z = v->nums;
    if (const Json *v = j.get("e")) {
        a.el.reserve(v->nums.size());
        for (double d : v->nums) a.el.push_back((int)d);
    }
    size_t n = std::min(std::min(a.x.size(), a.y.size()), std::min(a.z.size(), a.el.size()));
    a.x.resize(n); a.y.resize(n); a.z.resize(n); a.el.resize(n);
    return a;
}

std::string vdw_task(const Json &t) {
    const Json *topj = t.get("top"), *botj = t.get("bottom");
    Atoms top = topj ? read_atoms(*topj) : Atoms();
    Atoms bot = botj ? read_atoms(*botj) : Atoms();
    const double cutoff = std::max(t.number("cutoff"), 1e-12);
    const double cutoff2 = cutoff * cutoff;
    const double eps_scale = t.number("epsScale", 1);
    const double pair_weight = t.number("topWeight", 1) * t.number("bottomWeight", 1);
    std::vector<double> shifts;
    if (const Json *v = t.get("shifts")) shifts = v->nums;
    const int S = (int)shifts.size();

    // element table + LJ parameters, mixed once per element pair
    std::vector<std::string> names;
    if (const Json *v = t.get("elements"))
        for (const Json &s : v->items) names.push_back(s.str);
    const int ne = (int)names.size();
    std::map<std::string, LJ> table;
    if (const Json *lj = t.get("lj"))
        for (const auto &m : lj->members)
            if (m.second.nums.size() >= 2) table[m.first] = {m.second.nums[0], m.second.nums[1]};
    auto lookup = [&](const std::string &n) {
        auto it = table.find(n);
        if (it != table.end()) return it->second;
        it = table.find("C");
        return it != table.end() ? it->second : LJ{3.4, 2.84};
    };
    std::vector<double> mixA12((size_t)ne * ne), mixB6((size_t)ne * ne);
    for (int i = 0; i < ne; i++)
        for (int j = 0; j < ne; j++) {
            LJ a = lookup(names[i]), b = lookup(names[j]);
            double sigma = 0.5 * (a.sigma + b.sigma);
            double eps = std::sqrt(a.epsilon * b.epsilon);
            if (names[i] != names[j]) eps *= eps_scale;
            double s2 = sigma * sigma, s6 = s2 * s2 * s2;
            double b6 = 4 * eps * s6;
            mixB6[(size_t)i * ne + j] = b6;
            mixA12[(size_t)i * ne + j] = b6 * s6;
        }

    long long pair_count = 0;
    double current = 0;
    std::vector<double> scan((size_t)S, 0.0);
    std::vector<char> seen((size_t)ne * ne, 0);

    if (!top.x.empty() && !bot.x.empty() && ne > 0) {
        Grid grid;
        grid.build(bot.x.data(), bot.y.data(), bot.x.size(), cutoff);

        int nthreads = 1;
#ifdef _OPENMP
        nthreads = omp_get_max_threads();
#endif
        // one accumulator set per thread, merged in thread order (deterministic
        // for a given thread count)
        struct Acc {
            long long pairs = 0;
            double cur = 0;
            std::vector<double> scan;
            std::vector<char> seen;
        };
        std::vector<Acc> acc((size_t)nthreads);
        for (auto &a : acc) { a.scan.assign((size_t)S, 0.0); a.seen.assign((size_t)ne * ne, 0); }

        const int nt = (int)top.x.size();
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 64)
#endif
        for (int i = 0; i < nt; i++) {
            int tid = 0;
#ifdef _OPENMP
            tid = omp_get_thread_num();
#endif
            Acc &A = acc[(size_t)tid];
            const double tx = top.x[i], ty = top.y[i], tz = top.z[i];
            const int te = top.el[i];
            const int64_t ix = Grid::cell_of(tx, cutoff), iy = Grid::cell_of(ty, cutoff);
            for (int dx = -1; dx <= 1; dx++)
                for (int dy = -1; dy <= 1; dy++) {
                    const auto *r = grid.find(ix + dx, iy + dy);
                    if (!r) continue;
                    for (int q = r->first; q < r->second; q++) {
                        const int b = grid.order[(size_t)q];
                        const double ddx = tx - bot.x[b], ddy = ty - bot.y[b];
                        const double rho2 = ddx * ddx + ddy * ddy;
                        if (rho2 > cutoff2) continue;
                        const int be = bot.el[b];
                        A.pairs++;
                        const size_t pk = (size_t)std::min(te, be) * ne + (size_t)std::max(te, be);
                        A.seen[pk] = 1;
                        const double a12 = mixA12[(size_t)te * ne + be];
                        const double b6 = mixB6[(size_t)te * ne + be];
                        const double dz0 = tz - bot.z[b];

                        double r2 = rho2 + dz0 * dz0;
                        if (r2 > 0 && r2 <= cutoff2) {
                            double i2 = 1 / r2, i6 = i2 * i2 * i2;
                            A.cur += pair_weight * (a12 * i6 * i6 - b6 * i6);
                        }
                        double *sc = A.scan.data();
                        const double *sh = shifts.data();
                        for (int s = 0; s < S; s++) {
                            const double dz = dz0 + sh[s];
                            const double rr = rho2 + dz * dz;
                            if (rr <= 0 || rr > cutoff2) continue;
                            double i2 = 1 / rr, i6 = i2 * i2 * i2;
                            sc[s] += pair_weight * (a12 * i6 * i6 - b6 * i6);
                        }
                    }
                }
        }
        for (const Acc &a : acc) {
            pair_count += a.pairs;
            current += a.cur;
            for (int s = 0; s < S; s++) scan[(size_t)s] += a.scan[(size_t)s];
            for (size_t k = 0; k < seen.size(); k++) seen[k] = seen[k] || a.seen[k];
        }
    }

    // pair keys the way the page spells them: the two names sorted, joined by '-'
    std::set<std::string> keys;
    for (int i = 0; i < ne; i++)
        for (int j = i; j < ne; j++)
            if (seen[(size_t)i * ne + j] || seen[(size_t)j * ne + i]) {
                std::string a = names[i], b = names[j];
                if (b < a) std::swap(a, b);
                keys.insert(a + "-" + b);
            }

    std::string out = "{\"pairCount\":" + std::to_string(pair_count) + ",\"currentEnergy\":";
    put_num(out, current);
    out += ",\"scanEnergies\":";
    put_array(out, scan);
    out += ",\"pairKeys\":[";
    bool first = true;
    for (const auto &k : keys) {
        if (!first) out += ',';
        first = false;
        put_str(out, k);
    }
    out += "]}";
    return out;
}

// ---------------------------------------------------------------- CSL

std::string csl_task(const Json &t) {
    std::vector<double> ax, ay, aid, bx, by, bid;
    if (const Json *a = t.get("a")) {
        if (const Json *v = a->get("x")) ax = v->nums;
        if (const Json *v = a->get("y")) ay = v->nums;
        if (const Json *v = a->get("id")) aid = v->nums;
    }
    if (const Json *b = t.get("b")) {
        if (const Json *v = b->get("x")) bx = v->nums;
        if (const Json *v = b->get("y")) by = v->nums;
        if (const Json *v = b->get("id")) bid = v->nums;
    }
    const double tol = t.number("tol");
    const int maxc = std::max(0, (int)t.number("maxc", 4));
    const size_t na = std::min(std::min(ax.size(), ay.size()), aid.size());
    const size_t nb = std::min(std::min(bx.size(), by.size()), bid.size());

    struct Cand { double d2; int a, b; };
    std::vector<std::vector<Cand>> per((size_t)na);

    if (na && nb && tol > 0) {
        Grid grid;
        grid.build(bx.data(), by.data(), nb, tol);
        const double tol2 = tol * tol;
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 64)
#endif
        for (int i = 0; i < (int)na; i++) {
            std::vector<Cand> local;
            const int64_t ix = Grid::cell_of(ax[i], tol), iy = Grid::cell_of(ay[i], tol);
            for (int dx = -1; dx <= 1; dx++)
                for (int dy = -1; dy <= 1; dy++) {
                    const auto *r = grid.find(ix + dx, iy + dy);
                    if (!r) continue;
                    for (int q = r->first; q < r->second; q++) {
                        const int b = grid.order[(size_t)q];
                        const double ddx = ax[i] - bx[b], ddy = ay[i] - by[b];
                        const double d2 = ddx * ddx + ddy * ddy;
                        if (d2 <= tol2) local.push_back({d2, i, b});
                    }
                }
            std::stable_sort(local.begin(), local.end(),
                             [](const Cand &l, const Cand &r) { return l.d2 < r.d2; });
            if ((int)local.size() > maxc) local.resize((size_t)maxc);
            per[(size_t)i] = std::move(local);
        }
    }

    std::vector<double> oa, ob, oax, oay, obx, oby, od2;
    for (const auto &v : per)
        for (const Cand &c : v) {
            oa.push_back(aid[(size_t)c.a]); ob.push_back(bid[(size_t)c.b]);
            oax.push_back(ax[(size_t)c.a]); oay.push_back(ay[(size_t)c.a]);
            obx.push_back(bx[(size_t)c.b]); oby.push_back(by[(size_t)c.b]);
            od2.push_back(c.d2);
        }
    std::string out = "{\"aId\":";
    put_array(out, oa);  out += ",\"bId\":";
    put_array(out, ob);  out += ",\"ax\":";
    put_array(out, oax); out += ",\"ay\":";
    put_array(out, oay); out += ",\"bx\":";
    put_array(out, obx); out += ",\"by\":";
    put_array(out, oby); out += ",\"d2\":";
    put_array(out, od2); out += "}";
    return out;
}

// ---------------------------------------------------------------- instance

struct Instance {
    struct Task { long long id; std::string type; Json body; };
    std::deque<Task> queue;
    std::deque<std::string> outbox;
    std::string handout;
    bool hello_sent = false;
    long long tasks_done = 0;
    double busy_s = 0, stats_clock = 0;

    void post_error(long long id, const std::string &msg) {
        std::string s = "{\"t\":\"res\",\"id\":" + std::to_string(id) + ",\"ok\":false,\"error\":";
        put_str(s, msg);
        s += "}";
        outbox.push_back(std::move(s));
    }
};

int thread_count() {
#ifdef _OPENMP
    return omp_get_max_threads();
#else
    return 1;
#endif
}

void *create() { return new Instance(); }
void destroy(void *p) { delete (Instance *)p; }

void on_message(void *p, const char *json, size_t len) {
    Instance *s = (Instance *)p;
    Parser ps{json, json + len};
    Json m = ps.value();
    if (!ps.ok || m.kind != Json::Obj) return;
    const std::string t = m.string("t");
    const long long id = (long long)m.number("id", -1);
    if (t == "task") {
        s->queue.push_back({id, m.string("type"), std::move(m)});
    } else if (t == "cancel") {
        for (auto it = s->queue.begin(); it != s->queue.end();)
            it = (it->id == id) ? s->queue.erase(it) : it + 1;
    }
}

int advance(void *p, double dt) {
    Instance *s = (Instance *)p;
    if (!s->hello_sent) {
        s->hello_sent = true;
        s->outbox.push_back("{\"t\":\"hello\",\"threads\":" + std::to_string(thread_count()) +
#ifdef _OPENMP
                            ",\"openmp\":true}");
#else
                            ",\"openmp\":false}");
#endif
        return 1;
    }
    s->stats_clock += dt;
    if (s->queue.empty()) return 0;

    Instance::Task task = std::move(s->queue.front());
    s->queue.pop_front();
    auto t0 = std::chrono::steady_clock::now();
    std::string result;
    try {
        if (task.type == "vdw") result = vdw_task(task.body);
        else if (task.type == "csl") result = csl_task(task.body);
        else { s->post_error(task.id, "unknown task type: " + task.type); return 1; }
    } catch (const std::exception &e) {
        s->post_error(task.id, e.what());
        return 1;
    }
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    s->tasks_done++;
    s->busy_s += ms / 1000.0;
    std::string out = "{\"t\":\"res\",\"id\":" + std::to_string(task.id) +
                      ",\"ok\":true,\"ms\":";
    put_num(out, ms);
    out += ",\"result\":" + result + "}";
    s->outbox.push_back(std::move(out));
    return 1;
}

const char *poll_message(void *p) {
    Instance *s = (Instance *)p;
    if (s->outbox.empty()) return nullptr;
    s->handout = std::move(s->outbox.front());
    s->outbox.pop_front();
    return s->handout.c_str();
}

int render(void *, dex_frame *) { return 0; } // message-only: the page draws itself

const dex_plugin_api API = {
    DEX_ABI_VERSION,
    "moire-explorer",
    "Moiré Explorer — atom view",
    "1.0",
    create, destroy, advance, on_message, poll_message, render,
};

} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
