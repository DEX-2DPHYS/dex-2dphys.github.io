#include "host.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <thread>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dirent.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace dsw {

// ---------------------------------------------------------------- fs bits

bool file_exists(const std::string &path) {
#if defined(_WIN32)
    DWORD a = GetFileAttributesA(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
#else
    struct stat st;
    return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
#endif
}

bool dir_exists(const std::string &path) {
#if defined(_WIN32)
    DWORD a = GetFileAttributesA(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
#else
    struct stat st;
    return stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
#endif
}

bool read_file(const std::string &path, std::string &out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::ostringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

bool write_file(const std::string &path, const std::string &content) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    f << content;
    return (bool)f;
}

bool make_dirs(const std::string &path) {
    if (path.empty() || dir_exists(path)) return !path.empty();
    // walk the path, creating each missing component
    for (size_t i = 0; i <= path.size(); i++) {
        if (i != path.size() && path[i] != '/' && path[i] != '\\') continue;
        std::string part = path.substr(0, i ? i : path.size());
        if (i == 0 || part.empty()) continue;
        if (part.back() == ':') continue;               // drive letter "C:"
        if (dir_exists(part)) continue;
#if defined(_WIN32)
        if (!CreateDirectoryA(part.c_str(), nullptr) &&
            GetLastError() != ERROR_ALREADY_EXISTS) return false;
#else
        if (mkdir(part.c_str(), 0755) != 0 && errno != EEXIST) return false;
#endif
    }
    if (!dir_exists(path)) {
#if defined(_WIN32)
        if (!CreateDirectoryA(path.c_str(), nullptr) &&
            GetLastError() != ERROR_ALREADY_EXISTS) return false;
#else
        if (mkdir(path.c_str(), 0755) != 0 && errno != EEXIST) return false;
#endif
    }
    return dir_exists(path);
}

static std::string home_dir() {
#if defined(_WIN32)
    const char *p = getenv("USERPROFILE");
#else
    const char *p = getenv("HOME");
#endif
    return p ? p : ".";
}

static std::string native_seps(std::string p) {
#if defined(_WIN32)
    for (auto &c : p) if (c == '/') c = '\\';
#endif
    return p;
}

std::string default_library_dir() {
    // The standard user plugin place, like the VST3 directory: a folder with
    // a fixed, documented name under the user's documents.
    std::string docs = home_dir() + "/Documents";
    return native_seps((dir_exists(docs) ? docs : home_dir()) + "/DSW Plugins");
}

std::string settings_file() {
#if defined(_WIN32)
    const char *base = getenv("APPDATA");
    std::string dir = (base ? std::string(base) : home_dir()) + "/DSW";
#else
    const char *xdg = getenv("XDG_CONFIG_HOME");
    std::string dir = (xdg ? std::string(xdg) : home_dir() + "/.config") + "/dsw";
#endif
    return dir + "/settings.json";
}

std::string load_saved_library_dir() {
    std::string json;
    if (!read_file(settings_file(), json)) return "";
    return json_get_string(json, "library");
}

void save_library_dir(const std::string &dir) {
    std::string file = settings_file();
    size_t slash = file.find_last_of("/\\");
    if (slash != std::string::npos) make_dirs(file.substr(0, slash));
    write_file(file, "{\"library\":\"" + json_escape(dir) + "\"}\n");
}

std::string exe_dir() {
    char buf[4096];
#if defined(_WIN32)
    DWORD n = GetModuleFileNameA(nullptr, buf, sizeof buf);
    if (n == 0) return ".";
    std::string p(buf, n);
    size_t slash = p.find_last_of("\\/");
#elif defined(__APPLE__)
    uint32_t size = sizeof buf;
    if (_NSGetExecutablePath(buf, &size) != 0) return ".";
    std::string p(buf);
    size_t slash = p.find_last_of('/');
#else
    ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
    if (n <= 0) return ".";
    std::string p(buf, (size_t)n);
    size_t slash = p.find_last_of('/');
#endif
    return slash == std::string::npos ? "." : p.substr(0, slash);
}

const char *dylib_suffix() {
#if defined(_WIN32)
    return ".dll";
#elif defined(__APPLE__)
    return ".dylib";
#else
    return ".so";
#endif
}

static std::vector<std::string> list_subdirs(const std::string &dir) {
    std::vector<std::string> out;
#if defined(_WIN32)
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA((dir + "\\*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return out;
    do {
        std::string name = fd.cFileName;
        if (name == "." || name == "..") continue;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) out.push_back(name);
    } while (FindNextFileA(h, &fd));
    FindClose(h);
#else
    DIR *d = opendir(dir.c_str());
    if (!d) return out;
    while (dirent *e = readdir(d)) {
        std::string name = e->d_name;
        if (name == "." || name == "..") continue;
        if (dir_exists(dir + "/" + name)) out.push_back(name);
    }
    closedir(d);
#endif
    std::sort(out.begin(), out.end());
    return out;
}

// ---------------------------------------------------------------- JSON bits

std::string json_escape(const std::string &s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char b[8];
                snprintf(b, sizeof b, "\\u%04x", c);
                out += b;
            } else out += (char)c;
        }
    }
    return out;
}

// Pull "key": "value" out of a flat JSON object. Handles escaped quotes;
// deliberately not a full parser — dex.json is authored, not adversarial.
std::string json_get_string(const std::string &json, const std::string &key) {
    std::string needle = "\"" + key + "\"";
    size_t k = json.find(needle);
    if (k == std::string::npos) return "";
    size_t colon = json.find(':', k + needle.size());
    if (colon == std::string::npos) return "";
    size_t open = json.find('"', colon + 1);
    if (open == std::string::npos) return "";
    std::string out;
    for (size_t i = open + 1; i < json.size(); i++) {
        char c = json[i];
        if (c == '\\' && i + 1 < json.size()) {
            char e = json[++i];
            if (e == 'n') out += '\n';
            else if (e == 't') out += '\t';
            else out += e;
        } else if (c == '"') return out;
        else out += c;
    }
    return "";
}

// ---------------------------------------------------------------- scanning

// A folder is a bundle when it carries any of the three bundle files; any
// other folder is a category and is scanned deeper (folders inside a bundle
// — ui/, src/ — are never entered, so a bundle is always a leaf).
static bool is_bundle(const std::string &dir, const std::string &name) {
    return file_exists(dir + "/dex.json") ||
           file_exists(dir + "/" + name + dylib_suffix()) ||
           file_exists(dir + "/ui/index.html");
}

static void scan_tree(const std::string &base, const std::string &rel,
                      const char *root, int depth, std::vector<PluginInfo> &out) {
    if (depth > 6) return; // sanity: nobody nests plugins deeper than this
    const std::string here = rel.empty() ? base : base + "/" + rel;
    for (const auto &name : list_subdirs(here)) {
        const std::string r = rel.empty() ? name : rel + "/" + name;
        const std::string d = base + "/" + r;
        if (!is_bundle(d, name)) {
            scan_tree(base, r, root, depth + 1, out);
            continue;
        }
        PluginInfo p;
        p.id = name;
        p.dir = d;
        p.path = r;
        p.root = root;
        std::string manifest;
        if (read_file(p.dir + "/dex.json", manifest)) {
            p.name = json_get_string(manifest, "name");
            p.description = json_get_string(manifest, "description");
            p.accent = json_get_string(manifest, "accent");
            p.version = json_get_string(manifest, "version");
        }
        if (p.name.empty()) p.name = name;
        p.has_binary = file_exists(p.dir + "/" + name + dylib_suffix());
        p.has_ui = file_exists(p.dir + "/ui/index.html");
        if (p.has_ui || p.has_binary) out.push_back(p);
    }
}

std::vector<PluginInfo> Host::scan() const {
    std::vector<PluginInfo> out;
    scan_tree(builtin_dir_, "", "builtin", 0, out);
    scan_tree(library_dir(), "", "library", 0, out);
    // ids are the routing key, so they must be unique: first bundle wins
    // (built-ins first), later duplicates are dropped from the listing.
    std::vector<PluginInfo> uniq;
    for (auto &p : out) {
        bool dup = false;
        for (const auto &u : uniq) if (u.id == p.id) { dup = true; break; }
        if (!dup) uniq.push_back(std::move(p));
    }
    return uniq;
}

std::string Host::library_dir() const {
    std::lock_guard<std::mutex> lock(lib_mu_);
    return library_dir_;
}

bool Host::set_library_dir(const std::string &dir, std::string &err) {
    if (dir.empty()) { err = "empty path"; return false; }
    if (dir.find("..") != std::string::npos) { err = "no .. in the path"; return false; }
    std::string d = native_seps(dir);
    if (!make_dirs(d)) { err = "cannot create " + d; return false; }
    std::lock_guard<std::mutex> lock(lib_mu_);
    library_dir_ = d;
    return true;
}

bool Host::find(const std::string &id, PluginInfo &out) const {
    // ids come from URLs — refuse anything path-like before touching disk.
    if (id.empty() || id.find('/') != std::string::npos ||
        id.find('\\') != std::string::npos || id.find("..") != std::string::npos)
        return false;
    for (const auto &p : scan())
        if (p.id == id) {
            out = p;
            return true;
        }
    return false;
}

// ---------------------------------------------------------------- loading

const dex_plugin_api *Host::load(const PluginInfo &info, std::string &err) {
    static std::mutex mu;
    static std::map<std::string, const dex_plugin_api *> cache;
    std::lock_guard<std::mutex> lock(mu);

    auto it = cache.find(info.id);
    if (it != cache.end()) return it->second;

    std::string path = info.dir + "/" + info.id + dylib_suffix();
    if (!file_exists(path)) {
        err = "no binary at " + path;
        return nullptr;
    }
#if defined(_WIN32)
    HMODULE lib = LoadLibraryA(path.c_str());
    if (!lib) {
        err = "LoadLibrary failed for " + path;
        return nullptr;
    }
    auto entry = (dex_plugin_entry_fn)GetProcAddress(lib, "dex_plugin_entry");
#else
    void *lib = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!lib) {
        err = std::string("dlopen failed: ") + dlerror();
        return nullptr;
    }
    auto entry = (dex_plugin_entry_fn)dlsym(lib, "dex_plugin_entry");
#endif
    if (!entry) {
        err = path + " does not export dex_plugin_entry";
        return nullptr;
    }
    const dex_plugin_api *api = entry();
    if (!api || api->abi_version != DEX_ABI_VERSION) {
        err = path + " has ABI version " +
              std::to_string(api ? api->abi_version : 0) + ", host wants " +
              std::to_string(DEX_ABI_VERSION);
        return nullptr;
    }
    cache[info.id] = api;
    return api;
}

// ---------------------------------------------------------------- session

void Host::run_session(const dex_plugin_api *api, Conn &conn) {
    void *inst = api->create();
    if (!inst) return;

    std::mutex qmu;
    std::deque<std::string> inbox;       // JSON messages from the browser
    std::atomic<bool> running{true};
    std::atomic<int> frames_wanted{0};   // coalesced "f" requests

    // Worker: the one thread that ever touches the instance.
    std::thread worker([&]() {
        using clock = std::chrono::steady_clock;
        auto last = clock::now();
        bool first = true;
        while (running.load(std::memory_order_relaxed)) {
            // 1. deliver browser messages
            for (;;) {
                std::string msg;
                {
                    std::lock_guard<std::mutex> lock(qmu);
                    if (inbox.empty()) break;
                    msg = std::move(inbox.front());
                    inbox.pop_front();
                }
                api->on_message(inst, msg.c_str(), msg.size());
            }
            // 2. advance the simulation
            auto now = clock::now();
            double dt = first ? 0.0
                              : std::chrono::duration<double>(now - last).count();
            first = false;
            last = now;
            int worked = api->advance(inst, dt);
            // 3. flush plugin -> browser messages
            while (const char *m = api->poll_message(inst)) {
                if (!conn.ws_send_text(m)) {
                    running = false;
                    break;
                }
            }
            // 4. send a frame if the browser asked for one
            if (running && frames_wanted.exchange(0) > 0) {
                dex_frame f;
                if (api->render(inst, &f) && f.rgba && f.width && f.height) {
                    uint32_t w = f.width, h = f.height;
                    std::vector<uint8_t> pkt(12 + (size_t)w * h * 4);
                    memcpy(pkt.data(), "DXF1", 4);
                    memcpy(pkt.data() + 4, &w, 4); // little-endian hosts only,
                    memcpy(pkt.data() + 8, &h, 4); // matched by dex.js
                    memcpy(pkt.data() + 12, f.rgba, (size_t)w * h * 4);
                    if (!conn.ws_send_binary(pkt.data(), pkt.size()))
                        running = false;
                }
            }
            if (!worked)
                std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }
    });

    // Reader: this (connection) thread pumps the socket.
    std::vector<uint8_t> payload;
    bool is_text;
    while (running && conn.ws_read(payload, is_text)) {
        if (is_text) {
            if (payload.size() == 1 && payload[0] == 'f') {
                frames_wanted.fetch_add(1);
            } else {
                std::lock_guard<std::mutex> lock(qmu);
                inbox.emplace_back((const char *)payload.data(), payload.size());
            }
        }
        // binary from the browser: reserved, ignored in ABI v1
    }
    running = false;
    worker.join();
    api->destroy(inst);
}

} // namespace dsw
