// Compact SHA-1 and Base64, used only for the RFC 6455 WebSocket handshake.
#pragma once

#include <cstdint>
#include <cstring>
#include <string>

namespace dsw {

inline void sha1(const uint8_t *data, size_t len, uint8_t out[20]) {
    uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u,
                     0xC3D2E1F0u};
    uint64_t total = (uint64_t)len * 8;

    // Message + 0x80 pad + zeros + 8-byte big-endian bit length.
    size_t padded = ((len + 8) / 64 + 1) * 64;
    std::string buf((const char *)data, len);
    buf.resize(padded, '\0');
    buf[len] = (char)0x80;
    for (int i = 0; i < 8; i++)
        buf[padded - 1 - i] = (char)((total >> (8 * i)) & 0xff);

    auto rol = [](uint32_t v, int n) { return (v << n) | (v >> (32 - n)); };

    for (size_t chunk = 0; chunk < padded; chunk += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; i++) {
            const uint8_t *p = (const uint8_t *)buf.data() + chunk + i * 4;
            w[i] = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
                   ((uint32_t)p[2] << 8) | p[3];
        }
        for (int i = 16; i < 80; i++)
            w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; i++) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d);           k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d;               k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c)|(b & d)|(c & d); k = 0x8F1BBCDCu; }
            else { f = b ^ c ^ d;                           k = 0xCA62C1D6u; }
            uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    for (int i = 0; i < 5; i++) {
        out[i * 4]     = (uint8_t)(h[i] >> 24);
        out[i * 4 + 1] = (uint8_t)(h[i] >> 16);
        out[i * 4 + 2] = (uint8_t)(h[i] >> 8);
        out[i * 4 + 3] = (uint8_t)h[i];
    }
}

inline std::string base64(const uint8_t *data, size_t len) {
    static const char tbl[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((len + 2) / 3 * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16;
        if (i + 1 < len) v |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < len) v |= data[i + 2];
        out += tbl[(v >> 18) & 63];
        out += tbl[(v >> 12) & 63];
        out += (i + 1 < len) ? tbl[(v >> 6) & 63] : '=';
        out += (i + 2 < len) ? tbl[v & 63] : '=';
    }
    return out;
}

} // namespace dsw
