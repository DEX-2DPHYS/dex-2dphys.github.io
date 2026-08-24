// Plugin discovery, loading, and per-session execution for DSW.
#pragma once

#include "../include/dex_plugin.h"
#include "net.h"

#include <string>
#include <vector>

namespace dsw {

// One installed plugin bundle: a folder in the plugins directory holding
//   dex.json          metadata (name, description, accent, version)
//   <folder-name>.so  the compiled experiment (.dll / .dylib per platform)
//   ui/index.html     the browser front-end
struct PluginInfo {
    std::string id;          // = folder name
    std::string dir;         // absolute-ish path to the bundle folder
    std::string name;
    std::string description;
    std::string accent;      // CSS color for the launcher card, optional
    std::string version;
    bool has_binary = false;
    bool has_ui = false;
};

class Host {
public:
    explicit Host(std::string plugins_dir) : plugins_dir_(std::move(plugins_dir)) {}

    // Re-scan the plugins folder. Cheap; called per /api/plugins request,
    // which is what makes "drop a folder in, refresh the page" work.
    std::vector<PluginInfo> scan() const;

    // Find one bundle by id (nullptr-style: found=false if absent).
    bool find(const std::string &id, PluginInfo &out) const;

    // dlopen the bundle's binary and validate the ABI. Returns nullptr and
    // fills `err` on failure. Libraries stay loaded for the host's lifetime.
    const dex_plugin_api *load(const PluginInfo &info, std::string &err);

    // Run one experiment session over an upgraded WebSocket connection.
    // Blocks until the browser disconnects. Owns instance lifetime.
    void run_session(const dex_plugin_api *api, Conn &conn);

    const std::string &plugins_dir() const { return plugins_dir_; }

private:
    std::string plugins_dir_;
};

// Tiny flat-JSON helpers (enough for dex.json and API responses).
std::string json_get_string(const std::string &json, const std::string &key);
std::string json_escape(const std::string &s);

// Directory of the running executable (for locating web/ and plugins/).
std::string exe_dir();
bool file_exists(const std::string &path);
bool dir_exists(const std::string &path);
bool read_file(const std::string &path, std::string &out);

// Platform shared-library suffix: ".so" / ".dll" / ".dylib".
const char *dylib_suffix();

} // namespace dsw
