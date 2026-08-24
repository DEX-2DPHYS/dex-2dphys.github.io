// Plugin discovery, loading, and per-session execution for DSW.
#pragma once

#include "../include/dex_plugin.h"
#include "net.h"

#include <mutex>
#include <string>
#include <vector>

namespace dsw {

// One installed plugin bundle: a folder holding
//   dex.json          metadata (name, description, accent, version)
//   <folder-name>.so  the compiled experiment (.dll / .dylib per platform)
//   ui/index.html     the browser front-end
// Bundles may sit anywhere below a plugins root; folders that are not
// themselves bundles act as categories, and the launcher mirrors that
// folder structure as a tree.
struct PluginInfo {
    std::string id;          // = bundle folder name, unique across both roots
    std::string dir;         // absolute-ish path to the bundle folder
    std::string path;        // path relative to its root, e.g. "waves/wave-tank"
    std::string root;        // "builtin" (ships with dsw) or "library" (user folder)
    std::string name;
    std::string description;
    std::string accent;      // CSS color for the launcher, optional
    std::string version;
    bool has_binary = false;
    bool has_ui = false;
};

class Host {
public:
    // builtin_dir: the plugins/ folder that ships beside the host (the two
    // example experiments live there). library_dir: the user's own plugin
    // folder — like a VST directory: it has a standard default location and
    // can be repointed at runtime (persisted in the settings file).
    Host(std::string builtin_dir, std::string library_dir)
        : builtin_dir_(std::move(builtin_dir)), library_dir_(std::move(library_dir)) {}

    // Re-scan both roots recursively. Cheap; called per /api/plugins request,
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

    const std::string &builtin_dir() const { return builtin_dir_; }
    std::string library_dir() const;
    // Repoint the library folder (created if missing). Persisted by caller.
    bool set_library_dir(const std::string &dir, std::string &err);

private:
    std::string builtin_dir_;
    mutable std::mutex lib_mu_;
    std::string library_dir_;
};

// Tiny flat-JSON helpers (enough for dex.json and API responses).
std::string json_get_string(const std::string &json, const std::string &key);
std::string json_escape(const std::string &s);

// Directory of the running executable (for locating web/ and plugins/).
std::string exe_dir();
bool file_exists(const std::string &path);
bool dir_exists(const std::string &path);
bool read_file(const std::string &path, std::string &out);
bool write_file(const std::string &path, const std::string &content);
bool make_dirs(const std::string &path);

// The user plugin folder's standard place (like the VST3 directory):
// Documents/DSW Plugins under the user's home.
std::string default_library_dir();
// Settings live per user (%APPDATA%/DSW or ~/.config/dsw), never per project.
std::string settings_file();
std::string load_saved_library_dir();          // "" if none saved
void save_library_dir(const std::string &dir);

// Platform shared-library suffix: ".so" / ".dll" / ".dylib".
const char *dylib_suffix();

} // namespace dsw
