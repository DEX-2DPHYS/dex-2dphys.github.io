// EBL Workbench — native core for the DSW plugin.
//
// The page is the SAME build as the standalone HTML. It asks this core first and falls back
// to its own Web Workers for any request type the core does not list in its hello, so the two
// always offer the same functions. Protocol (text, JSON):
//   core -> page  {t:"hello", supports:[...], limits:{...}, version}
//   page -> core  {t:"req", id, type, ...payload}          (exposure-worker protocol verbatim)
//                 {t:"project", version, project}           (sent before the first native request)
//   core -> page  {t:"res", id, ok, result, bin:[{key,offset,count,type?}]} | {t:"res", id, ok:false, error}
//                 (offset in 4-byte words from the start of the data; type "f64" or "i32", default float32)
//                 {t:"progress", id, p}
// Binary parts travel as the DSW "frame": the host prefixes DXF1 + w + h; our bytes are
//   "EBW1" u32le id, then Float32 data. The page asks for a frame ("f") only when a res
//   announced one, because the host sends nothing at all when render() returns 0.
//
// Build: powershell -File test\build.ps1  (MinGW g++, static, OpenMP)

#include "dex_plugin.h"
#include "json.hpp"
#include "mc.h"
#include "sr.h"
#include "pec.h"
#include "ompcompat.h"

#include <cstring>
#include <deque>
#include <string>
#include <vector>

using json = nlohmann_lmp::json;

namespace {

const char *CORE_VERSION = "0.4";

json supportsList() { return json::array({"echo", "mcInit", "mcBatches", "srRows", "pecSolve"}); }
json limitsObj() { return {{"threads", std::max(1, omp_get_num_procs() - 1)}}; }

struct Instance {
    std::deque<std::string> outbox;          // JSON text to the page
    std::string sending;                     // keeps poll_message's pointer alive
    std::deque<std::vector<uint8_t>> frames; // binary results, FIFO, matched to res by id
    std::vector<uint8_t> current;            // keeps render's pointer alive
    json project;                            // last project received
    long projectVersion = -1;
    mc::Transport mc;                         // Monte Carlo transport for the current run
    sr::Rows kept;                            // the short-range operator kept for pecSolve (srRows with keep)
    int keptToken = 0;
};

void say(Instance *I, const json &j) { I->outbox.push_back(j.dump()); }

// Queue a binary result: "EBW1" + id + float32 data, padded to a whole RGBA pixel.
void queueFloats(Instance *I, uint32_t id, const std::vector<float> &data) {
    std::vector<uint8_t> f(8 + data.size() * 4);
    memcpy(f.data(), "EBW1", 4);
    memcpy(f.data() + 4, &id, 4);
    if (!data.empty()) memcpy(f.data() + 8, data.data(), data.size() * 4);
    I->frames.push_back(std::move(f));
}

// Queue a binary result made of typed parts, each starting on a 4-byte word.
struct Part { std::string key, type; std::vector<uint8_t> bytes; size_t count; };
void queueParts(Instance *I, uint32_t id, std::vector<Part> &parts, json &bin) {
    size_t words = 0;
    for (auto &p : parts) words += (p.bytes.size() + 3) / 4;
    std::vector<uint8_t> f(8 + words * 4, 0);
    memcpy(f.data(), "EBW1", 4);
    memcpy(f.data() + 4, &id, 4);
    size_t at = 0;
    bin = json::array();
    for (auto &p : parts) {
        if (!p.bytes.empty()) memcpy(f.data() + 8 + at * 4, p.bytes.data(), p.bytes.size());
        bin.push_back({{"key", p.key}, {"offset", at}, {"count", p.count}, {"type", p.type}});
        at += (p.bytes.size() + 3) / 4;
    }
    I->frames.push_back(std::move(f));
}
template <class T> Part part(const std::string &key, const std::string &type, const std::vector<T> &v) {
    Part p{key, type, std::vector<uint8_t>(v.size() * sizeof(T)), v.size()};
    if (!v.empty()) memcpy(p.bytes.data(), v.data(), p.bytes.size());
    return p;
}

}  // namespace
#include "pecjson.h"
namespace {

void handleRequest(Instance *I, const json &m) {
    const uint32_t id = m.value("id", 0u);
    const std::string type = m.value("type", std::string());
    try {
        if (type == "echo") {
            // transport self-test: n floats i*0.5 back through the frame channel
            const size_t n = m.value("n", (size_t)0);
            std::vector<float> d(n);
            double sum = 0;
            for (size_t i = 0; i < n; i++) { d[i] = (float)(i * 0.5); sum += d[i]; }
            queueFloats(I, id, d);
            say(I, {{"t", "res"}, {"id", id}, {"ok", true},
                    {"result", {{"n", n}, {"sum", sum}, {"text", m.value("text", std::string())}}},
                    {"bin", json::array({{{"key", "data"}, {"offset", 0}, {"count", n}}})}});
            return;
        }
        if (type == "mcInit") {
            I->mc = mc::Transport();
            I->mc.init(m.at("cfg"), m.at("tables"));
            say(I, {{"t", "res"}, {"id", id}, {"ok", true}, {"result", {{"nR", I->mc.nR}, {"nz", I->mc.nz}, {"threads", limitsObj()["threads"]}}}});
            return;
        }
        if (type == "mcBatches") {
            json r = I->mc.runBatches(m.at("perBatch").get<int>(), m.value("seed", 1u), m.at("from").get<int>(), m.at("count").get<int>(), m.value("threads", 0));
            say(I, {{"t", "res"}, {"id", id}, {"ok", true}, {"result", std::move(r)}});
            return;
        }
        if (type == "srRows") {
            // the fractured correction's heavy part: targets (dose at points) or operator rows (sr.h)
            sr::Kernel K;
            for (auto &t : m.at("terms")) { K.w.push_back(t.at(0).get<double>()); K.s.push_back(t.at(1).get<double>()); }
            K.exact = m.value("exact", true); K.total = m.at("total").get<double>(); K.rMax = m.at("rMax").get<double>(); K.eps = m.value("eps", 1e-10);
            sr::Polys P;
            const json &pj = m.at("polys");
            P.off = pj.at("off").get<std::vector<int32_t>>(); P.xy = pj.at("xy").get<std::vector<double>>();
            P.dose = pj.at("dose").get<std::vector<double>>(); P.key = pj.at("key").get<std::vector<int32_t>>();
            if (P.off.size() != P.dose.size() + 1 || P.key.size() != P.dose.size() || (P.off.empty() ? 0 : (size_t)P.off.back() * 2) != P.xy.size()) throw std::runtime_error("srRows: inconsistent polygons");
            const std::vector<double> pts = m.at("pts").get<std::vector<double>>();
            const int threads = std::max(1, omp_get_num_procs() - 1);
            const std::string kind = m.at("kind").get<std::string>();
            std::vector<Part> parts; json bin;
            if (kind != "targets" && m.value("keep", false)) {
                // the correction's operator stays here for the solve; only its size goes back
                I->kept = sr::rows(K, P, pts, threads);
                I->keptToken++;
                say(I, {{"t", "res"}, {"id", id}, {"ok", true}, {"result", {{"kept", I->keptToken}, {"entries", I->kept.val.size()}, {"points", pts.size() / 2}, {"threads", threads}}}});
                return;
            }
            if (kind == "targets") parts.push_back(part("values", "f64", sr::doseAt(K, P, pts, threads)));
            else { sr::Rows r = sr::rows(K, P, pts, threads); parts.push_back(part("ptr", "i32", r.ptr)); parts.push_back(part("idx", "i32", r.idx)); parts.push_back(part("val", "f64", r.val)); }
            queueParts(I, id, parts, bin);
            say(I, {{"t", "res"}, {"id", id}, {"ok", true}, {"result", {{"threads", threads}, {"points", pts.size() / 2}, {"polys", P.dose.size()}}}, {"bin", bin}});
            return;
        }
        if (type == "pecSolve") {
            // the global solve and the dose classes with the operator kept above (pec.h)
            if (m.value("token", -1) != I->keptToken || I->kept.ptr.empty()) throw std::runtime_error("pecSolve: the short-range operator is no longer here");
            pec::Problem P = parseProblem(m);
            pec::LR L = parseLR(m);
            if ((int)I->kept.ptr.size() != P.nP + 1) throw std::runtime_error("pecSolve: the operator was built for other points");
            const int threads = std::max(1, omp_get_num_procs() - 1);
            pec::Result R = pec::solve(P, I->kept, L, threads);
            std::vector<Part> parts; json bin;
            parts.push_back(part("write", "f64", R.write)); parts.push_back(part("cls", "i32", R.cls)); parts.push_back(part("classes", "f64", R.classes));
            parts.push_back(part("gotQ", "f64", R.gotQ)); parts.push_back(part("history", "f64", R.history));
            queueParts(I, id, parts, bin);
            say(I, {{"t", "res"}, {"id", id}, {"ok", true}, {"result", {{"it", R.it}, {"err", R.err}, {"lo", R.lo}, {"hi", R.hi}, {"threads", threads}}}, {"bin", bin}});
            return;
        }
        say(I, {{"t", "res"}, {"id", id}, {"ok", false}, {"error", "unsupported request " + type}});
    } catch (const std::exception &e) {
        say(I, {{"t", "res"}, {"id", id}, {"ok", false}, {"error", e.what()}});
    }
}

void *create() {
    auto *I = new Instance();
    say(I, {{"t", "hello"}, {"version", CORE_VERSION},
            {"supports", supportsList()}, {"limits", limitsObj()}});
    return I;
}
void destroy(void *p) { delete static_cast<Instance *>(p); }
int advance(void *, double) { return 0; }

void on_message(void *p, const char *s, size_t len) {
    auto *I = static_cast<Instance *>(p);
    json m = json::parse(s, s + len, nullptr, false);
    if (m.is_discarded() || !m.is_object()) return;
    const std::string t = m.value("t", std::string());
    if (t == "req") handleRequest(I, m);
    else if (t == "project") { I->project = std::move(m["project"]); I->projectVersion = m.value("version", -1L); }
    else if (t == "hello?") say(I, {{"t", "hello"}, {"version", CORE_VERSION}, {"supports", supportsList()}, {"limits", limitsObj()}});
}

const char *poll_message(void *p) {
    auto *I = static_cast<Instance *>(p);
    if (I->outbox.empty()) return nullptr;
    I->sending = std::move(I->outbox.front());
    I->outbox.pop_front();
    return I->sending.c_str();
}

int render(void *p, dex_frame *out) {
    auto *I = static_cast<Instance *>(p);
    if (I->frames.empty()) return 0;
    I->current = std::move(I->frames.front());
    I->frames.pop_front();
    while (I->current.size() % 4) I->current.push_back(0);
    out->width = (uint32_t)(I->current.size() / 4);
    out->height = 1;
    out->rgba = I->current.data();
    return 1;
}

const dex_plugin_api API = {DEX_ABI_VERSION, "ebl-workbench", "EBL Workbench", "0.1",
                            create, destroy, advance, on_message, poll_message, render};
} // namespace

extern "C" DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void) { return &API; }
