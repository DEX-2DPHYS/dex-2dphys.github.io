// dl_stub.cpp — satisfy libgomp.a's offload-plugin loader at static link.
//
// Linking libgomp STATICALLY (so the plugin DLL has no libgomp-1.dll
// dependency) pulls in gomp's target.o, whose device-offload plugin loader
// references dlopen/dlsym/dlclose/dlerror. MinGW has no libdl. Host-only
// OpenMP never calls that loader — it only runs when an offload DEVICE is
// requested — so empty stubs are safe and make the link self-contained.
extern "C" {
void *dlopen(const char *, int) { return nullptr; }
void *dlsym(void *, const char *) { return nullptr; }
int dlclose(void *) { return 0; }
char *dlerror(void) { return (char *)"static build: dynamic loading disabled"; }
}
