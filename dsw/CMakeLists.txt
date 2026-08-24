cmake_minimum_required(VERSION 3.15)
project(dsw CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Threads REQUIRED)
find_package(OpenMP)

include(CheckCXXCompilerFlag)
# -march=native tunes the build for THIS machine and is a large win for the
# heavier plugin cores, but the result may use instructions an older CPU does
# not have. Keep it on for local builds; turn it OFF for anything you ship to
# other people (the release workflow does exactly that).
option(DSW_NATIVE_ARCH "Optimise for the building machine's CPU (not portable)" ON)
if(DSW_NATIVE_ARCH)
  check_cxx_compiler_flag(-march=native DSW_HAS_MARCH_NATIVE)
endif()

# ---------------------------------------------------------------- host
add_executable(dsw
  src/main.cpp
  src/net.cpp
  src/host.cpp
)
target_include_directories(dsw PRIVATE include)
target_link_libraries(dsw PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
if(WIN32)
  target_link_libraries(dsw PRIVATE ws2_32)
endif()
# Run `dsw` from the repo's dsw/ folder and it finds web/ and plugins/ there.
# The $<1:...> genex stops multi-config generators (Visual Studio) from
# appending a Release/ subfolder — the exe must land in dsw/ itself.
set_target_properties(dsw PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}>)

# ---------------------------------------------------------------- plugins
# dsw_add_plugin(<id>) builds plugins/<id>/src/plugin.cpp into
# plugins/<id>/<id>.so|dll|dylib — i.e. straight into its own bundle.
function(dsw_add_plugin id)
  add_library(plugin_${id} SHARED plugins/${id}/src/plugin.cpp)
  target_include_directories(plugin_${id} PRIVATE include)
  set_target_properties(plugin_${id} PROPERTIES
    OUTPUT_NAME ${id}
    PREFIX ""
    LIBRARY_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}/plugins/${id}>
    RUNTIME_OUTPUT_DIRECTORY $<1:${CMAKE_CURRENT_SOURCE_DIR}/plugins/${id}>)
  if(OpenMP_CXX_FOUND)
    target_link_libraries(plugin_${id} PRIVATE OpenMP::OpenMP_CXX)
  endif()
  if(NOT MSVC)
    # -O3 plus FMA contraction; the force kernels are written as flat
    # structure-of-arrays loops for the vectorizer. -march=native is added
    # only when enabled and the toolchain accepts it (Apple clang on arm64
    # does not), so portable builds stay portable.
    target_compile_options(plugin_${id} PRIVATE -O3 -ffp-contract=fast)
    if(DSW_HAS_MARCH_NATIVE)
      target_compile_options(plugin_${id} PRIVATE -march=native)
    endif()
  endif()
endfunction()

dsw_add_plugin(gray-scott)
dsw_add_plugin(wave-tank)
dsw_add_plugin(pattern-transfer)
dsw_add_plugin(graphene-md)
