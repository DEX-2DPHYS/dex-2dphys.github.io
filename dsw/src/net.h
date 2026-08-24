// Minimal HTTP/1.1 + WebSocket (RFC 6455) server plumbing for DSW.
// POSIX sockets on Linux/macOS, Winsock2 on Windows. No dependencies.
#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <winsock2.h>
typedef SOCKET dsw_socket_t;
#else
typedef int dsw_socket_t;
#endif

namespace dsw {

struct HttpRequest {
    std::string method;
    std::string path;    // decoded, query string stripped
    std::string query;   // raw text after '?', "" if none
    std::map<std::string, std::string> headers; // keys lowercased
    std::string body;
};

// A connected client socket with buffered reads.
class Conn {
public:
    explicit Conn(dsw_socket_t fd) : fd_(fd) {}
    ~Conn() { close(); }
    Conn(const Conn &) = delete;
    Conn &operator=(const Conn &) = delete;

    // Parse one HTTP request off the socket. Returns false on EOF/error.
    bool read_request(HttpRequest &req);

    bool write_all(const void *data, size_t len);
    bool write_str(const std::string &s) { return write_all(s.data(), s.size()); }

    void send_response(int status, const std::string &content_type,
                       const std::string &body,
                       const std::string &extra_headers = "");

    // --- WebSocket, valid after a successful upgrade handshake ---
    // Complete the handshake for a request already parsed by read_request.
    bool ws_upgrade(const HttpRequest &req);
    // Read one message (handles ping/pong/fragmentation internally).
    // Returns false on close/error. is_text tells text vs binary.
    bool ws_read(std::vector<uint8_t> &payload, bool &is_text);
    bool ws_send_text(const std::string &s);
    bool ws_send_binary(const uint8_t *data, size_t len);
    void ws_close();

    void close();
    bool alive() const { return fd_ != (dsw_socket_t)-1; }

private:
    bool read_more();
    bool read_exact(void *dst, size_t len);
    bool ws_send_frame(uint8_t opcode, const uint8_t *data, size_t len);

    dsw_socket_t fd_;
    std::string rbuf_; // bytes read but not yet consumed
    std::mutex wmu_;   // one WebSocket frame on the wire at a time
};

// Blocking accept loop; spawns one thread per connection running `handler`.
// Returns false if the port could not be bound.
bool serve(uint16_t port, const std::function<void(Conn &)> &handler,
           std::string &err);

std::string url_decode(const std::string &s);
std::string guess_content_type(const std::string &path);

} // namespace dsw
