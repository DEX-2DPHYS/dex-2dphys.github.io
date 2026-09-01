# Standalone build for the "graphene-md" DSW plugin bundle.
#
# Needs a LAMMPS static library with the MANYBODY package (see README.md for
# the two commands that produce it). Point LAMMPS_ROOT at the clone:
#
#   cmake -B <builddir> -S . -D LAMMPS_ROOT=C:/Users/pbog/b/lammps
#   cmake --build <builddir> --config Release
#
# The library lands next to dex.json as graphene-md.dll|.so|.dylib.

cmake_minimum_required(VERSION 3.15)
project(graphene-md CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(LAMMPS_ROOT "C:/Users/pbog/b/lammps" CACHE PATH "LAMMPS source tree with build/liblammps.a")

find_package(OpenMP)

# dl_stub.cpp: lets libgomp link statically on MinGW (see the file header),
# so the installed DLL keeps zero non-system dependencies.
add_library(graphene-md SHARED src/plugin.cpp src/dl_stub.cpp)
target_include_directories(graphene-md PRIVATE src "${LAMMPS_ROOT}/src")
target_link_directories(graphene-md PRIVATE "${LAMMPS_ROOT}/build")
target_link_libraries(graphene-md PRIVATE lammps)
set_target_properties(graphene-md PROPERTIES
  OUTPUT_NAME graphene-md
  PREFIX ""
  # $<1:...> stops multi-config generators (Visual Studio) appending Release/
  LIBRARY_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}>
  RUNTIME_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}>)

if(OpenMP_CXX_FOUND)
  target_link_libraries(graphene-md PRIVATE OpenMP::OpenMP_CXX)
endif()
if(WIN32)
  target_link_libraries(graphene-md PRIVATE psapi ws2_32)
endif()
if(MSVC)
  target_compile_options(graphene-md PRIVATE /fp:precise)
else()
  target_compile_options(graphene-md PRIVATE -O3 -fno-fast-math)
endif()
