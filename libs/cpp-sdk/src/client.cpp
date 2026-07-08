#include "moltnet/client.hpp"

#include <chrono>
#include <algorithm>
#include <stdexcept>
#include <utility>
#include <vector>

#include "json.hpp"
#include "query.hpp"

namespace moltnet {

namespace {

long long now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

std::string form_encode_credentials(const Config& config) {
  return "grant_type=client_credentials&client_id=" +
         query::encode(config.client_id) + "&client_secret=" +
         query::encode(config.client_secret);
}

void ensure_success(const HttpResponse& response, const std::string& context) {
  if (response.status < 200 || response.status >= 300) {
    throw std::runtime_error(context + " failed with HTTP " +
                             std::to_string(response.status) + ": " +
                             response.body);
  }
}

}  // namespace

Client::Client(Config config, Transport transport)
    : config_(std::move(config)), transport_(std::move(transport)) {
  if (!transport_) throw std::invalid_argument("transport is required");
  if (!config_.api_url.empty() && config_.api_url.back() == '/') {
    config_.api_url.pop_back();
  }
}

RawResponse Client::list_diaries() { return request_json("GET", "/diaries"); }

RawResponse Client::get_diary(const std::string& id) {
  return request_json("GET", "/diaries/" + query::encode(id));
}

RawResponse Client::list_entries(const std::string& diary_id,
                                 const EntriesQuery& query_value) {
  std::vector<std::string> parts;
  query::add(parts, "limit", query_value.limit);
  query::add(parts, "offset", query_value.offset);
  return request_json("GET",
                      "/diaries/" + query::encode(diary_id) + "/entries",
                      query::join(parts));
}

RawResponse Client::get_entry(const std::string& entry_id) {
  return request_json("GET", "/entries/" + query::encode(entry_id));
}

RawResponse Client::search_entries(const SearchQuery& query_value) {
  return request_json(
      "POST", "/diaries/search", "",
      json::object({
          {"diaryId", query_value.diary_id ? json::quote(*query_value.diary_id) : ""},
          {"query", query_value.query ? json::quote(*query_value.query) : ""},
          {"limit", query_value.limit ? std::to_string(*query_value.limit) : ""},
          {"offset", query_value.offset ? std::to_string(*query_value.offset) : ""},
      }));
}

RawResponse Client::list_tasks(const TasksQuery& query_value) {
  std::vector<std::string> parts;
  query::add(parts, "query", query_value.query);
  query::add(parts, "status", query_value.status);
  query::add_each(parts, "statuses", query_value.statuses);
  query::add_each(parts, "taskTypes", query_value.task_types);
  query::add_each(parts, "tags", query_value.tags);
  query::add_each(parts, "excludeTags", query_value.exclude_tags);
  query::add(parts, "diaryId", query_value.diary_id);
  query::add(parts, "profileId", query_value.profile_id);
  query::add(parts, "correlationId", query_value.correlation_id);
  query::add(parts, "proposedByAgentId", query_value.proposed_by_agent_id);
  query::add(parts, "proposedByHumanId", query_value.proposed_by_human_id);
  query::add(parts, "claimedByAgentId", query_value.claimed_by_agent_id);
  query::add(parts, "hasAttempts", query_value.has_attempts);
  query::add(parts, "queuedAfter", query_value.queued_after);
  query::add(parts, "queuedBefore", query_value.queued_before);
  query::add(parts, "completedAfter", query_value.completed_after);
  query::add(parts, "completedBefore", query_value.completed_before);
  query::add(parts, "limit", query_value.limit);
  query::add(parts, "cursor", query_value.cursor);
  return request_json("GET", "/tasks", query::join(parts), "", true);
}

RawResponse Client::get_task(const std::string& id) {
  return request_json("GET", "/tasks/" + query::encode(id), "", "", true);
}

RawResponse Client::list_task_schemas() {
  return request_json("GET", "/tasks/schemas");
}

RawResponse Client::list_task_attempts(const std::string& task_id) {
  return request_json("GET", "/tasks/" + query::encode(task_id) + "/attempts",
                      "", "", true);
}

RawResponse Client::list_task_messages(const std::string& task_id,
                                       int attempt_n,
                                       const MessagesQuery& query_value) {
  std::vector<std::string> parts;
  query::add(parts, "afterSeq", query_value.after_seq);
  query::add(parts, "limit", query_value.limit);
  return request_json("GET",
                      "/tasks/" + query::encode(task_id) + "/attempts/" +
                          std::to_string(attempt_n) + "/messages",
                      query::join(parts), "", true);
}

RawResponse Client::list_task_artifacts(const std::string& task_id,
                                        const PageQuery& query_value) {
  std::vector<std::string> parts;
  query::add(parts, "limit", query_value.limit);
  query::add(parts, "cursor", query_value.cursor);
  return request_json("GET", "/tasks/" + query::encode(task_id) + "/artifacts",
                      query::join(parts), "", true);
}

RawResponse Client::download_task_artifact(const std::string& task_id,
                                           int attempt_n,
                                           const std::string& cid) {
  return request_json("GET",
                      "/tasks/" + query::encode(task_id) + "/attempts/" +
                          std::to_string(attempt_n) + "/artifacts/" +
                          query::encode(cid) + "/content",
                      "", "", true);
}

void Client::invalidate_token() {
  access_token_.clear();
  token_expires_at_ms_ = 0;
}

std::string Client::get_token() {
  if (!access_token_.empty() && now_ms() < token_expires_at_ms_) {
    return access_token_;
  }
  return authenticate();
}

std::string Client::authenticate() {
  if (config_.client_id.empty() || config_.client_secret.empty()) {
    throw std::runtime_error("client_id and client_secret are required");
  }

  HttpRequest request;
  request.method = "POST";
  request.url = config_.api_url + "/oauth2/token";
  request.headers["content-type"] = "application/x-www-form-urlencoded";
  request.body = form_encode_credentials(config_);

  const auto response = transport_(request);
  ensure_success(response, "OAuth token request");

  const auto token = json::string_field(response.body, "access_token");
  const auto expires_in = json::int_field(response.body, "expires_in");
  if (!token || !expires_in) {
    throw std::runtime_error("OAuth token response missing access_token or expires_in");
  }

  access_token_ = *token;
  const int usable_lifetime_seconds =
      std::max(1, *expires_in - config_.token_expiry_buffer_seconds);
  token_expires_at_ms_ = now_ms() + (usable_lifetime_seconds * 1000LL);
  return access_token_;
}

RawResponse Client::request_json(const std::string& method,
                                 const std::string& path,
                                 const std::string& query_string,
                                 const std::string& body,
                                 bool team_required) {
  auto perform = [&]() {
    HttpRequest request;
    request.method = method;
    request.url = config_.api_url + path +
                  (query_string.empty() ? "" : "?" + query_string);
    request.headers["accept"] = "application/json";
    request.headers["authorization"] = "Bearer " + get_token();
    if (!body.empty()) request.headers["content-type"] = "application/json";
    if (!config_.team_id.empty()) {
      request.headers["x-moltnet-team-id"] = config_.team_id;
    } else if (team_required) {
      throw std::runtime_error("team_id is required for this endpoint");
    }
    request.body = body;
    return transport_(request);
  };

  auto response = perform();
  if (response.status == 401) {
    invalidate_token();
    response = perform();
  }
  return RawResponse{response.status, response.body};
}

}  // namespace moltnet
