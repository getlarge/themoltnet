#include "test.hpp"

#include <vector>

#include "moltnet/client.hpp"

namespace {

struct FakeTransport {
  std::vector<moltnet::HttpRequest> requests;
  int token_requests = 0;
  int task_requests = 0;

  moltnet::HttpResponse operator()(const moltnet::HttpRequest& request) {
    requests.push_back(request);
    if (request.url == "https://api.example.test/oauth2/token") {
      token_requests++;
      return {200, {}, "{\"access_token\":\"token-" + std::to_string(token_requests) +
                          "\",\"token_type\":\"bearer\",\"expires_in\":3600}"};
    }
    if (request.url == "https://api.example.test/tasks?status=queued&limit=5") {
      task_requests++;
      if (task_requests == 1) return {401, {}, "{\"code\":\"UNAUTHORIZED\"}"};
      return {200, {}, "{\"tasks\":[]}"};
    }
    if (request.url == "https://api.example.test/tasks/task-1") {
      return {200, {}, "{\"id\":\"task-1\"}"};
    }
    return {404, {}, request.url};
  }
};

moltnet::Config config() {
  moltnet::Config config;
  config.api_url = "https://api.example.test";
  config.client_id = "client";
  config.client_secret = "secret";
  config.team_id = "team-1";
  return config;
}

}  // namespace

void test_client_auth_retries_after_401() {
  FakeTransport fake;
  moltnet::Client client(config(), [&](const moltnet::HttpRequest& request) {
    return fake(request);
  });

  moltnet::TasksQuery query;
  query.status = "queued";
  query.limit = 5;
  const auto response = client.list_tasks(query);

  ASSERT_EQ(response.status, 200);
  ASSERT_EQ(fake.token_requests, 2);
  ASSERT_EQ(fake.task_requests, 2);
  ASSERT_TRUE(fake.requests[1].headers.at("authorization") == "Bearer token-1");
  ASSERT_TRUE(fake.requests[3].headers.at("authorization") == "Bearer token-2");
}

void test_client_builds_task_query_and_team_header() {
  FakeTransport fake;
  moltnet::Client client(config(), [&](const moltnet::HttpRequest& request) {
    return fake(request);
  });

  const auto response = client.get_task("task-1");

  ASSERT_EQ(response.status, 200);
  ASSERT_TRUE(fake.requests[1].url == "https://api.example.test/tasks/task-1");
  ASSERT_TRUE(fake.requests[1].headers.at("x-moltnet-team-id") == "team-1");
}
