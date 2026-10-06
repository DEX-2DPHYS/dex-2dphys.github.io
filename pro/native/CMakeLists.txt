# EBL Workbench Pro native core (ebw-core): the program the Pro backend (pro/desktop/core.mjs) starts.
#   cmake -S pro/native -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release
# macOS: brew install libomp and pass -DOpenMP_ROOT=$(brew --prefix libomp); without OpenMP it still
# builds and runs, on one thread.
#
# Floating point is kept as the page's JavaScript does it (the core's results are the page's to the
# bit, gates gp1/g5d): no fast-math and NO FMA contraction — clang and gcc fuse a*b+c by default
# (-ffp-contract=on/fast), which rounds differently from JavaScript.
cmake_minimum_required(VERSION 3.15)
project(ebw_core CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(ebw-core core-main.cpp mc.cpp sr.cpp pec.cpp koh.cpp)

find_package(OpenMP)
if(OpenMP_CXX_FOUND)
  target_link_libraries(ebw-core PRIVATE OpenMP::OpenMP_CXX)
else()
  message(WARNING "OpenMP not found: ebw-core will run on one thread")
endif()

if(MSVC)
  target_compile_options(ebw-core PRIVATE /O2 /fp:precise /bigobj /EHsc)
  set_property(TARGET ebw-core PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")   # no VC++ redistributable needed
else()
  target_compile_options(ebw-core PRIVATE -O3 -fno-fast-math -ffp-contract=off)
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_options(ebw-core PRIVATE -static)                               # runs on any x64 Linux
  elseif(MINGW)
    target_link_options(ebw-core PRIVATE -static -static-libgcc -static-libstdc++)
  endif()
endif()
