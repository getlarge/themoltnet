#pragma once

#include <iostream>
#include <stdexcept>
#include <string>

#define ASSERT_TRUE(expr)                                                       \
  do {                                                                         \
    if (!(expr)) {                                                             \
      throw std::runtime_error(std::string("assertion failed: ") + #expr);     \
    }                                                                          \
  } while (false)

#define ASSERT_EQ(actual, expected)                                             \
  do {                                                                         \
    const auto actual_value = (actual);                                         \
    const auto expected_value = (expected);                                     \
    if (!(actual_value == expected_value)) {                                    \
      throw std::runtime_error(std::string("assertion failed: ") + #actual +   \
                               " == " + #expected + ", got `" +              \
                               std::to_string(actual_value) + "`");            \
    }                                                                          \
  } while (false)

using TestFn = void (*)();

struct TestCase {
  const char* name;
  TestFn fn;
};

void test_client_auth_retries_after_401();
void test_client_builds_task_query_and_team_header();
void test_client_builds_full_task_query_filters();
void test_client_downloads_task_artifact_content();
void test_c_api_smoke();
