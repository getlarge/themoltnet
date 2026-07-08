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
    if (request.url ==
        "https://api.example.test/tasks?statuses=waiting&statuses=queued&taskTypes=freeform&profileId=profile-1&limit=5") {
      task_requests++;
      if (task_requests == 1) return {401, {}, "{\"code\":\"UNAUTHORIZED\"}"};
      return {200, {}, "{\"tasks\":[]}"};
    }
    if (request.url ==
        "https://api.example.test/tasks?query=complexity%20review&statuses=queued&statuses=running&statuses=completed&taskTypes=pr_review&tags=review%3Acomplexity&tags=repo%3Agetlarge%2Fthemolt.net&excludeTags=draft&diaryId=diary-1&profileId=profile-1&correlationId=correlation-1&proposedByAgentId=agent-1&proposedByHumanId=human-1&claimedByAgentId=worker-1&hasAttempts=true&queuedAfter=2026-07-08T00%3A00%3A00Z&queuedBefore=2026-07-09T00%3A00%3A00Z&completedAfter=2026-07-08T01%3A00%3A00Z&completedBefore=2026-07-09T01%3A00%3A00Z&limit=10&cursor=cursor%2B1") {
      return {200, {}, "{\"tasks\":[{\"id\":\"review-task\"}]}"};
    }
    if (request.url == "https://api.example.test/agents/whoami") {
      return {200, {}, "{\"fingerprint\":\"ABCD-EFGH-IJKL-MNOP\"}"};
    }
    if (request.url ==
        "https://api.example.test/runtime-models?provider=openai%2Fazure") {
      return {200, {}, "{\"items\":[{\"id\":\"model-1\"}]}"};
    }
    if (request.url ==
        "https://api.example.test/runtime-models/model%2F1") {
      return {200, {}, "{\"id\":\"model/1\"}"};
    }
    if (request.url == "https://api.example.test/runtime-profiles") {
      return {200, {}, "{\"items\":[{\"id\":\"profile-1\"}]}"};
    }
    if (request.url ==
        "https://api.example.test/runtime-profiles/profile%2F1") {
      return {200, {}, "{\"id\":\"profile/1\"}"};
    }
    if (request.url == "https://api.example.test/tasks/task-1") {
      return {200, {}, "{\"id\":\"task-1\"}"};
    }
    if (request.url ==
        "https://api.example.test/tasks/task%2F1/attempts/2/artifacts/bagaaiera%2Fcid/content") {
      return {200,
              {{"content-type", "application/octet-stream"}},
              "{\"artifacts\":[{\"kind\":\"issue_lifecycle_state\"}]}"};
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
  query.statuses = {"waiting", "queued"};
  query.profile_id = "profile-1";
  query.task_types = {"freeform"};
  query.limit = 5;
  const auto response = client.list_tasks(query);

  ASSERT_EQ(response.status, 200);
  ASSERT_EQ(fake.token_requests, 2);
  ASSERT_EQ(fake.task_requests, 2);
  ASSERT_TRUE(fake.requests[1].headers.at("authorization") == "Bearer token-1");
  ASSERT_TRUE(fake.requests[3].headers.at("authorization") == "Bearer token-2");
}

void test_client_reads_identity_runtime_models_and_profiles() {
  FakeTransport fake;
  moltnet::Client client(config(), [&](const moltnet::HttpRequest& request) {
    return fake(request);
  });

  const auto whoami = client.whoami();
  ASSERT_EQ(whoami.status, 200);
  ASSERT_TRUE(whoami.body.find("ABCD-EFGH-IJKL-MNOP") != std::string::npos);

  moltnet::RuntimeModelsQuery models_query;
  models_query.provider = "openai/azure";
  const auto models = client.list_runtime_models(models_query);
  ASSERT_EQ(models.status, 200);
  ASSERT_TRUE(models.body.find("model-1") != std::string::npos);

  const auto model = client.get_runtime_model("model/1");
  ASSERT_EQ(model.status, 200);
  ASSERT_TRUE(model.body.find("model/1") != std::string::npos);

  const auto profiles = client.list_runtime_profiles();
  ASSERT_EQ(profiles.status, 200);
  ASSERT_TRUE(profiles.body.find("profile-1") != std::string::npos);
  ASSERT_TRUE(fake.requests.back().headers.at("x-moltnet-team-id") ==
              "team-1");

  const auto profile = client.get_runtime_profile("profile/1");
  ASSERT_EQ(profile.status, 200);
  ASSERT_TRUE(profile.body.find("profile/1") != std::string::npos);
  ASSERT_TRUE(fake.requests.back().headers.at("x-moltnet-team-id") ==
              "team-1");
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

void test_client_builds_full_task_query_filters() {
  FakeTransport fake;
  moltnet::Client client(config(), [&](const moltnet::HttpRequest& request) {
    return fake(request);
  });

  moltnet::TasksQuery query;
  query.query = "complexity review";
  query.statuses = {"queued", "running", "completed"};
  query.task_types = {"pr_review"};
  query.tags = {"review:complexity", "repo:getlarge/themolt.net"};
  query.exclude_tags = {"draft"};
  query.diary_id = "diary-1";
  query.profile_id = "profile-1";
  query.correlation_id = "correlation-1";
  query.proposed_by_agent_id = "agent-1";
  query.proposed_by_human_id = "human-1";
  query.claimed_by_agent_id = "worker-1";
  query.has_attempts = true;
  query.queued_after = "2026-07-08T00:00:00Z";
  query.queued_before = "2026-07-09T00:00:00Z";
  query.completed_after = "2026-07-08T01:00:00Z";
  query.completed_before = "2026-07-09T01:00:00Z";
  query.limit = 10;
  query.cursor = "cursor+1";

  const auto response = client.list_tasks(query);

  ASSERT_EQ(response.status, 200);
  ASSERT_TRUE(response.body.find("review-task") != std::string::npos);
  ASSERT_TRUE(fake.requests[1].headers.at("x-moltnet-team-id") == "team-1");
}

void test_client_downloads_task_artifact_content() {
  FakeTransport fake;
  moltnet::Client client(config(), [&](const moltnet::HttpRequest& request) {
    return fake(request);
  });

  const auto response =
      client.download_task_artifact("task/1", 2, "bagaaiera/cid");

  ASSERT_EQ(response.status, 200);
  ASSERT_TRUE(response.body.find("issue_lifecycle_state") !=
              std::string::npos);
  ASSERT_TRUE(
      fake.requests[1].url ==
      "https://api.example.test/tasks/task%2F1/attempts/2/artifacts/bagaaiera%2Fcid/content");
  ASSERT_TRUE(fake.requests[1].headers.at("x-moltnet-team-id") == "team-1");
}
