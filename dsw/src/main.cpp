// dsw — Digital Science Workstation host.
// Serves a launcher, static plugin UIs, and one WebSocket session per
// running experiment. See ../README.md for the full picture.

#include "host.h"
#include "net.h"

#include <cstdio>
#include <cstring>
#include <string>

using namespace dsw;

static void serve_static_file(Conn &conn, const std::string &path) {
    std::string body;
    if (!read_file(path, body)) {
        conn.send_response(404, "text/plain; charset=utf-8", "not found\n");
        return;
    }
    conn.send_response(200, guess_content_type(path), body);
}

static std::string plugins_json(Host &host) {
    std::string out = "[";
    bool first = true;
    for (const auto &p : host.scan()) {
        if (!first) out += ",";
        first = false;
        out += "{\"id\":\"" + json_escape(p.id) + "\"";
        out += ",\"name\":\"" + json_escape(p.name) + "\"";
        out += ",\"description\":\"" + json_escape(p.description) + "\"";
        out += ",\"accent\":\"" + json_escape(p.accent) + "\"";
        out += ",\"version\":\"" + json_escape(p.version) + "\"";
        out += ",\"path\":\"" + json_escape(p.path) + "\"";
        out += ",\"root\":\"" + json_escape(p.root) + "\"";
        out += std::string(",\"ready\":") + (p.has_binary && p.has_ui ? "true" : "false");
        out += "}";
    }
    return out + "]";
}

static std::string config_json(Host &host) {
    return "{\"library\":\"" + json_escape(host.library_dir()) +
           "\",\"builtin\":\"" + json_escape(host.builtin_dir()) +
           "\",\"default\":\"" + json_escape(default_library_dir()) + "\"}";
}

int main(int argc, char **argv) {
    uint16_t port = 8090;
    std::string plugins_dir, web_dir;

    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&](const char *flag) -> std::string {
            if (i + 1 >= argc) {
                fprintf(stderr, "dsw: %s needs a value\n", flag);
                exit(2);
            }
            return argv[++i];
        };
        if (a == "--port" || a == "-p") port = (uint16_t)atoi(next("--port").c_str());
        else if (a == "--plugins") plugins_dir = next("--plugins");
        else if (a == "--web") web_dir = next("--web");
        else if (a == "--help" || a == "-h") {
            printf("usage: dsw [--port N] [--plugins DIR] [--web DIR]\n"
                   "  --port     TCP port on 127.0.0.1 (default 8090)\n"
                   "  --plugins  user plugin library folder for this run\n"
                   "             (default: the folder saved in settings, else\n"
                   "             Documents/DSW Plugins — created on first run)\n"
                   "  --web      launcher assets folder (default: ./web,\n"
                   "             else web/ next to the executable)\n");
            return 0;
        } else {
            fprintf(stderr, "dsw: unknown option %s (try --help)\n", a.c_str());
            return 2;
        }
    }

    // Built-in folders: prefer the working directory (developer flow), fall
    // back to the executable's directory (installed flow).
    auto resolve = [](std::string given, const char *name) {
        if (!given.empty()) return given;
        if (dir_exists(name)) return std::string(name);
        return exe_dir() + "/" + name;
    };
    std::string builtin_dir = resolve("", "plugins");
    web_dir = resolve(web_dir, "web");

    // The user plugin library, like a VST folder: --plugins for this run,
    // else the saved choice, else the standard place (created, with a note).
    bool cli_library = !plugins_dir.empty();
    std::string library_dir = cli_library ? plugins_dir : load_saved_library_dir();
    if (library_dir.empty()) library_dir = default_library_dir();
    if (!dir_exists(library_dir) && make_dirs(library_dir) && !cli_library)
        write_file(library_dir + "/README.txt",
                   "DSW plugin library\n"
                   "------------------\n"
                   "Drop experiment bundles in here (each bundle is a folder with\n"
                   "dex.json, the compiled core and a ui/ page). Subfolders are\n"
                   "shown as a tree in the launcher, so organise them freely.\n"
                   "The launcher's 'Plugin folder' setting can point somewhere else.\n");

    Host host(builtin_dir, library_dir);

    printf("dsw — Digital Science Workstation\n");
    printf("  built-in : %s%s\n", builtin_dir.c_str(),
           dir_exists(builtin_dir) ? "" : "  (missing)");
    printf("  library  : %s%s\n", library_dir.c_str(),
           cli_library ? "  (--plugins, not persisted)" : "");
    printf("  web      : %s\n", web_dir.c_str());
    printf("  open     : http://127.0.0.1:%u/\n", (unsigned)port);

    std::string err;
    bool ok = serve(port, [&](Conn &conn) {
        HttpRequest req;
        if (!conn.read_request(req)) return;

        // --- WebSocket: /ws/<plugin-id> -> one live experiment session
        if (req.path.rfind("/ws/", 0) == 0) {
            std::string id = req.path.substr(4);
            PluginInfo info;
            if (!host.find(id, info)) {
                conn.send_response(404, "text/plain; charset=utf-8",
                                   "unknown plugin\n");
                return;
            }
            std::string lerr;
            const dex_plugin_api *api = host.load(info, lerr);
            if (!api) {
                fprintf(stderr, "dsw: %s\n", lerr.c_str());
                conn.send_response(500, "text/plain; charset=utf-8", lerr + "\n");
                return;
            }
            if (!conn.ws_upgrade(req)) return;
            printf("dsw: session start  %s\n", id.c_str());
            host.run_session(api, conn);
            printf("dsw: session end    %s\n", id.c_str());
            return;
        }

        // --- Config: read, or repoint the plugin library folder
        if (req.path == "/api/config") {
            if (req.method == "POST") {
                std::string dir = json_get_string(req.body, "library");
                if (dir == "") dir = default_library_dir();   // "" = back to default
                std::string cerr_;
                if (!host.set_library_dir(dir, cerr_)) {
                    conn.send_response(400, "application/json; charset=utf-8",
                                       "{\"error\":\"" + json_escape(cerr_) + "\"}");
                    return;
                }
                save_library_dir(host.library_dir());
                printf("dsw: library -> %s\n", host.library_dir().c_str());
            }
            conn.send_response(200, "application/json; charset=utf-8",
                               config_json(host));
            return;
        }

        if (req.method != "GET" && req.method != "HEAD") {
            conn.send_response(400, "text/plain; charset=utf-8",
                               "GET only\n");
            return;
        }

        // --- API
        if (req.path == "/api/plugins") {
            conn.send_response(200, "application/json; charset=utf-8",
                               plugins_json(host));
            return;
        }

        // --- Plugin UI static files: /plugins/<id>/ui/...
        if (req.path.rfind("/plugins/", 0) == 0) {
            std::string rest = req.path.substr(9); // "<id>/ui/..."
            size_t slash = rest.find('/');
            std::string id = (slash == std::string::npos) ? rest
                                                          : rest.substr(0, slash);
            std::string sub = (slash == std::string::npos) ? ""
                                                           : rest.substr(slash + 1);
            PluginInfo info;
            if (sub.empty() || sub == "ui" || sub == "ui/")
                sub = "ui/index.html";
            // Only the bundle's ui/ tree is web-visible; never its binary,
            // source, or anything reached through "..".
            if (!host.find(id, info) ||
                sub.find("..") != std::string::npos ||
                sub.rfind("ui/", 0) != 0) {
                conn.send_response(404, "text/plain; charset=utf-8",
                                   "not found\n");
                return;
            }
            serve_static_file(conn, info.dir + "/" + sub);
            return;
        }

        // --- Built-in favicon (a web dir file of the same name wins)
        if (req.path == "/favicon.ico" && !file_exists(web_dir + "/favicon.ico")) {
            conn.send_response(200, "image/svg+xml",
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>"
                "<rect width='16' height='16' rx='3' fill='#131824'/>"
                "<circle cx='8' cy='8' r='4.5' fill='none' stroke='#5ac8fa' stroke-width='1.6'/>"
                "<circle cx='8' cy='8' r='1.6' fill='#3ddc97'/></svg>");
            return;
        }

        // --- Launcher assets
        if (req.path.find("..") != std::string::npos) {
            conn.send_response(404, "text/plain; charset=utf-8", "not found\n");
            return;
        }
        std::string p = (req.path == "/") ? "/index.html" : req.path;
        serve_static_file(conn, web_dir + p);
    }, err);

    if (!ok) {
        fprintf(stderr, "dsw: %s\n", err.c_str());
        return 1;
    }
    return 0;
}
