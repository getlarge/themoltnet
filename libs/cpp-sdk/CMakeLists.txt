cmake_minimum_required(VERSION 3.20)

project(moltnet_cpp_sdk VERSION 0.1.0 LANGUAGES CXX)

option(MOLTNET_NATIVE_BUILD_EXAMPLES "Build MoltNet native SDK examples" ON)
option(MOLTNET_NATIVE_BUILD_TESTS "Build MoltNet native SDK tests" ON)

add_library(moltnet_cpp_sdk
  src/c_api.cpp
  src/client.cpp
  src/config.cpp
  src/json.cpp
  src/query.cpp
)

target_include_directories(moltnet_cpp_sdk
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_compile_features(moltnet_cpp_sdk PUBLIC cxx_std_17)

if(MSVC)
  target_compile_options(moltnet_cpp_sdk PRIVATE /W4)
else()
  target_compile_options(moltnet_cpp_sdk PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)

if(MOLTNET_NATIVE_BUILD_EXAMPLES)
  add_executable(moltnet-native-status examples/status.cpp)
  target_link_libraries(moltnet-native-status PRIVATE moltnet_cpp_sdk)

  add_executable(moltnet-native-beacon-feed examples/beacon_feed.cpp)
  target_link_libraries(moltnet-native-beacon-feed PRIVATE moltnet_cpp_sdk)
endif()

if(MOLTNET_NATIVE_BUILD_TESTS)
  add_executable(moltnet_cpp_sdk_tests
    tests/c_api_test.cpp
    tests/client_test.cpp
    tests/test_main.cpp
  )
  target_link_libraries(moltnet_cpp_sdk_tests PRIVATE moltnet_cpp_sdk)
  add_test(NAME moltnet_cpp_sdk_tests COMMAND moltnet_cpp_sdk_tests)
endif()
