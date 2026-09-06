# Standalone build for the "superlubricity" DSW plugin bundle.
#
# The bundle vendors dex_plugin.h / dex_msg.h in src/, so it does not need the
# dsw source tree to build:
#
#   cmake -B <builddir> -S .          # any build dir outside Dropbox
#   cmake --build <builddir> --config Release
#
# The library lands next to dex.json as superlubricity.dll|.so|.dylib, which
# is exactly where the host looks (bundle folder name == binary name).

cmake_minimum_required(VERSION 3.15)
project(superlubricity CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(OpenMP)

add_library(superlubricity SHARED src/plugin.cpp)
target_include_directories(superlubricity PRIVATE src)
set_target_properties(superlubricity PROPERTIES
  OUTPUT_NAME superlubricity
  PREFIX ""
  # $<1:...> stops multi-config generators (Visual Studio) appending Release/
  LIBRARY_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}>
  RUNTIME_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}>)

if(OpenMP_CXX_FOUND)
  target_link_libraries(superlubricity PRIVATE OpenMP::OpenMP_CXX)
endif()
if(MSVC)
  target_compile_options(superlubricity PRIVATE /fp:fast)
else()
  target_compile_options(superlubricity PRIVATE -O3 -ffast-math)
endif()
