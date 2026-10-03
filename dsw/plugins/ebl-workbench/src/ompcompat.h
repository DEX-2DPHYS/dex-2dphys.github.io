// OpenMP where the compiler has it; one thread where it does not (Apple clang without libomp).
// Max reductions need OpenMP 3.1 (MSVC's /openmp is 2.0): those loops run serially there.
#pragma once
#ifdef _OPENMP
#include <omp.h>
#else
#include <chrono>
inline int omp_get_num_procs() { return 1; }
inline int omp_get_max_threads() { return 1; }
inline int omp_get_thread_num() { return 0; }
inline double omp_get_wtime() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
#endif
#if defined(_OPENMP) && _OPENMP >= 201107
#define OMP_HAS_MAX_REDUCTION 1
#else
#define OMP_HAS_MAX_REDUCTION 0
#endif
