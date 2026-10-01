#pragma once

#include <cstdlib>
#include <string>
#include <vector>

namespace dexmsg {

inline size_t value_pos(const std::string &json, const std::string &key) {
    const std::string needle = "\"" + key + "\"";
    size_t k = json.find(needle);
    if (k == std::string::npos) return k;
    k = json.find(':', k + needle.size());
    if (k == std::string::npos) return k;
    do { ++k; } while (k < json.size() && (json[k] == ' ' || json[k] == '\t' || json[k] == '\r' || json[k] == '\n'));
    return k;
}

inline std::string get_str(const std::string &json, const std::string &key,
                           const std::string &fallback = "") {
    size_t p = value_pos(json, key);
    if (p == std::string::npos || p >= json.size() || json[p] != '"') return fallback;
    std::string out;
    for (++p; p < json.size(); ++p) {
        char c = json[p];
        if (c == '"') return out;
        if (c == '\\' && p + 1 < json.size()) {
            char e = json[++p];
            if (e == 'n') out.push_back('\n');
            else if (e == 'r') out.push_back('\r');
            else if (e == 't') out.push_back('\t');
            else out.push_back(e);
        } else out.push_back(c);
    }
    return fallback;
}

inline double get_num(const std::string &json, const std::string &key,
                      double fallback = 0.0) {
    size_t p = value_pos(json, key);
    if (p == std::string::npos || p >= json.size()) return fallback;
    char *end = nullptr;
    const double v = std::strtod(json.c_str() + p, &end);
    return end && end != json.c_str() + p ? v : fallback;
}

inline std::vector<float> get_array(const std::string &json, const std::string &key) {
    std::vector<float> out;
    size_t p = value_pos(json, key);
    if (p == std::string::npos || p >= json.size() || json[p] != '[') return out;
    ++p;
    while (p < json.size()) {
        while (p < json.size() && (json[p] == ' ' || json[p] == ',' || json[p] == '\r' || json[p] == '\n')) ++p;
        if (p >= json.size() || json[p] == ']') break;
        char *end = nullptr;
        float v = std::strtof(json.c_str() + p, &end);
        if (!end || end == json.c_str() + p) break;
        out.push_back(v);
        p = static_cast<size_t>(end - json.c_str());
    }
    return out;
}

inline std::string type_of(const std::string &json) { return get_str(json, "t"); }

} // namespace dexmsg
