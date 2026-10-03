// clmd.h — OpenCL backend for the graphene-md classic engine.
//
// Design constraints, in order:
//   * NO build-time dependency. This machine has no CUDA toolkit and no
//     OpenCL SDK — but OpenCL compiles kernels AT RUNTIME through the
//     driver, so the only thing needed is the OpenCL.dll every GPU driver
//     already installs. It is loaded with LoadLibrary and the ~20 entry
//     points resolved by hand; if any of that fails the plugin simply says
//     so and the CPU path is used. The DLL never fails to load for lack of
//     a GPU.
//   * The physics is the SAME physics. Every kernel below is a line-for-line
//     port of the corresponding loop in plugin.cpp — same Morse, same angle
//     gather with packed roles, same bending umbrella, same LJ, same caps.
//     The one structural difference: the sheet–substrate LJ walks the 2D
//     substrate cell list directly instead of through Verlet lists. The cell
//     list depends only on substrate x,y, which never change (lifts are
//     z-only), so it is built once on the CPU and uploaded once — no
//     rebuild machinery on the GPU at all, at the cost of ~2x more distance
//     tests, which the GPU does not feel.
//   * Precision is float32. The T1000's float64 rate is 1/32 of float32, so
//     double on this GPU would be slower than the CPU. For a damped,
//     velocity-capped toy model at Angstrom scales, float32 force error
//     (~1e-6 relative) is far below the model error; energies are
//     accumulated per atom in float and summed in double on the CPU.
//
// Division of labour per batch of steps (one advance() call):
//   GPU: substrate lift profile, bending precompute, all forces, both
//        half-kicks, the drift, edge pinning.
//   CPU: the elevation state machine (a scalar), bond break/re-form (needs
//        positions; runs once per batch instead of once per step — bonds
//        take many steps to stretch, so this is invisible), registry
//        colouring, and the wire protocol. Positions come back once per
//        batch; per-atom v^2 and potential energy come back with them.

#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace clmd {

// ---------------------------------------------------------------- mini-CL
// Just enough of the OpenCL 1.2 API, declared by hand so no headers are
// needed. All the handle types are opaque pointers.

typedef void *cl_platform_id, *cl_device_id, *cl_context, *cl_command_queue,
    *cl_program, *cl_kernel, *cl_mem;
typedef int32_t cl_int;
typedef uint32_t cl_uint;
typedef uint64_t cl_ulong, cl_bitfield;
typedef cl_bitfield cl_device_type, cl_mem_flags, cl_command_queue_properties;
typedef intptr_t cl_context_properties;

#define CL_SUCCESS 0
#define CL_DEVICE_TYPE_GPU (1 << 2)
#define CL_MEM_READ_WRITE (1 << 0)
#define CL_MEM_READ_ONLY (1 << 2)
#define CL_MEM_COPY_HOST_PTR (1 << 5)
#define CL_DEVICE_NAME 0x102B
#define CL_DEVICE_MAX_COMPUTE_UNITS 0x1002
#define CL_PROGRAM_BUILD_LOG 0x1183

#if defined(_WIN32)
#define CLMD_CALL __stdcall
#else
#define CLMD_CALL
#endif

struct Api {
    cl_int(CLMD_CALL *GetPlatformIDs)(cl_uint, cl_platform_id *, cl_uint *);
    cl_int(CLMD_CALL *GetDeviceIDs)(cl_platform_id, cl_device_type, cl_uint,
                                    cl_device_id *, cl_uint *);
    cl_int(CLMD_CALL *GetDeviceInfo)(cl_device_id, cl_uint, size_t, void *, size_t *);
    cl_context(CLMD_CALL *CreateContext)(const cl_context_properties *, cl_uint,
                                         const cl_device_id *, void *, void *, cl_int *);
    cl_command_queue(CLMD_CALL *CreateCommandQueue)(cl_context, cl_device_id,
                                                    cl_command_queue_properties, cl_int *);
    cl_program(CLMD_CALL *CreateProgramWithSource)(cl_context, cl_uint, const char **,
                                                   const size_t *, cl_int *);
    cl_int(CLMD_CALL *BuildProgram)(cl_program, cl_uint, const cl_device_id *,
                                    const char *, void *, void *);
    cl_int(CLMD_CALL *GetProgramBuildInfo)(cl_program, cl_device_id, cl_uint, size_t,
                                           void *, size_t *);
    cl_kernel(CLMD_CALL *CreateKernel)(cl_program, const char *, cl_int *);
    cl_mem(CLMD_CALL *CreateBuffer)(cl_context, cl_mem_flags, size_t, void *, cl_int *);
    cl_int(CLMD_CALL *EnqueueWriteBuffer)(cl_command_queue, cl_mem, cl_uint, size_t,
                                          size_t, const void *, cl_uint, const void *, void *);
    cl_int(CLMD_CALL *EnqueueReadBuffer)(cl_command_queue, cl_mem, cl_uint, size_t,
                                         size_t, void *, cl_uint, const void *, void *);
    cl_int(CLMD_CALL *SetKernelArg)(cl_kernel, cl_uint, size_t, const void *);
    cl_int(CLMD_CALL *EnqueueNDRangeKernel)(cl_command_queue, cl_kernel, cl_uint,
                                            const size_t *, const size_t *, const size_t *,
                                            cl_uint, const void *, void *);
    cl_int(CLMD_CALL *Finish)(cl_command_queue);
    cl_int(CLMD_CALL *ReleaseMemObject)(cl_mem);
    cl_int(CLMD_CALL *ReleaseKernel)(cl_kernel);
    cl_int(CLMD_CALL *ReleaseProgram)(cl_program);
    cl_int(CLMD_CALL *ReleaseCommandQueue)(cl_command_queue);
    cl_int(CLMD_CALL *ReleaseContext)(cl_context);
    bool ok = false;
};

inline Api &api() {
    static Api A;
    static bool tried = false;
    if (tried) return A;
    tried = true;
#if defined(_WIN32)
    HMODULE h = LoadLibraryA("OpenCL.dll");
    if (!h) return A;
    auto get = [&](const char *n) { return (void *)GetProcAddress(h, n); };
#else
    return A;
#endif
    A.GetPlatformIDs = (decltype(A.GetPlatformIDs))get("clGetPlatformIDs");
    A.GetDeviceIDs = (decltype(A.GetDeviceIDs))get("clGetDeviceIDs");
    A.GetDeviceInfo = (decltype(A.GetDeviceInfo))get("clGetDeviceInfo");
    A.CreateContext = (decltype(A.CreateContext))get("clCreateContext");
    A.CreateCommandQueue = (decltype(A.CreateCommandQueue))get("clCreateCommandQueue");
    A.CreateProgramWithSource =
        (decltype(A.CreateProgramWithSource))get("clCreateProgramWithSource");
    A.BuildProgram = (decltype(A.BuildProgram))get("clBuildProgram");
    A.GetProgramBuildInfo = (decltype(A.GetProgramBuildInfo))get("clGetProgramBuildInfo");
    A.CreateKernel = (decltype(A.CreateKernel))get("clCreateKernel");
    A.CreateBuffer = (decltype(A.CreateBuffer))get("clCreateBuffer");
    A.EnqueueWriteBuffer = (decltype(A.EnqueueWriteBuffer))get("clEnqueueWriteBuffer");
    A.EnqueueReadBuffer = (decltype(A.EnqueueReadBuffer))get("clEnqueueReadBuffer");
    A.SetKernelArg = (decltype(A.SetKernelArg))get("clSetKernelArg");
    A.EnqueueNDRangeKernel =
        (decltype(A.EnqueueNDRangeKernel))get("clEnqueueNDRangeKernel");
    A.Finish = (decltype(A.Finish))get("clFinish");
    A.ReleaseMemObject = (decltype(A.ReleaseMemObject))get("clReleaseMemObject");
    A.ReleaseKernel = (decltype(A.ReleaseKernel))get("clReleaseKernel");
    A.ReleaseProgram = (decltype(A.ReleaseProgram))get("clReleaseProgram");
    A.ReleaseCommandQueue = (decltype(A.ReleaseCommandQueue))get("clReleaseCommandQueue");
    A.ReleaseContext = (decltype(A.ReleaseContext))get("clReleaseContext");
    A.ok = A.GetPlatformIDs && A.GetDeviceIDs && A.GetDeviceInfo && A.CreateContext &&
           A.CreateCommandQueue && A.CreateProgramWithSource && A.BuildProgram &&
           A.GetProgramBuildInfo && A.CreateKernel && A.CreateBuffer &&
           A.EnqueueWriteBuffer && A.EnqueueReadBuffer && A.SetKernelArg &&
           A.EnqueueNDRangeKernel && A.Finish && A.ReleaseMemObject;
    return A;
}

// ---------------------------------------------------------------- kernels
//
// The parameter block par[] (indices match host-side fill in GpuMD::params):
//  0 De  1 alpha  2 re  3 ktheta  4 theta0(rad)  5 kbend  6 sigma^2  7 eps
//  8 ljCut2  9 edgeK  10 gasF  11 gcx  12 gcy  13 halfX  14 halfY
//  15 sigx  16 sigy  17 bubR2  18 profile(0 gauss,1 mesa,2 bubble)
//  19 damp  20 dt  21 maxV  22 maxDX  23 accK  24 fixEdges
//  25 cellX0  26 cellY0  27 cellSize  28 reach  29 elevz

static const char *SRC = R"CLC(
inline float clampf(float v, float lo, float hi){ return v<lo?lo:(v>hi?hi:v); }

__kernel void k_lift(__global float *sz, __global const float *sx0,
                     __global const float *sy0, __global const float *sz0,
                     __constant float *par, int m) {
  int i = get_global_id(0);
  if (i >= m) return;
  float dx = sx0[i] - par[11], dy = sy0[i] - par[12];
  float lift;
  int prof = (int)par[18];
  float elev = par[29];
  if (prof == 1) {                      // mesa
    lift = (fabs(dx) <= par[13] && fabs(dy) <= par[14]) ? elev : 0.0f;
  } else if (prof == 2) {               // Hencky bubble
    float r2 = (dx*dx + dy*dy) / par[17];
    lift = r2 < 1.0f ? elev * powr(1.0f - r2, 0.6666667f) : 0.0f;
  } else {                              // gaussian
    lift = elev * exp(-(dx*dx/(2.0f*par[15]*par[15]) + dy*dy/(2.0f*par[16]*par[16])));
  }
  sz[i] = sz0[i] + lift;
}

__kernel void k_bend(__global const float *tz, __global const int *nbOff,
                     __global const int *nbIdx, __global float *bendDz,
                     __global float *bendShare, float kb, int n) {
  int i = get_global_id(0);
  if (i >= n) return;
  int s = nbOff[i], e = nbOff[i+1], deg = e - s;
  if (deg <= 0) { bendDz[i] = 0; bendShare[i] = 0; return; }
  float za = 0;
  for (int k = s; k < e; k++) za += tz[nbIdx[k]];
  float dz = tz[i] - za / (float)deg;
  bendDz[i] = dz;
  bendShare[i] = kb * dz / (float)deg;
}

__kernel void k_forces(
    __global const float *tx, __global const float *ty, __global const float *tz,
    __global float *fx, __global float *fy, __global float *fz,
    __global float *pe,
    __global const int *nbOff, __global const int *nbIdx,
    __global const int *aiOff, __global const int *aiIdx,
    __global const int *angC, __global const int *angA, __global const int *angB,
    __global const float *bendDz, __global const float *bendShare,
    __global const float *sx, __global const float *sy, __global const float *sz,
    __global const int *cellOff, __global const int *cellIdx,
    int cellNx, int cellNy,
    __global const uchar *isEdge,
    __global const float *tx0, __global const float *ty0, __global const float *tz0,
    __constant float *par, int n) {
  int i = get_global_id(0);
  if (i >= n) return;
  float xi = tx[i], yi = ty[i], zi = tz[i];
  float Fx = 0, Fy = 0, Fz = 0, e = 0;
  float De = par[0], alpha = par[1], re = par[2];
  float kth = par[3], th0 = par[4], kb = par[5];
  float sig2 = par[6], eps = par[7], ljCut2 = par[8];

  // Morse bonds
  int bs = nbOff[i], be = nbOff[i+1];
  for (int k = bs; k < be; k++) {
    int j = nbIdx[k];
    float dx = tx[j]-xi, dy = ty[j]-yi, dz = tz[j]-zi;
    float r = sqrt(dx*dx + dy*dy + dz*dz);
    if (r < 1e-8f) continue;
    float ex = exp(-alpha * (r - re));
    float mag = 2.0f * De * alpha * ex * (1.0f - ex);
    float inv = 1.0f / r;
    Fx += mag*dx*inv; Fy += mag*dy*inv; Fz += mag*dz*inv;
    float om = 1.0f - ex;
    e += 0.5f * De * om * om;
  }

  // sp2 angles, gathered by packed role
  if (kth != 0.0f) {
    int as = aiOff[i], ae = aiOff[i+1];
    for (int k = as; k < ae; k++) {
      int packed = aiIdx[k];
      int a = packed >> 2, role = packed & 3;
      int ci = angC[a], ja = angA[a], ka = angB[a];
      float v1x = tx[ja]-tx[ci], v1y = ty[ja]-ty[ci], v1z = tz[ja]-tz[ci];
      float v2x = tx[ka]-tx[ci], v2y = ty[ka]-ty[ci], v2z = tz[ka]-tz[ci];
      float L1 = sqrt(v1x*v1x + v1y*v1y + v1z*v1z);
      float L2 = sqrt(v2x*v2x + v2y*v2y + v2z*v2z);
      if (L1 < 1e-6f || L2 < 1e-6f) continue;
      float u1x = v1x/L1, u1y = v1y/L1, u1z = v1z/L1;
      float u2x = v2x/L2, u2y = v2y/L2, u2z = v2z/L2;
      float c = clampf(u1x*u2x + u1y*u2y + u1z*u2z, -1.0f, 1.0f);
      float theta = acos(c);
      float dth = theta - th0;
      float fac = (-kth * dth) / fmax(sqrt(1.0f - c*c), 1e-4f);
      float nx = u2x - c*u1x, ny = u2y - c*u1y, nz = u2z - c*u1z;
      float mx = u1x - c*u2x, my = u1y - c*u2y, mz = u1z - c*u2z;
      float fJx = -fac*nx/L1, fJy = -fac*ny/L1, fJz = -fac*nz/L1;
      float fKx = -fac*mx/L2, fKy = -fac*my/L2, fKz = -fac*mz/L2;
      if (role == 1)      { Fx += fJx; Fy += fJy; Fz += fJz; }
      else if (role == 2) { Fx += fKx; Fy += fKy; Fz += fKz; }
      else {
        Fx -= (fJx + fKx); Fy -= (fJy + fKy); Fz -= (fJz + fKz);
        e += 0.5f * kth * dth * dth;
      }
    }
  }

  // bending umbrella
  if (kb > 0.0f) {
    Fz += -kb * bendDz[i];
    for (int k = bs; k < be; k++) Fz += bendShare[nbIdx[k]];
    e += 0.5f * kb * bendDz[i] * bendDz[i];
  }

  // LJ against the rigid substrate, walking the static 2D cell list
  {
    float cellX0 = par[25], cellY0 = par[26], cellSize = par[27];
    int reach = (int)par[28];
    int cx = (int)((xi - cellX0) / cellSize);
    int cy = (int)((yi - cellY0) / cellSize);
    for (int oy = -reach; oy <= reach; oy++)
      for (int ox = -reach; ox <= reach; ox++) {
        int gx = cx + ox, gy = cy + oy;
        if (gx < 0 || gy < 0 || gx >= cellNx || gy >= cellNy) continue;
        int cell = gy * cellNx + gx;
        for (int k = cellOff[cell]; k < cellOff[cell+1]; k++) {
          int j = cellIdx[k];
          float dx = sx[j]-xi, dy = sy[j]-yi, dz = sz[j]-zi;
          float r2 = dx*dx + dy*dy + dz*dz;
          if (r2 > ljCut2 || r2 < 1e-6f) continue;
          float inv2 = 1.0f / r2;
          float sr2 = sig2*inv2, sr6 = sr2*sr2*sr2, sr12 = sr6*sr6;
          float mag = -24.0f * eps * (2.0f*sr12 - sr6) * inv2;
          Fx += mag*dx; Fy += mag*dy; Fz += mag*dz;
          e += 4.0f * eps * (sr12 - sr6);
        }
      }
  }

  // edge collar springs
  float edgeK = par[9];
  if (edgeK > 0.0f && isEdge[i]) {
    float dx = xi - tx0[i], dy = yi - ty0[i], dz = zi - tz0[i];
    Fx += -edgeK*dx; Fy += -edgeK*dy; Fz += -edgeK*dz;
    e += 0.5f * edgeK * (dx*dx + dy*dy + dz*dz);
  }

  // gas pressure inside the blister footprint
  float gasF = par[10];
  if (gasF > 0.0f) {
    float dx = xi - par[11], dy = yi - par[12];
    int prof = (int)par[18];
    float w;
    if (prof == 2)      w = (dx*dx + dy*dy) < par[17] ? 1.0f : 0.0f;
    else if (prof == 1) w = (fabs(dx) <= par[13] && fabs(dy) <= par[14]) ? 1.0f : 0.0f;
    else w = exp(-(dx*dx/(2.0f*par[15]*par[15]) + dy*dy/(2.0f*par[16]*par[16])));
    Fz += gasF * w;
  }

  fx[i] = Fx; fy[i] = Fy; fz[i] = Fz;
  pe[i] = e;
}

__kernel void k_kick(__global float *vx, __global float *vy, __global float *vz,
                     __global const float *fx, __global const float *fy,
                     __global const float *fz, __global float *v2out,
                     __constant float *par, int writeV2, int n) {
  int i = get_global_id(0);
  if (i >= n) return;
  float damp = par[19], dt = par[20], maxV = par[21], accK = par[23];
  float ux = damp*vx[i] + fx[i]*accK*dt*0.5f;
  float uy = damp*vy[i] + fy[i]*accK*dt*0.5f;
  float uz = damp*vz[i] + fz[i]*accK*dt*0.5f;
  float vm2 = ux*ux + uy*uy + uz*uz;
  if (vm2 > maxV*maxV) {
    float s = maxV / sqrt(vm2);
    ux *= s; uy *= s; uz *= s;
    vm2 = maxV*maxV;
  }
  vx[i] = ux; vy[i] = uy; vz[i] = uz;
  if (writeV2) v2out[i] = vm2;
}

__kernel void k_drift(__global float *tx, __global float *ty, __global float *tz,
                      __global float *vx, __global float *vy, __global float *vz,
                      __global const uchar *isEdge,
                      __global const float *tx0, __global const float *ty0,
                      __global const float *tz0,
                      __constant float *par, int n) {
  int i = get_global_id(0);
  if (i >= n) return;
  float dt = par[20], maxDX = par[22];
  float dx = vx[i]*dt, dy = vy[i]*dt, dz = vz[i]*dt;
  float dm = sqrt(dx*dx + dy*dy + dz*dz);
  if (dm > maxDX) { float s = maxDX/dm; dx *= s; dy *= s; dz *= s; }
  tx[i] += dx; ty[i] += dy; tz[i] += dz;
  if (par[24] > 0.5f && isEdge[i]) {
    tx[i] = tx0[i]; ty[i] = ty0[i]; tz[i] = tz0[i];
    vx[i] = 0; vy[i] = 0; vz[i] = 0;
  }
}
)CLC";

// ---------------------------------------------------------------- engine

struct GpuMD {
    bool ready = false;
    std::string device, error;

    cl_context ctx = nullptr;
    cl_command_queue q = nullptr;
    cl_program prog = nullptr;
    cl_kernel kLift = nullptr, kBend = nullptr, kForces = nullptr,
              kKick = nullptr, kDrift = nullptr;
    cl_device_id dev = nullptr;

    // device buffers
    cl_mem dTx = nullptr, dTy = nullptr, dTz = nullptr;
    cl_mem dVx = nullptr, dVy = nullptr, dVz = nullptr;
    cl_mem dFx = nullptr, dFy = nullptr, dFz = nullptr;
    cl_mem dPe = nullptr, dV2 = nullptr;
    cl_mem dBendDz = nullptr, dBendShare = nullptr;
    cl_mem dNbOff = nullptr, dNbIdx = nullptr;
    cl_mem dAiOff = nullptr, dAiIdx = nullptr;
    cl_mem dAngC = nullptr, dAngA = nullptr, dAngB = nullptr;
    cl_mem dSx = nullptr, dSy = nullptr, dSz = nullptr;
    cl_mem dSx0 = nullptr, dSy0 = nullptr, dSz0 = nullptr;
    cl_mem dCellOff = nullptr, dCellIdx = nullptr;
    cl_mem dIsEdge = nullptr;
    cl_mem dTx0 = nullptr, dTy0 = nullptr, dTz0 = nullptr;
    cl_mem dPar = nullptr;

    size_t nCap = 0, mCap = 0;   // allocated sizes
    int cellNx = 0, cellNy = 0;
    float par[32] = {0};
    bool parDirty = true;

    // scratch (host mirrors in float)
    std::vector<float> h;

    ~GpuMD() { destroy(); }

    void relMem(cl_mem &m) { if (m && api().ReleaseMemObject) api().ReleaseMemObject(m); m = nullptr; }

    void destroy() {
        Api &A = api();
        for (cl_mem *m : {&dTx, &dTy, &dTz, &dVx, &dVy, &dVz, &dFx, &dFy, &dFz,
                          &dPe, &dV2, &dBendDz, &dBendShare, &dNbOff, &dNbIdx,
                          &dAiOff, &dAiIdx, &dAngC, &dAngA, &dAngB, &dSx, &dSy,
                          &dSz, &dSx0, &dSy0, &dSz0, &dCellOff, &dCellIdx,
                          &dIsEdge, &dTx0, &dTy0, &dTz0, &dPar})
            relMem(*m);
        if (kLift && A.ReleaseKernel) A.ReleaseKernel(kLift);
        if (kBend && A.ReleaseKernel) A.ReleaseKernel(kBend);
        if (kForces && A.ReleaseKernel) A.ReleaseKernel(kForces);
        if (kKick && A.ReleaseKernel) A.ReleaseKernel(kKick);
        if (kDrift && A.ReleaseKernel) A.ReleaseKernel(kDrift);
        kLift = kBend = kForces = kKick = kDrift = nullptr;
        if (prog && A.ReleaseProgram) A.ReleaseProgram(prog);
        prog = nullptr;
        if (q && A.ReleaseCommandQueue) A.ReleaseCommandQueue(q);
        q = nullptr;
        if (ctx && A.ReleaseContext) A.ReleaseContext(ctx);
        ctx = nullptr;
        ready = false;
        nCap = mCap = 0;
    }

    bool init() {
        if (ready) return true;
        Api &A = api();
        if (!A.ok) { error = "OpenCL.dll not available"; return false; }
        cl_uint np = 0;
        if (A.GetPlatformIDs(0, nullptr, &np) != CL_SUCCESS || np == 0) {
            error = "no OpenCL platforms"; return false;
        }
        std::vector<cl_platform_id> plats(np);
        A.GetPlatformIDs(np, plats.data(), nullptr);
        for (auto p : plats) {
            cl_uint nd = 0;
            if (A.GetDeviceIDs(p, CL_DEVICE_TYPE_GPU, 1, &dev, &nd) == CL_SUCCESS && nd)
                break;
            dev = nullptr;
        }
        if (!dev) { error = "no GPU device"; return false; }
        char name[256] = {0};
        A.GetDeviceInfo(dev, CL_DEVICE_NAME, sizeof name - 1, name, nullptr);
        device = name;

        cl_int err = 0;
        ctx = A.CreateContext(nullptr, 1, &dev, nullptr, nullptr, &err);
        if (!ctx || err) { error = "CreateContext failed"; return false; }
        q = A.CreateCommandQueue(ctx, dev, 0, &err);
        if (!q || err) { error = "CreateCommandQueue failed"; destroy(); return false; }
        prog = A.CreateProgramWithSource(ctx, 1, &SRC, nullptr, &err);
        if (!prog || err) { error = "CreateProgram failed"; destroy(); return false; }
        // NOT -cl-fast-relaxed-math: it swaps exp() for the low-precision native
        // op, and the Morse term is nothing but exponentials — measured as a 2%
        // shift in the total potential energy against the CPU reference.
        if (A.BuildProgram(prog, 1, &dev, "", nullptr, nullptr) != CL_SUCCESS) {
            size_t len = 0;
            A.GetProgramBuildInfo(prog, dev, CL_PROGRAM_BUILD_LOG, 0, nullptr, &len);
            std::string log(len, 0);
            A.GetProgramBuildInfo(prog, dev, CL_PROGRAM_BUILD_LOG, len, &log[0], nullptr);
            error = "kernel build failed: " + log.substr(0, 400);
            destroy();
            return false;
        }
        kLift = A.CreateKernel(prog, "k_lift", &err);
        kBend = A.CreateKernel(prog, "k_bend", &err);
        kForces = A.CreateKernel(prog, "k_forces", &err);
        kKick = A.CreateKernel(prog, "k_kick", &err);
        kDrift = A.CreateKernel(prog, "k_drift", &err);
        if (!kLift || !kBend || !kForces || !kKick || !kDrift) {
            error = "CreateKernel failed"; destroy(); return false;
        }
        dPar = A.CreateBuffer(ctx, CL_MEM_READ_ONLY, sizeof par, nullptr, &err);
        ready = true;
        error.clear();
        return true;
    }

    // ---------------------------------------------------------- transfers

    cl_mem mk(size_t bytes) {
        cl_int err = 0;
        return api().CreateBuffer(ctx, CL_MEM_READ_WRITE, bytes ? bytes : 4, nullptr, &err);
    }
    void up(cl_mem d, const void *src, size_t bytes) {
        if (bytes) api().EnqueueWriteBuffer(q, d, 1, 0, bytes, src, 0, nullptr, nullptr);
    }
    void down(cl_mem d, void *dst, size_t bytes) {
        if (bytes) api().EnqueueReadBuffer(q, d, 1, 0, bytes, dst, 0, nullptr, nullptr);
    }
    void upF(cl_mem d, const std::vector<double> &v) {
        h.resize(v.size());
        for (size_t i = 0; i < v.size(); i++) h[i] = (float)v[i];
        up(d, h.data(), h.size() * 4);
    }
    void downF(cl_mem d, std::vector<double> &v, size_t n) {
        h.resize(n);
        down(d, h.data(), n * 4);
        v.resize(n);
        // Finish before converting: reads are queued, not complete.
        api().Finish(q);
        for (size_t i = 0; i < n; i++) v[i] = h[i];
    }
    void upI(cl_mem d, const std::vector<int32_t> &v) { up(d, v.data(), v.size() * 4); }

    void ensureAtoms(size_t n) {
        if (n <= nCap) return;
        for (cl_mem *m : {&dTx, &dTy, &dTz, &dVx, &dVy, &dVz, &dFx, &dFy, &dFz,
                          &dPe, &dV2, &dBendDz, &dBendShare, &dIsEdge,
                          &dTx0, &dTy0, &dTz0})
            relMem(*m);
        nCap = n + n / 4 + 64;
        dTx = mk(nCap * 4); dTy = mk(nCap * 4); dTz = mk(nCap * 4);
        dVx = mk(nCap * 4); dVy = mk(nCap * 4); dVz = mk(nCap * 4);
        dFx = mk(nCap * 4); dFy = mk(nCap * 4); dFz = mk(nCap * 4);
        dPe = mk(nCap * 4); dV2 = mk(nCap * 4);
        dBendDz = mk(nCap * 4); dBendShare = mk(nCap * 4);
        dIsEdge = mk(nCap);
        dTx0 = mk(nCap * 4); dTy0 = mk(nCap * 4); dTz0 = mk(nCap * 4);
    }

    template <typename Inst> void uploadTopology(Inst &I) {
        for (cl_mem *m : {&dNbOff, &dNbIdx, &dAiOff, &dAiIdx, &dAngC, &dAngA, &dAngB})
            relMem(*m);
        dNbOff = mk(I.nbOff.size() * 4); upI(dNbOff, I.nbOff);
        dNbIdx = mk(I.nbIdx.size() * 4); upI(dNbIdx, I.nbIdx);
        dAiOff = mk(I.aiOff.size() * 4); upI(dAiOff, I.aiOff);
        dAiIdx = mk(I.aiIdx.size() * 4); upI(dAiIdx, I.aiIdx);
        dAngC = mk(I.angC.size() * 4); upI(dAngC, I.angC);
        dAngA = mk(I.angA.size() * 4); upI(dAngA, I.angA);
        dAngB = mk(I.angB.size() * 4); upI(dAngB, I.angB);
    }

    template <typename Inst> void uploadSubstrate(Inst &I) {
        size_t m = I.sx.size();
        if (m > mCap) {
            for (cl_mem *b : {&dSx, &dSy, &dSz, &dSx0, &dSy0, &dSz0}) relMem(*b);
            mCap = m + 64;
            dSx = mk(mCap * 4); dSy = mk(mCap * 4); dSz = mk(mCap * 4);
            dSx0 = mk(mCap * 4); dSy0 = mk(mCap * 4); dSz0 = mk(mCap * 4);
        }
        upF(dSx, I.sx); upF(dSy, I.sy); upF(dSz, I.sz);
        upF(dSx0, I.sx0); upF(dSy0, I.sy0); upF(dSz0, I.sz0);
        relMem(dCellOff); relMem(dCellIdx);
        dCellOff = mk(I.cellOff.size() * 4); upI(dCellOff, I.cellOff);
        dCellIdx = mk(I.cellIdx.size() * 4); upI(dCellIdx, I.cellIdx);
        cellNx = I.cellNx; cellNy = I.cellNy;
        par[25] = (float)I.cellX0; par[26] = (float)I.cellY0;
        par[27] = (float)I.cellSize;
        // reach: how many cells the LJ cutoff spans
        par[28] = (float)((int)(3 * I.P.sigma / I.cellSize) + 1);
        parDirty = true;
    }

    template <typename Inst> void uploadState(Inst &I) {
        size_t n = I.tx.size();
        ensureAtoms(n);
        upF(dTx, I.tx); upF(dTy, I.ty); upF(dTz, I.tz);
        upF(dVx, I.vx); upF(dVy, I.vy); upF(dVz, I.vz);
        upF(dTx0, I.tx0); upF(dTy0, I.ty0); upF(dTz0, I.tz0);
        up(dIsEdge, I.isEdge.data(), I.isEdge.size());
    }

    template <typename Inst> void downloadState(Inst &I) {
        size_t n = I.tx.size();
        downF(dTx, I.tx, n); downF(dTy, I.ty, n); downF(dTz, I.tz, n);
        downF(dVx, I.vx, n); downF(dVy, I.vy, n); downF(dVz, I.vz, n);
    }

    void pushPar() {
        up(dPar, par, sizeof par);
        parDirty = false;
    }

    // ------------------------------------------------------------ kernels

    void run1(cl_kernel k, size_t n) {
        const size_t g = (n + 63) / 64 * 64, l = 64;
        api().EnqueueNDRangeKernel(q, k, 1, nullptr, &g, &l, 0, nullptr, nullptr);
    }
    template <typename T> void arg(cl_kernel k, cl_uint i, const T &v) {
        api().SetKernelArg(k, i, sizeof(T), &v);
    }

    void lift(int m) {
        arg(kLift, 0, dSz); arg(kLift, 1, dSx0); arg(kLift, 2, dSy0);
        arg(kLift, 3, dSz0); arg(kLift, 4, dPar); arg(kLift, 5, m);
        run1(kLift, (size_t)m);
    }
    void bend(float kb, int n) {
        arg(kBend, 0, dTz); arg(kBend, 1, dNbOff); arg(kBend, 2, dNbIdx);
        arg(kBend, 3, dBendDz); arg(kBend, 4, dBendShare);
        arg(kBend, 5, kb); arg(kBend, 6, n);
        run1(kBend, (size_t)n);
    }
    void forces(int n) {
        cl_kernel k = kForces;
        cl_uint a = 0;
        for (cl_mem m : {dTx, dTy, dTz, dFx, dFy, dFz, dPe, dNbOff, dNbIdx,
                         dAiOff, dAiIdx, dAngC, dAngA, dAngB, dBendDz, dBendShare,
                         dSx, dSy, dSz, dCellOff, dCellIdx})
            arg(k, a++, m);
        arg(k, a++, cellNx); arg(k, a++, cellNy);
        for (cl_mem m : {dIsEdge, dTx0, dTy0, dTz0}) arg(k, a++, m);
        arg(k, a++, dPar); arg(k, a++, n);
        run1(k, (size_t)n);
    }
    void kick(int writeV2, int n) {
        cl_uint a = 0;
        for (cl_mem m : {dVx, dVy, dVz, dFx, dFy, dFz, dV2}) arg(kKick, a++, m);
        arg(kKick, a++, dPar); arg(kKick, a++, writeV2); arg(kKick, a++, n);
        run1(kKick, (size_t)n);
    }
    void drift(int n) {
        cl_uint a = 0;
        for (cl_mem m : {dTx, dTy, dTz, dVx, dVy, dVz, dIsEdge, dTx0, dTy0, dTz0})
            arg(kDrift, a++, m);
        arg(kDrift, a++, dPar); arg(kDrift, a++, n);
        run1(kDrift, (size_t)n);
    }
};

} // namespace clmd
