/*
 * dex_plugin.h — the DSW plugin ABI, version 1.
 *
 * A DEX plugin is a plain shared library (.so / .dll / .dylib) that exports
 * one symbol:
 *
 *     DEX_EXPORT const dex_plugin_api *dex_plugin_entry(void);
 *
 * returning a pointer to a static dex_plugin_api. The host never frees it.
 *
 * Threading contract — this is the whole reason the ABI can stay this small:
 * the host serializes ALL calls for one instance onto one worker thread
 * (create, advance, on_message, poll_message, render, destroy). A plugin
 * therefore needs no locks of its own. Whatever parallelism the plugin uses
 * internally (OpenMP, std::thread pools, SIMD) is its own business and is
 * invisible to the host.
 *
 * Memory contract: pointers returned by poll_message() and the buffer
 * referenced by render() remain valid until the next ABI call on the same
 * instance. The host copies what it needs before calling back in.
 */

#ifndef DEX_PLUGIN_H
#define DEX_PLUGIN_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DEX_ABI_VERSION 1u

#if defined(_WIN32)
#define DEX_EXPORT __declspec(dllexport)
#else
#define DEX_EXPORT __attribute__((visibility("default")))
#endif

/* One video-style frame of the experiment: tightly packed RGBA8,
 * row-major, top row first. The plugin owns the buffer. */
typedef struct dex_frame {
    uint32_t width;
    uint32_t height;
    const uint8_t *rgba; /* width * height * 4 bytes */
} dex_frame;

typedef struct dex_plugin_api {
    /* Must equal DEX_ABI_VERSION. The host refuses anything else. */
    uint32_t abi_version;

    const char *id;      /* stable identifier, e.g. "gray-scott"      */
    const char *name;    /* human name shown in the launcher           */
    const char *version; /* free-form, e.g. "1.0"                      */

    /* Instance lifecycle. One browser tab = one instance. */
    void *(*create)(void);
    void (*destroy)(void *inst);

    /* Called in a loop on the instance's worker thread. dt is wall-clock
     * seconds since the previous call (0 on the first call). Return nonzero
     * if the simulation did work (host calls again immediately); return 0
     * when idle/paused (host sleeps a few milliseconds first). */
    int (*advance)(void *inst, double dt);

    /* UI -> plugin. One UTF-8 JSON text message from the browser,
     * NUL-terminated; len excludes the terminator. Message vocabulary is
     * entirely plugin-defined. */
    void (*on_message)(void *inst, const char *json, size_t len);

    /* plugin -> UI. Return the next queued NUL-terminated JSON message, or
     * NULL if there is none. Drained by the host after every advance(). */
    const char *(*poll_message)(void *inst);

    /* Fill *out with the current frame; return 1, or return 0 if this
     * plugin has no frame to show (UIs can be message-only). Called only
     * when the browser asks for a frame, so render pace = display pace,
     * decoupled from simulation pace. */
    int (*render)(void *inst, dex_frame *out);
} dex_plugin_api;

typedef const dex_plugin_api *(*dex_plugin_entry_fn)(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* DEX_PLUGIN_H */
