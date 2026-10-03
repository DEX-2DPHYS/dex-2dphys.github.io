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

typedef struct dex_frame {
    uint32_t width;
    uint32_t height;
    const uint8_t *rgba;
} dex_frame;

typedef struct dex_plugin_api {
    uint32_t abi_version;
    const char *id;
    const char *name;
    const char *version;
    void *(*create)(void);
    void (*destroy)(void *inst);
    int (*advance)(void *inst, double dt);
    void (*on_message)(void *inst, const char *json, size_t len);
    const char *(*poll_message)(void *inst);
    int (*render)(void *inst, dex_frame *out);
} dex_plugin_api;

typedef const dex_plugin_api *(*dex_plugin_entry_fn)(void);

#ifdef __cplusplus
}
#endif
#endif
