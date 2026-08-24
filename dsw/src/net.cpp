#include "net.h"
#include "sha1b64.h"

#include <cstdio>
#include <cstring>
#include <thread>

#if defined(_WIN32)
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#define DSW_BAD_SOCKET INVALID_SOCKET
static void dsw_close_fd(dsw_socket_t fd) { closesocket(fd); }
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>
#define DSW_BAD_SOCKET (-1)
static void dsw_close_fd(dsw_socket_t fd) { ::close(fd); }
#endif

namespace dsw {

// ---------------------------------------------------------------- helpers

std::string url_decode(const std::string &s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size()) {
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int hi = hex(s[i + 1]), lo = hex(s[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out += (char)(hi * 16 + lo);
                i += 2;
                continue;
            }
        }
        out += (s[i] == '+') ? ' ' : s[i];
    }
    return out;
}

std::string guess_content_type(const std::string &path) {
    auto ends = [&](const char *ext) {
        size_t n = strlen(ext);
        return path.size() >= n &&
               path.compare(path.size() - n, n, ext) == 0;
    };
    if (ends(".html") || ends(".htm")) return "text/html; charset=utf-8";
    if (ends(".js") || ends(".mjs")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".json")) return "application/json; charset=utf-8";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".png")) return "image/png";
    if (ends(".jpg") || ends(".jpeg")) return "image/jpeg";
    if (ends(".gif")) return "image/gif";
    if (ends(".ico")) return "image/x-icon";
    if (ends(".wasm")) return "application/wasm";
    if (ends(".woff2")) return "font/woff2";
    if (ends(".txt") || ends(".md")) return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

// ---------------------------------------------------------------- Conn

bool Conn::read_more() {
    char tmp[16384];
#if defined(_WIN32)
    int n = recv(fd_, tmp, (int)sizeof tmp, 0);
#else
    ssize_t n = recv(fd_, tmp, sizeof tmp, 0);
#endif
    if (n <= 0) return false;
    rbuf_.append(tmp, (size_t)n);
    return true;
}

bool Conn::read_exact(void *dst, size_t len) {
    while (rbuf_.size() < len)
        if (!read_more()) return false;
    memcpy(dst, rbuf_.data(), len);
    rbuf_.erase(0, len);
    return true;
}

bool Conn::write_all(const void *data, size_t len) {
    const char *p = (const char *)data;
    while (len > 0) {
#if defined(_WIN32)
        int n = send(fd_, p, (int)len, 0);
#else
        ssize_t n = send(fd_, p, len, MSG_NOSIGNAL);
#endif
        if (n <= 0) return false;
        p += n;
        len -= (size_t)n;
    }
    return true;
}

bool Conn::read_request(HttpRequest &req) {
    // Accumulate until blank line.
    size_t hdr_end;
    while ((hdr_end = rbuf_.find("\r\n\r\n")) == std::string::npos) {
        if (rbuf_.size() > 65536) return false; // header flood
        if (!read_more()) return false;
    }
    std::string head = rbuf_.substr(0, hdr_end);
    rbuf_.erase(0, hdr_end + 4);

    req.headers.clear();
    req.body.clear();

    // Request line.
    size_t eol = head.find("\r\n");
    std::string line = head.substr(0, eol);
    size_t sp1 = line.find(' '), sp2 = line.rfind(' ');
    if (sp1 == std::string::npos || sp2 <= sp1) return false;
    req.method = line.substr(0, sp1);
    std::string target = line.substr(sp1 + 1, sp2 - sp1 - 1);
    size_t q = target.find('?');
    req.query = (q == std::string::npos) ? "" : target.substr(q + 1);
    req.path = url_decode(target.substr(0, q));

    // Headers.
    size_t pos = (eol == std::string::npos) ? head.size() : eol + 2;
    while (pos < head.size()) {
        size_t end = head.find("\r\n", pos);
        if (end == std::string::npos) end = head.size();
        std::string h = head.substr(pos, end - pos);
        pos = end + 2;
        size_t colon = h.find(':');
        if (colon == std::string::npos) continue;
        std::string key = h.substr(0, colon);
        for (auto &c : key) c = (char)tolower((unsigned char)c);
        size_t v = colon + 1;
        while (v < h.size() && h[v] == ' ') v++;
        req.headers[key] = h.substr(v);
    }

    // Body (Content-Length only; that covers everything DSW accepts).
    auto it = req.headers.find("content-length");
    if (it != req.headers.end()) {
        size_t len = (size_t)strtoull(it->second.c_str(), nullptr, 10);
        if (len > (64u << 20)) return false;
        req.body.resize(len);
        if (len && !read_exact(&req.body[0], len)) return false;
    }
    return true;
}

void Conn::send_response(int status, const std::string &content_type,
                         const std::string &body,
                         const std::string &extra_headers) {
    const char *text = status == 200   ? "OK"
                       : status == 404 ? "Not Found"
                       : status == 400 ? "Bad Request"
                                       : "Error";
    char head[512];
    snprintf(head, sizeof head,
             "HTTP/1.1 %d %s\r\n"
             "Content-Type: %s\r\n"
             "Content-Length: %zu\r\n"
             "Cache-Control: no-cache\r\n"
             "Connection: close\r\n%s\r\n",
             status, text, content_type.c_str(), body.size(),
             extra_headers.c_str());
    write_str(head);
    write_str(body);
}

void Conn::close() {
    if (fd_ != (dsw_socket_t)DSW_BAD_SOCKET) {
        dsw_close_fd(fd_);
        fd_ = (dsw_socket_t)DSW_BAD_SOCKET;
    }
}

// ---------------------------------------------------------------- WebSocket

bool Conn::ws_upgrade(const HttpRequest &req) {
    auto key = req.headers.find("sec-websocket-key");
    if (key == req.headers.end()) return false;
    std::string accept_src =
        key->second + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    uint8_t digest[20];
    sha1((const uint8_t *)accept_src.data(), accept_src.size(), digest);
    std::string accept = base64(digest, 20);
    std::string resp =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
    return write_str(resp);
}

bool Conn::ws_read(std::vector<uint8_t> &payload, bool &is_text) {
    payload.clear();
    uint8_t first_opcode = 0;
    for (;;) {
        uint8_t hdr[2];
        if (!read_exact(hdr, 2)) return false;
        bool fin = (hdr[0] & 0x80) != 0;
        uint8_t opcode = hdr[0] & 0x0f;
        bool masked = (hdr[1] & 0x80) != 0;
        uint64_t len = hdr[1] & 0x7f;
        if (len == 126) {
            uint8_t ext[2];
            if (!read_exact(ext, 2)) return false;
            len = ((uint64_t)ext[0] << 8) | ext[1];
        } else if (len == 127) {
            uint8_t ext[8];
            if (!read_exact(ext, 8)) return false;
            len = 0;
            for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
        }
        if (len > (256ull << 20)) return false; // 256 MB sanity cap
        uint8_t mask[4] = {0, 0, 0, 0};
        if (masked && !read_exact(mask, 4)) return false;

        std::vector<uint8_t> data(len);
        if (len && !read_exact(data.data(), (size_t)len)) return false;
        if (masked)
            for (uint64_t i = 0; i < len; i++) data[i] ^= mask[i & 3];

        if (opcode == 0x8) { // close
            ws_send_frame(0x8, data.data(), data.size() > 125 ? 0 : data.size());
            return false;
        }
        if (opcode == 0x9) { // ping -> pong
            if (!ws_send_frame(0xA, data.data(), data.size())) return false;
            continue;
        }
        if (opcode == 0xA) continue; // pong

        if (opcode == 0x1 || opcode == 0x2) first_opcode = opcode;
        else if (opcode != 0x0) return false; // unknown opcode

        payload.insert(payload.end(), data.begin(), data.end());
        if (fin) {
            is_text = (first_opcode == 0x1);
            return true;
        }
    }
}

bool Conn::ws_send_frame(uint8_t opcode, const uint8_t *data, size_t len) {
    std::lock_guard<std::mutex> lock(wmu_);
    uint8_t hdr[10];
    size_t n = 0;
    hdr[n++] = (uint8_t)(0x80 | opcode);
    if (len < 126) {
        hdr[n++] = (uint8_t)len;
    } else if (len < 65536) {
        hdr[n++] = 126;
        hdr[n++] = (uint8_t)(len >> 8);
        hdr[n++] = (uint8_t)len;
    } else {
        hdr[n++] = 127;
        for (int i = 7; i >= 0; i--) hdr[n++] = (uint8_t)(len >> (8 * i));
    }
    if (!write_all(hdr, n)) return false;
    return len == 0 || write_all(data, len);
}

bool Conn::ws_send_text(const std::string &s) {
    return ws_send_frame(0x1, (const uint8_t *)s.data(), s.size());
}

bool Conn::ws_send_binary(const uint8_t *data, size_t len) {
    return ws_send_frame(0x2, data, len);
}

void Conn::ws_close() {
    ws_send_frame(0x8, nullptr, 0);
    close();
}

// ---------------------------------------------------------------- serve

bool serve(uint16_t port, const std::function<void(Conn &)> &handler,
           std::string &err) {
#if defined(_WIN32)
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#else
    signal(SIGPIPE, SIG_IGN);
#endif
    dsw_socket_t srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv == (dsw_socket_t)DSW_BAD_SOCKET) {
        err = "socket() failed";
        return false;
    }
    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, (const char *)&one, sizeof one);

    sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // localhost only, on purpose
    if (bind(srv, (sockaddr *)&addr, sizeof addr) != 0) {
        err = "could not bind 127.0.0.1:" + std::to_string(port) +
              " (already in use?)";
        dsw_close_fd(srv);
        return false;
    }
    if (listen(srv, 16) != 0) {
        err = "listen() failed";
        dsw_close_fd(srv);
        return false;
    }

    for (;;) {
        dsw_socket_t client = accept(srv, nullptr, nullptr);
        if (client == (dsw_socket_t)DSW_BAD_SOCKET) continue;
        int nd = 1;
        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, (const char *)&nd,
                   sizeof nd);
        std::thread([client, handler]() {
            Conn conn(client);
            handler(conn);
        }).detach();
    }
}

} // namespace dsw
