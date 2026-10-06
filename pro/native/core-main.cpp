// ebw-core — the EBL Workbench Pro native core (2026-10-06).
//
// A program the desktop backend (desktop/server.mjs, desktop/core.mjs) starts and talks to over its
// standard input and output. Every message, both ways, is
//   [u32 little-endian byte length][one EBW2 wire message]
// where an EBW2 message is the page's wire format (src/core/wire.js): a JSON structure in which each
// typed array is replaced by {"$ta": i}, followed by the arrays' raw bytes — so a 20-million-point
// operator costs one copy, not a text conversion (the DSW plugin's JSON + base64 did).
//
//   core → backend, at start   {t: "hello", version, supports: [...], limits: {threads}}
//   backend → core             {id, type, payload}
//   core → backend             {id, ok: true, result} | {id, ok: false, error}
//
// The operations are those of the DSW plugin (plugin.cpp), on the same sources (mc, sr, pec, koh),
// so the results are the page's to the bit (gates gp-*). An array may arrive raw ({"$ta"}), as a
// JSON array or as base64 text (koh.js kohPayload), whichever the caller sent. Nothing but protocol
// is ever written to stdout; diagnostics go to stderr.
#include "json.hpp"
#include "mc.h"
#include "sr.h"
#include "pec.h"
#include "koh.h"
#include "ompcompat.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <cstdio>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

using json = nlohmann_lmp::json;

namespace {

const char *CORE_VERSION = "pro-1";
const uint32_t MAGIC = 0x32574245;   // "EBW2"
inline size_t pad8(size_t n) { return (n + 7) & ~(size_t)7; }
int threadsAvail() { return std::max(1, omp_get_num_procs() - 1); }

// ---------------------------------------------------------------- wire
// type codes of wire.js TYPES
enum { F64 = 0, F32, I32, U32, I16, U16, I8, U8, U8C, I64, U64 };
size_t typeSize(uint32_t t) { switch (t) { case F64: case I64: case U64: return 8; case F32: case I32: case U32: return 4; case I16: case U16: return 2; default: return 1; } }

struct Blob { uint32_t type; const uint8_t *p; size_t bytes; };
struct Msg { json tree; std::vector<Blob> arrays; std::vector<uint8_t> raw; };

double tagNum(const json &n) {
    const std::string s = n.at("$n").get<std::string>();
    if (s == "NaN") return std::numeric_limits<double>::quiet_NaN();
    if (s == "Inf") return std::numeric_limits<double>::infinity();
    if (s == "-Inf") return -std::numeric_limits<double>::infinity();
    return -0.0;
}
// {"$n"} → the number, {"$u"} → null, everywhere in the tree ({"$ta"} stays: it is resolved on use)
void untag(json &v) {
    if (v.is_object()) {
        if (v.size() == 1 && v.contains("$n")) { v = tagNum(v); return; }
        if (v.size() == 1 && v.contains("$u")) { v = nullptr; return; }
        for (auto &kv : v.items()) untag(kv.value());
    } else if (v.is_array()) for (auto &x : v) untag(x);
}

void decode(Msg &m) {
    const uint8_t *u = m.raw.data(); const size_t n = m.raw.size();
    if (n < 8) throw std::runtime_error("wire: short message");
    uint32_t magic, jl; memcpy(&magic, u, 4); memcpy(&jl, u + 4, 4);
    if (magic != MAGIC) throw std::runtime_error("wire: not an EBW2 message");
    if (8 + (size_t)jl > n) throw std::runtime_error("wire: truncated structure");
    m.tree = json::parse(u + 8, u + 8 + jl);
    untag(m.tree);
    size_t at = pad8(8 + jl);
    while (at < n) {
        if (at + 16 > n) throw std::runtime_error("wire: truncated array header");
        uint32_t t; double bl; memcpy(&t, u + at, 4); memcpy(&bl, u + at + 8, 8); at += 16;
        const size_t b = (size_t)bl;
        if (t > U64 || at + b > n || b % typeSize(t)) throw std::runtime_error("wire: bad array");
        m.arrays.push_back({t, u + at, b});
        at += pad8(b);
    }
}

std::vector<uint8_t> b64decode(const std::string &in) {
    static int8_t T[256]; static bool init = false;
    if (!init) { for (int i = 0; i < 256; i++) T[i] = -1; const char *a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; for (int i = 0; i < 64; i++) T[(uint8_t)a[i]] = (int8_t)i; init = true; }
    std::vector<uint8_t> out; out.reserve(in.size() * 3 / 4);
    uint32_t acc = 0; int bits = 0;
    for (unsigned char c : in) { if (c == '=') break; const int v = T[c]; if (v < 0) continue; acc = (acc << 6) | (uint32_t)v; bits += 6; if (bits >= 8) { bits -= 8; out.push_back((uint8_t)((acc >> bits) & 0xFF)); } }
    return out;
}

template <class S, class T> void convert(const uint8_t *p, size_t n, std::vector<T> &out) {
    out.resize(n);
    for (size_t i = 0; i < n; i++) { S s; memcpy(&s, p + i * sizeof(S), sizeof(S)); out[i] = (T)s; }
}
// an array field as std::vector<T>: raw ({"$ta"}), a JSON array, base64 text of T's bytes, or absent
template <class T> std::vector<T> vec(const Msg &m, const json &node) {
    std::vector<T> out;
    if (node.is_null()) return out;
    if (node.is_object() && node.contains("$ta")) {
        const size_t i = node.at("$ta").get<size_t>();
        if (i >= m.arrays.size()) throw std::runtime_error("wire: array index out of range");
        const Blob &b = m.arrays[i]; const size_t n = b.bytes / typeSize(b.type);
        switch (b.type) {
            case F64: convert<double>(b.p, n, out); break;  case F32: convert<float>(b.p, n, out); break;
            case I32: convert<int32_t>(b.p, n, out); break; case U32: convert<uint32_t>(b.p, n, out); break;
            case I16: convert<int16_t>(b.p, n, out); break; case U16: convert<uint16_t>(b.p, n, out); break;
            case I8: convert<int8_t>(b.p, n, out); break;   case I64: convert<int64_t>(b.p, n, out); break;
            case U64: convert<uint64_t>(b.p, n, out); break;
            default: convert<uint8_t>(b.p, n, out); break;
        }
        return out;
    }
    if (node.is_string()) {
        std::vector<uint8_t> b = b64decode(node.get<std::string>());
        if (b.size() % sizeof(T)) throw std::runtime_error("base64 array of the wrong size");
        out.resize(b.size() / sizeof(T)); if (!b.empty()) memcpy(out.data(), b.data(), b.size());
        return out;
    }
    if (node.is_array()) { out.reserve(node.size()); for (const auto &x : node) out.push_back(x.is_boolean() ? (T)x.get<bool>() : (T)x.get<double>()); return out; }
    throw std::runtime_error("expected an array");
}
template <class T> std::vector<T> vecAt(const Msg &m, const json &obj, const char *key) { return obj.contains(key) ? vec<T>(m, obj.at(key)) : std::vector<T>(); }
// typed arrays turned back into JSON arrays, for the operations that read their input as JSON (the
// Monte Carlo's configuration and tables, which are small)
void materialize(const Msg &m, json &v) {
    if (v.is_object()) {
        if (v.size() == 1 && v.contains("$ta")) { v = vec<double>(m, v); return; }
        for (auto &kv : v.items()) materialize(m, kv.value());
    } else if (v.is_array()) for (auto &x : v) materialize(m, x);
}

// a reply under construction: JSON plus typed arrays
struct Out {
    json tree;
    std::vector<std::pair<uint32_t, std::vector<uint8_t>>> arrays;
    template <class T> json add(uint32_t type, const std::vector<T> &v) {
        std::vector<uint8_t> b(v.size() * sizeof(T)); if (!v.empty()) memcpy(b.data(), v.data(), b.size());
        arrays.emplace_back(type, std::move(b));
        return json{{"$ta", arrays.size() - 1}};
    }
};
// numbers JSON cannot carry, tagged as wire.js does
json num(double x) {
    if (std::isnan(x)) return {{"$n", "NaN"}};
    if (std::isinf(x)) return {{"$n", x > 0 ? "Inf" : "-Inf"}};
    return x;
}

void writeAll(const void *p, size_t n) {
    const uint8_t *c = (const uint8_t *)p;
    while (n) { const size_t w = fwrite(c, 1, n, stdout); if (!w) throw std::runtime_error("stdout closed"); c += w; n -= w; }
}
void send(const Out &o) {
    const std::string js = o.tree.dump(-1, ' ', false, json::error_handler_t::replace);
    size_t size = pad8(8 + js.size());
    for (auto &a : o.arrays) size += 16 + pad8(a.second.size());
    std::vector<uint8_t> buf(size, 0);
    uint32_t jl = (uint32_t)js.size();
    memcpy(buf.data(), &MAGIC, 4); memcpy(buf.data() + 4, &jl, 4); memcpy(buf.data() + 8, js.data(), js.size());
    size_t at = pad8(8 + js.size());
    for (auto &a : o.arrays) {
        const double bl = (double)a.second.size();
        memcpy(buf.data() + at, &a.first, 4); memcpy(buf.data() + at + 8, &bl, 8); at += 16;
        if (!a.second.empty()) memcpy(buf.data() + at, a.second.data(), a.second.size());
        at += pad8(a.second.size());
    }
    const uint32_t len = (uint32_t)buf.size();
    if ((size_t)len != buf.size()) throw std::runtime_error("reply over 4 GB");
    writeAll(&len, 4); writeAll(buf.data(), buf.size()); fflush(stdout);
}
bool readAll(void *p, size_t n) {
    uint8_t *c = (uint8_t *)p;
    while (n) { const size_t r = fread(c, 1, n, stdin); if (!r) return false; c += r; n -= r; }
    return true;
}

// ---------------------------------------------------------------- the operations
struct State {
    mc::Transport mc;
    sr::Rows kept;          // the short-range operator kept for pecSolve (srRows with keep)
    int keptToken = 0;
};

json supportsList() { return json::array({"echo", "mcInit", "mcBatches", "srRows", "pecSolve", "kohEtch", "release"}); }

void handle(State &S, const Msg &m, Out &o) {
    const json &q = m.tree.at("payload");
    const std::string type = m.tree.at("type").get<std::string>();
    // test hook: EBW_CORE_FAIL_OOM=<type> makes that request run out of memory (the path a real
    // shortage takes, which a test cannot provoke without filling the machine)
    if (const char *f = std::getenv("EBW_CORE_FAIL_OOM")) if (type == f) throw std::bad_alloc();
    json &res = o.tree["result"];
    res = json::object();
    if (type == "echo") {
        // transport self-test: n doubles i·0.5 back, and the sum of what was sent
        const size_t n = q.value("n", (size_t)0);
        std::vector<double> d(n); for (size_t i = 0; i < n; i++) d[i] = i * 0.5;
        const std::vector<double> in = vecAt<double>(m, q, "data");
        double s = 0; for (double x : in) s += x;
        res["data"] = o.add(F64, d); res["sumIn"] = s; res["text"] = q.value("text", std::string());
        return;
    }
    if (type == "mcInit") {
        json cfg = q.at("cfg"), tables = q.at("tables");
        materialize(m, cfg); materialize(m, tables);
        S.mc = mc::Transport();
        S.mc.init(cfg, tables);
        res = {{"nR", S.mc.nR}, {"nz", S.mc.nz}, {"threads", threadsAvail()}};
        return;
    }
    if (type == "mcBatches") {
        res = S.mc.runBatches(q.at("perBatch").get<int>(), q.value("seed", 1u), q.at("from").get<int>(), q.at("count").get<int>(), q.value("threads", 0));
        return;
    }
    if (type == "srRows") {
        sr::Kernel K;
        for (auto &t : q.at("terms")) { K.w.push_back(t.at(0).get<double>()); K.s.push_back(t.at(1).get<double>()); }
        K.exact = q.value("exact", true); K.total = q.at("total").get<double>(); K.rMax = q.at("rMax").get<double>(); K.eps = q.value("eps", 1e-10);
        sr::Polys P;
        const json &pj = q.at("polys");
        P.off = vecAt<int32_t>(m, pj, "off"); P.xy = vecAt<double>(m, pj, "xy"); P.dose = vecAt<double>(m, pj, "dose"); P.key = vecAt<int32_t>(m, pj, "key");
        if (P.off.size() != P.dose.size() + 1 || P.key.size() != P.dose.size() || (P.off.empty() ? 0 : (size_t)P.off.back() * 2) != P.xy.size()) throw std::runtime_error("srRows: inconsistent polygons");
        const std::vector<double> pts = vecAt<double>(m, q, "pts");
        if (pts.size() % 2) throw std::runtime_error("srRows: odd point array");
        const int threads = threadsAvail();
        const std::string kind = q.at("kind").get<std::string>();
        if (kind != "targets" && q.value("keep", false)) {
            S.kept = sr::rows(K, P, pts, threads);
            S.keptToken++;
            res = {{"kept", S.keptToken}, {"entries", S.kept.val.size()}, {"points", pts.size() / 2}, {"threads", threads}};
            return;
        }
        if (kind == "targets") res["values"] = o.add(F64, sr::doseAt(K, P, pts, threads));
        else { sr::Rows r = sr::rows(K, P, pts, threads); res["ptr"] = o.add(I32, r.ptr); res["idx"] = o.add(I32, r.idx); res["val"] = o.add(F64, r.val); }
        res["threads"] = threads; res["points"] = pts.size() / 2; res["polys"] = P.dose.size();
        return;
    }
    if (type == "pecSolve") {
        if (q.value("token", -1) != S.keptToken || S.kept.ptr.empty()) throw std::runtime_error("pecSolve: the short-range operator is no longer here");
        const json &pj = q.at("prob");
        pec::Problem P;
        P.nF = pj.at("nF").get<int>(); P.nP = pj.at("nP").get<int>();
        P.contour = pj.at("contour").get<bool>(); P.longOnly = pj.at("longOnly").get<bool>();
        P.srSelf = pj.value("srSelf", 0.0);
        P.ptWant = vecAt<double>(m, pj, "ptWant"); P.ptW = vecAt<double>(m, pj, "ptW"); P.ptBand = vecAt<uint8_t>(m, pj, "ptBand");
        P.d0 = vecAt<double>(m, pj, "d0"); P.base = vecAt<double>(m, pj, "base"); P.k = vecAt<double>(m, pj, "k"); P.want = vecAt<double>(m, pj, "want");
        P.banded = vecAt<uint8_t>(m, pj, "banded");
        P.maxFactor = pj.at("maxFactor").get<double>(); P.floor = pj.at("floor").get<double>(); P.tol = pj.at("tol").get<double>();
        P.maxIter = pj.at("maxIter").get<int>(); P.bLo = pj.at("bLo").get<double>(); P.bHi = pj.at("bHi").get<double>(); P.classes = pj.at("classes").get<int>();
        P.pts = vecAt<double>(m, q, "pts");
        const size_t nF = P.nF, nP = P.nP;
        if (P.d0.size() != nF || P.base.size() != nF || P.k.size() != nF || P.want.size() != nF || P.banded.size() != nF || P.pts.size() != 2 * nP || P.classes < 1)
            throw std::runtime_error("pecSolve: inconsistent problem");
        if (P.contour && (P.ptWant.size() != nP || P.ptW.size() != nP || P.ptBand.size() != nP)) throw std::runtime_error("pecSolve: contour targets missing");
        pec::LR L;
        if (q.contains("lr") && !q.at("lr").is_null()) {
            const json &lj = q.at("lr");
            L.on = true;
            L.K = vecAt<int32_t>(m, lj, "K"); L.Cl = vecAt<int32_t>(m, lj, "Cl"); L.Wt = vecAt<double>(m, lj, "Wt");
            const json &sj = lj.at("spec");
            L.re = vecAt<double>(m, sj, "re"); L.im = vecAt<double>(m, sj, "im"); L.NX = sj.at("NX").get<int>(); L.NY = sj.at("NY").get<int>();
            const json &gj = lj.at("grid");
            L.x0 = gj.at("x0").get<double>(); L.y0 = gj.at("y0").get<double>(); L.dx = gj.at("dx").get<double>(); L.nx = gj.at("nx").get<int>(); L.ny = gj.at("ny").get<int>();
            if (L.K.size() != L.Cl.size() || L.K.size() != L.Wt.size() || L.re.size() != (size_t)L.NX * L.NY || L.im.size() != L.re.size() || L.nx < 2 || L.ny < 2 || L.nx > L.NX || L.ny > L.NY)
                throw std::runtime_error("pecSolve: inconsistent long-range operator");
            for (auto c : L.Cl) if (c < 0 || c >= L.nx * L.ny) throw std::runtime_error("pecSolve: long-range cell out of range");
        }
        if ((int)S.kept.ptr.size() != P.nP + 1) throw std::runtime_error("pecSolve: the operator was built for other points");
        const int threads = threadsAvail();
        pec::Result R = pec::solve(P, S.kept, L, threads);
        res["write"] = o.add(F64, R.write); res["cls"] = o.add(I32, R.cls); res["classes"] = o.add(F64, R.classes);
        res["gotQ"] = o.add(F64, R.gotQ); res["history"] = o.add(F64, R.history);
        res["it"] = R.it; res["err"] = num(R.err); res["lo"] = num(R.lo); res["hi"] = num(R.hi); res["threads"] = threads;
        return;
    }
    if (type == "release") { S.kept = sr::Rows(); res["released"] = true; return; }
    if (type == "kohEtch") {
        koh::Input in;
        in.W = q.at("W").get<int>(); in.H = q.at("H").get<int>(); in.D = q.at("D").get<int>();
        if (in.W <= 0 || in.H <= 0 || in.D <= 0) throw std::runtime_error("kohEtch: empty grid");
        in.hx = q.at("hx").get<double>(); in.hy = q.at("hy").get<double>(); in.hz = q.at("hz").get<double>();
        in.timeS = q.at("timeS").get<double>(); in.coarseNm = q.at("coarseNm").get<double>();
        const json &r = q.at("rates");
        in.ratePoly = r.at("poly").get<double>(); in.rateOx = r.at("ox").get<double>(); in.rateAl = r.at("al").get<double>();
        for (int k = 0; k < 3; k++) { in.bx[k] = q.at("bx").at(k).get<double>(); in.bz[k] = q.at("bz").at(k).get<double>(); in.bu[k] = q.at("bu").at(k).get<double>(); }
        in.lutN = q.at("lutN").get<int>();
        const size_t L = (size_t)(in.lutN + 1) * (in.lutN + 1), NF = (size_t)in.W * in.H * in.D;
        in.lut = vecAt<float>(m, q, "lut"); in.slut = vecAt<float>(m, q, "slut"); in.codes = vecAt<uint8_t>(m, q, "codes");
        if (in.lut.size() != L || in.slut.size() != L || in.codes.size() != NF) throw std::runtime_error("kohEtch: tables or codes of the wrong size");
        const int threads = threadsAvail();
        koh::Output ko = koh::etch(in, threads);
        res["mask"] = o.add(U8, ko.mask); res["steps"] = ko.steps; res["threads"] = threads;
        return;
    }
    throw std::runtime_error("unsupported request " + type);
}

}  // namespace

int main(int argc, char **argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    if (argc > 1 && std::string(argv[1]) == "--version") { fprintf(stderr, "ebw-core %s, %d threads\n", CORE_VERSION, threadsAvail()); return 0; }
    try {
        Out hello;
        hello.tree = {{"t", "hello"}, {"version", CORE_VERSION}, {"supports", supportsList()}, {"limits", {{"threads", threadsAvail()}}}};
        send(hello);
    } catch (...) { return 1; }
    State S;
    for (;;) {
        uint32_t len;
        if (!readAll(&len, 4)) return 0;                        // the backend closed the pipe: done
        Msg m; m.raw.resize(len);
        if (len && !readAll(m.raw.data(), len)) return 0;
        Out o;
        json id = nullptr;
        try {
            decode(m);
            id = m.tree.value("id", json(nullptr));
            o.tree = {{"id", id}, {"ok", true}};
            handle(S, m, o);
        } catch (const std::bad_alloc &) {
            o = Out();
            o.tree = {{"id", id}, {"ok", false}, {"error", "out of memory: this computer has not enough free memory for this request"}, {"oom", true}};
        } catch (const std::exception &e) {
            o = Out();
            o.tree = {{"id", id}, {"ok", false}, {"error", e.what()}};
        }
        try { send(o); } catch (...) { return 1; }
    }
}
