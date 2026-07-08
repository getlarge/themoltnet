#include "moltnet/client.hpp"

#include <arpa/inet.h>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {

constexpr int kSocketTimeoutMs = 5000;

struct Url {
  std::string host;
  std::string port;
  std::string target;
};

std::string read_file(const std::string& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("failed to open " + path);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

std::optional<std::string> string_field(const std::string& json,
                                        const std::string& name) {
  const std::string key = "\"" + name + "\"";
  auto pos = json.find(key);
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find(':', pos + key.size());
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find('"', pos + 1);
  if (pos == std::string::npos) return std::nullopt;
  std::string value;
  for (++pos; pos < json.size(); ++pos) {
    const char c = json[pos];
    if (c == '"') return value;
    if (c == '\\' && pos + 1 < json.size()) {
      value.push_back(json[++pos]);
    } else {
      value.push_back(c);
    }
  }
  return std::nullopt;
}

std::string required_field(const std::string& json, const std::string& name) {
  auto value = string_field(json, name);
  if (!value || value->empty()) {
    throw std::runtime_error("missing e2e config field: " + name);
  }
  return *value;
}

Url parse_http_url(const std::string& url) {
  const std::string scheme = "http://";
  if (url.rfind(scheme, 0) != 0) {
    throw std::runtime_error("e2e transport only supports http:// URLs");
  }

  auto rest = url.substr(scheme.size());
  auto slash = rest.find('/');
  auto authority = slash == std::string::npos ? rest : rest.substr(0, slash);
  auto target = slash == std::string::npos ? "/" : rest.substr(slash);
  auto colon = authority.rfind(':');

  if (authority.empty()) throw std::runtime_error("URL host is empty");

  return Url{
      colon == std::string::npos ? authority : authority.substr(0, colon),
      colon == std::string::npos ? "80" : authority.substr(colon + 1),
      target,
  };
}

std::string lower(std::string value) {
  for (char& c : value) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return value;
}

void send_all(int fd, const std::string& data) {
  std::size_t sent = 0;
  while (sent < data.size()) {
    const auto n = send(fd, data.data() + sent, data.size() - sent, 0);
    if (n <= 0) throw std::runtime_error("socket send failed");
    sent += static_cast<std::size_t>(n);
  }
}

void set_blocking(int fd, bool blocking) {
  const int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0) throw std::runtime_error("fcntl(F_GETFL) failed");
  const int next_flags =
      blocking ? (flags & ~O_NONBLOCK) : (flags | O_NONBLOCK);
  if (fcntl(fd, F_SETFL, next_flags) < 0) {
    throw std::runtime_error("fcntl(F_SETFL) failed");
  }
}

void set_io_timeouts(int fd) {
  timeval timeout{};
  timeout.tv_sec = kSocketTimeoutMs / 1000;
  timeout.tv_usec = (kSocketTimeoutMs % 1000) * 1000;
  if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0) {
    throw std::runtime_error("setsockopt(SO_RCVTIMEO) failed");
  }
  if (setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) < 0) {
    throw std::runtime_error("setsockopt(SO_SNDTIMEO) failed");
  }
}

bool connect_with_timeout(int fd, const addrinfo* address) {
  set_blocking(fd, false);
  const int rc = connect(fd, address->ai_addr, address->ai_addrlen);
  if (rc == 0) {
    set_blocking(fd, true);
    return true;
  }
  if (errno != EINPROGRESS) return false;

  pollfd pfd{fd, POLLOUT, 0};
  const int poll_rc = poll(&pfd, 1, kSocketTimeoutMs);
  if (poll_rc <= 0) return false;

  int socket_error = 0;
  socklen_t socket_error_len = sizeof(socket_error);
  if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &socket_error, &socket_error_len) <
      0) {
    return false;
  }
  if (socket_error != 0) return false;

  set_blocking(fd, true);
  return true;
}

std::string recv_all(int fd) {
  std::string response;
  char buffer[4096];
  for (;;) {
    const auto n = recv(fd, buffer, sizeof(buffer), 0);
    if (n < 0) throw std::runtime_error("socket recv failed");
    if (n == 0) break;
    response.append(buffer, static_cast<std::size_t>(n));
  }
  return response;
}

std::string decode_chunked(const std::string& body) {
  std::string decoded;
  std::size_t pos = 0;
  for (;;) {
    const auto line_end = body.find("\r\n", pos);
    if (line_end == std::string::npos) return body;
    const auto size_text = body.substr(pos, line_end - pos);
    const auto size = std::stoul(size_text, nullptr, 16);
    if (size == 0) return decoded;
    pos = line_end + 2;
    if (pos + size > body.size()) return body;
    decoded.append(body, pos, size);
    pos += size + 2;
  }
}

moltnet::HttpResponse socket_transport(const moltnet::HttpRequest& request) {
  const auto url = parse_http_url(request.url);

  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* result = nullptr;
  const int gai = getaddrinfo(url.host.c_str(), url.port.c_str(), &hints,
                              &result);
  if (gai != 0) throw std::runtime_error(gai_strerror(gai));

  int fd = -1;
  for (auto* p = result; p != nullptr; p = p->ai_next) {
    fd = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
    if (fd < 0) continue;
    if (connect_with_timeout(fd, p)) break;
    close(fd);
    fd = -1;
  }
  freeaddrinfo(result);
  if (fd < 0) throw std::runtime_error("failed to connect to " + url.host);
  set_io_timeouts(fd);

  std::ostringstream out;
  out << request.method << ' ' << url.target << " HTTP/1.1\r\n";
  out << "Host: " << url.host << "\r\n";
  out << "Connection: close\r\n";
  for (const auto& [name, value] : request.headers) {
    out << name << ": " << value << "\r\n";
  }
  if (!request.body.empty()) {
    out << "Content-Length: " << request.body.size() << "\r\n";
  }
  out << "\r\n" << request.body;

  send_all(fd, out.str());
  auto raw = recv_all(fd);
  close(fd);

  const auto header_end = raw.find("\r\n\r\n");
  if (header_end == std::string::npos) {
    throw std::runtime_error("HTTP response missing header terminator");
  }

  std::istringstream headers(raw.substr(0, header_end));
  std::string http_version;
  int status = 0;
  headers >> http_version >> status;

  std::string header_blob = lower(raw.substr(0, header_end));
  std::string body = raw.substr(header_end + 4);
  if (header_blob.find("transfer-encoding: chunked") != std::string::npos) {
    body = decode_chunked(body);
  }

  return moltnet::HttpResponse{status, {}, body};
}

void expect_status(const moltnet::RawResponse& response, int status,
                   const std::string& context) {
  if (response.status != status) {
    throw std::runtime_error(context + " returned HTTP " +
                             std::to_string(response.status) + ": " +
                             response.body);
  }
}

void expect_contains(const std::string& body, const std::string& needle,
                     const std::string& context) {
  if (body.find(needle) == std::string::npos) {
    throw std::runtime_error(context + " did not contain " + needle + ": " +
                             body);
  }
}

}  // namespace

int main() {
  try {
    const char* config_env = std::getenv("MOLTNET_CPP_E2E_CONFIG");
    const std::string config_path =
        config_env ? config_env : "/tmp/moltnet-cpp-sdk-e2e-config.json";
    const auto fixture = read_file(config_path);

    moltnet::Config config;
    config.api_url = required_field(fixture, "apiUrl");
    config.client_id = required_field(fixture, "clientId");
    config.client_secret = required_field(fixture, "clientSecret");
    config.team_id = required_field(fixture, "teamId");

    const auto diary_id = required_field(fixture, "diaryId");
    const auto entry_id = required_field(fixture, "entryId");
    const auto task_id = required_field(fixture, "taskId");
    const auto runtime_model_id = required_field(fixture, "runtimeModelId");
    const auto runtime_provider = required_field(fixture, "runtimeProvider");
    const auto runtime_model = required_field(fixture, "runtimeModel");
    const auto profile_id = required_field(fixture, "profileId");
    const auto profiled_task_id = required_field(fixture, "profiledTaskId");
    const auto agent_identity_id = required_field(fixture, "agentIdentityId");
    const auto claimed_task_id = required_field(fixture, "claimedTaskId");
    const auto claimed_by_agent_id =
        required_field(fixture, "claimedByAgentId");
    const auto artifact_task_id = required_field(fixture, "artifactTaskId");
    const auto artifact_attempt_n =
        std::stoi(required_field(fixture, "artifactAttemptN"));
    const auto artifact_cid = required_field(fixture, "artifactCid");
    const auto marker = required_field(fixture, "marker");

    moltnet::Client client(config, socket_transport);

    auto whoami = client.whoami();
    expect_status(whoami, 200, "whoami");
    expect_contains(whoami.body, agent_identity_id, "whoami");

    moltnet::RuntimeModelsQuery runtime_models_query;
    runtime_models_query.provider = runtime_provider;
    auto runtime_models = client.list_runtime_models(runtime_models_query);
    expect_status(runtime_models, 200, "list_runtime_models");
    expect_contains(runtime_models.body, runtime_model_id,
                    "list_runtime_models");
    expect_contains(runtime_models.body, runtime_model, "list_runtime_models");

    auto runtime_model_response = client.get_runtime_model(runtime_model_id);
    expect_status(runtime_model_response, 200, "get_runtime_model");
    expect_contains(runtime_model_response.body, runtime_model_id,
                    "get_runtime_model");

    auto runtime_profiles = client.list_runtime_profiles();
    expect_status(runtime_profiles, 200, "list_runtime_profiles");
    expect_contains(runtime_profiles.body, profile_id, "list_runtime_profiles");

    auto runtime_profile = client.get_runtime_profile(profile_id);
    expect_status(runtime_profile, 200, "get_runtime_profile");
    expect_contains(runtime_profile.body, profile_id, "get_runtime_profile");
    expect_contains(runtime_profile.body, runtime_model, "get_runtime_profile");

    moltnet::EntriesQuery entries_query;
    entries_query.limit = 20;
    auto entries = client.list_entries(diary_id, entries_query);
    expect_status(entries, 200, "list_entries");
    expect_contains(entries.body, entry_id, "list_entries");
    expect_contains(entries.body, marker, "list_entries");

    auto entry = client.get_entry(entry_id);
    expect_status(entry, 200, "get_entry");
    expect_contains(entry.body, entry_id, "get_entry");
    expect_contains(entry.body, marker, "get_entry");

    moltnet::SearchQuery search_query;
    search_query.diary_id = diary_id;
    search_query.query = marker;
    search_query.limit = 5;
    auto search = client.search_entries(search_query);
    expect_status(search, 200, "search_entries");
    expect_contains(search.body, entry_id, "search_entries");

    moltnet::TasksQuery tasks_query;
    tasks_query.diary_id = diary_id;
    tasks_query.limit = 20;
    auto tasks = client.list_tasks(tasks_query);
    expect_status(tasks, 200, "list_tasks");
    expect_contains(tasks.body, task_id, "list_tasks");

    moltnet::TasksQuery tagged_tasks_query;
    tagged_tasks_query.task_types = {"curate_pack"};
    tagged_tasks_query.tags = {"cpp-sdk-e2e", marker};
    tagged_tasks_query.limit = 20;
    auto tagged_tasks = client.list_tasks(tagged_tasks_query);
    expect_status(tagged_tasks, 200, "list_tasks tag filters");
    expect_contains(tagged_tasks.body, task_id, "list_tasks tag filters");

    moltnet::TasksQuery profiled_tasks_query;
    profiled_tasks_query.statuses = {"waiting", "queued"};
    profiled_tasks_query.task_types = {"curate_pack"};
    profiled_tasks_query.profile_id = profile_id;
    profiled_tasks_query.limit = 100;
    auto profiled_tasks = client.list_tasks(profiled_tasks_query);
    expect_status(profiled_tasks, 200, "list_tasks profile/status filters");
    expect_contains(profiled_tasks.body, profiled_task_id,
                    "list_tasks profile/status filters");

    moltnet::TasksQuery claimed_tasks_query;
    claimed_tasks_query.statuses = {"dispatched", "running"};
    claimed_tasks_query.task_types = {"curate_pack"};
    claimed_tasks_query.claimed_by_agent_id = claimed_by_agent_id;
    claimed_tasks_query.limit = 100;
    auto claimed_tasks = client.list_tasks(claimed_tasks_query);
    expect_status(claimed_tasks, 200, "list_tasks claimant/status filters");
    expect_contains(claimed_tasks.body, claimed_task_id,
                    "list_tasks claimant/status filters");

    auto artifact_list = client.list_task_artifacts(artifact_task_id);
    expect_status(artifact_list, 200, "list_task_artifacts");
    expect_contains(artifact_list.body, artifact_cid, "list_task_artifacts");

    auto artifact_content = client.download_task_artifact(
        artifact_task_id, artifact_attempt_n, artifact_cid);
    expect_status(artifact_content, 200, "download_task_artifact");
    expect_contains(artifact_content.body, marker, "download_task_artifact");
    expect_contains(artifact_content.body, "issue_lifecycle_state",
                    "download_task_artifact");

    auto task = client.get_task(task_id);
    expect_status(task, 200, "get_task");
    expect_contains(task.body, task_id, "get_task");
    expect_contains(task.body, marker, "get_task");

    auto schemas = client.list_task_schemas();
    expect_status(schemas, 200, "list_task_schemas");
    expect_contains(schemas.body, "curate_pack", "list_task_schemas");

    std::cout << "MoltNet C++ SDK e2e passed for " << marker << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "MoltNet C++ SDK e2e failed: " << error.what() << '\n';
    return 1;
  }
}
