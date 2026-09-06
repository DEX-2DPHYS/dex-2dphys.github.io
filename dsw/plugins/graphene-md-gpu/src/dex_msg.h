// dex_msg.h — optional header-only helpers for DEX plugin authors (C++).
// Enough JSON to read the flat control messages a DSW UI sends
// (e.g. {"t":"set","k":"feed","v":0.034}); not a general parser.
#pragma once

#include <cstdlib>
#include <string>

namespace dexmsg {

// Value of "key": "..." as a string ("" if absent).
inline std::string get_str(const std::string &json, const std::string &key) {
    std::string needle = "\"" + key + "\"";
    size_t k = json.find(needle);
    if (k == std::string::npos) return "";
    size_t colon = json.find(':', k + needle.size());
    if (colon == std::string::npos) return "";
    size_t open = json.find('"', colon + 1);
    if (open == std::string::npos) return "";
    size_t close = json.find('"', open + 1);
    if (close == std::string::npos) return "";
    return json.substr(open + 1, close - open - 1);
}

// Value of "key": <number> as double; `fallback` if absent/malformed.
inline double get_num(const std::string &json, const std::string &key,
                      double fallback = 0.0) {
    std::string needle = "\"" + key + "\"";
    size_t k = json.find(needle);
    if (k == std::string::npos) return fallback;
    size_t colon = json.find(':', k + needle.size());
    if (colon == std::string::npos) return fallback;
    size_t p = colon + 1;
    while (p < json.size() && (json[p] == ' ' || json[p] == '\t')) p++;
    if (p >= json.size()) return fallback;
    char *end = nullptr;
    double v = strtod(json.c_str() + p, &end);
    return (end && end != json.c_str() + p) ? v : fallback;
}

// The conventional message type field.
inline std::string type_of(const std::string &json) { return get_str(json, "t"); }

} // namespace dexmsg
