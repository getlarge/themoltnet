#include "test.hpp"

#include <exception>
#include <iostream>

int main() {
  const TestCase tests[] = {
      {"client auth retries after 401", test_client_auth_retries_after_401},
      {"client task query and team header", test_client_builds_task_query_and_team_header},
      {"c api smoke", test_c_api_smoke},
  };

  int failed = 0;
  for (const auto& test : tests) {
    try {
      test.fn();
      std::cout << "ok - " << test.name << '\n';
    } catch (const std::exception& error) {
      failed++;
      std::cerr << "not ok - " << test.name << ": " << error.what() << '\n';
    }
  }
  return failed == 0 ? 0 : 1;
}
