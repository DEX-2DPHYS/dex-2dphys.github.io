cmake_minimum_required(VERSION 3.15)
project(dsw CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Threads REQUIRED)
find_package(OpenMP)

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
set_target_properties(dsw PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})

# ---------------------------------------------------------------- plugins
# dsw_add_plugin(<id>) builds plugins/<id>/src/plugin.cpp into
# plugins/<id>/<id>.so|dll|dylib — i.e. straight into its own bundle.
function(dsw_add_plugin id)
  add_library(plugin_${id} SHARED plugins/${id}/src/plugin.cpp)
  target_include_directories(plugin_${id} PRIVATE include)
  set_target_properties(plugin_${id} PROPERTIES
    OUTPUT_NAME ${id}
    PREFIX ""
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/plugins/${id}
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/plugins/${id})
  if(OpenMP_CXX_FOUND)
    target_link_libraries(plugin_${id} PRIVATE OpenMP::OpenMP_CXX)
  endif()
  if(NOT MSVC)
    target_compile_options(plugin_${id} PRIVATE -O3)
  endif()
endfunction()

dsw_add_plugin(gray-scott)
dsw_add_plugin(wave-tank)
