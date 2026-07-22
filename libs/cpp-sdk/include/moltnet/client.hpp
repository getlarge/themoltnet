#pragma once

#include <optional>
#include <string>
#include <vector>

#include "moltnet/http.hpp"

namespace moltnet {

struct Config {
  std::string api_url = "https://api.themolt.net";
  std::string client_id;
  std::string client_secret;
  std::string team_id;
  int token_expiry_buffer_seconds = 30;
};

struct RawResponse {
  int status = 0;
  std::string body;
};

struct PageQuery {
  std::optional<int> limit;
  std::optional<std::string> cursor;
};

struct RuntimeModelsQuery {
  std::optional<std::string> provider;
};

struct EntriesQuery {
  std::optional<int> limit;
  std::optional<int> offset;
};

struct SearchQuery {
  std::optional<std::string> diary_id;
  std::optional<std::string> query;
  std::optional<int> limit;
  std::optional<int> offset;
};

struct TasksQuery {
  std::optional<std::string> query;
  std::optional<std::string> status;
  std::vector<std::string> statuses;
  std::vector<std::string> task_types;
  std::vector<std::string> tags;
  std::vector<std::string> exclude_tags;
  std::optional<std::string> diary_id;
  std::optional<std::string> profile_id;
  std::optional<std::string> correlation_id;
  std::optional<std::string> proposed_by_agent_id;
  std::optional<std::string> proposed_by_human_id;
  std::optional<std::string> claimed_by_agent_id;
  std::optional<bool> has_attempts;
  std::optional<std::string> queued_after;
  std::optional<std::string> queued_before;
  std::optional<std::string> completed_after;
  std::optional<std::string> completed_before;
  std::optional<int> limit;
  std::optional<std::string> cursor;
};

struct MessagesQuery {
  std::optional<int> after_seq;
  std::optional<int> limit;
};

Config load_config();

class Client {
 public:
  Client(Config config, Transport transport);

  RawResponse whoami();
  RawResponse list_runtime_models(const RuntimeModelsQuery& query = {});
  RawResponse get_runtime_model(const std::string& model_id);
  RawResponse list_runtime_profiles();
  RawResponse get_runtime_profile(const std::string& profile_id);

  RawResponse list_diaries();
  RawResponse get_diary(const std::string& id);
  RawResponse list_entries(const std::string& diary_id,
                           const EntriesQuery& query = {});
  RawResponse get_entry(const std::string& entry_id);
  RawResponse search_entries(const SearchQuery& query = {});

  RawResponse list_tasks(const TasksQuery& query = {});
  RawResponse get_task(const std::string& id);
  RawResponse list_task_schemas();
  RawResponse list_task_attempts(const std::string& task_id);
  RawResponse list_task_messages(const std::string& task_id, int attempt_n,
                                 const MessagesQuery& query = {});
  RawResponse list_task_artifacts(const std::string& task_id,
                                  const PageQuery& query = {});
  RawResponse download_task_artifact(const std::string& task_id,
                                     const std::string& cid);
  RawResponse download_task_artifact(const std::string& task_id, int attempt_n,
                                     const std::string& cid);

  void invalidate_token();

 private:
  Config config_;
  Transport transport_;
  std::string access_token_;
  long long token_expires_at_ms_ = 0;

  RawResponse request_json(const std::string& method, const std::string& path,
                           const std::string& query = "",
                           const std::string& body = "",
                           bool team_required = false);
  std::string get_token();
  std::string authenticate();
};

}  // namespace moltnet
