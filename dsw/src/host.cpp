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

#include <cstdio>
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

std::vector<PluginInfo> Host::scan() const {
    std::vector<PluginInfo> out;
    for (const auto &id : list_subdirs(plugins_dir_)) {
        PluginInfo p;
        p.id = id;
        p.dir = plugins_dir_ + "/" + id;
        std::string manifest;
        if (read_file(p.dir + "/dex.json", manifest)) {
            p.name = json_get_string(manifest, "name");
            p.description = json_get_string(manifest, "description");
            p.accent = json_get_string(manifest, "accent");
            p.version = json_get_string(manifest, "version");
        }
        if (p.name.empty()) p.name = id;
        p.has_binary = file_exists(p.dir + "/" + id + dylib_suffix());
        p.has_ui = file_exists(p.dir + "/ui/index.html");
        if (p.has_ui || p.has_binary) out.push_back(p);
    }
    return out;
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
