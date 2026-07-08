#include "moltnet/client.hpp"

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <stdexcept>

#include "json.hpp"

namespace moltnet {

namespace {

std::optional<std::string> env(const char* name) {
  const char* value = std::getenv(name);
  if (value == nullptr || value[0] == '\0') return std::nullopt;
  return std::string(value);
}

std::string home_config_path() {
  if (const auto home = env("HOME")) {
    return *home + "/.config/moltnet/moltnet.json";
  }
  return "";
}

std::string read_file(const std::string& path) {
  std::ifstream file(path);
  if (!file) return "";
  std::ostringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

std::optional<std::string> nested_string_field(const std::string& body,
                                               const std::string& object_key,
                                               const std::string& field_key) {
  const std::string needle = "\"" + object_key + "\"";
  const auto object_pos = body.find(needle);
  if (object_pos == std::string::npos) return std::nullopt;
  const auto object_start = body.find('{', object_pos + needle.size());
  if (object_start == std::string::npos) return std::nullopt;
  const auto object_end = body.find('}', object_start + 1);
  if (object_end == std::string::npos) return std::nullopt;
  return json::string_field(body.substr(object_start, object_end - object_start + 1),
                            field_key);
}

}  // namespace

Config load_config() {
  Config config;
  const auto body = read_file(home_config_path());

  if (!body.empty()) {
    if (auto value = nested_string_field(body, "endpoints", "api")) {
      config.api_url = *value;
    }
    if (auto value = nested_string_field(body, "oauth2", "client_id")) {
      config.client_id = *value;
    }
    if (auto value = nested_string_field(body, "oauth2", "client_secret")) {
      config.client_secret = *value;
    }
    if (auto value = json::string_field(body, "team_id")) {
      config.team_id = *value;
    }
  }

  if (auto value = env("MOLTNET_API_URL")) config.api_url = *value;
  if (auto value = env("MOLTNET_CLIENT_ID")) config.client_id = *value;
  if (auto value = env("MOLTNET_CLIENT_SECRET")) config.client_secret = *value;
  if (auto value = env("MOLTNET_TEAM_ID")) config.team_id = *value;

  if (!config.api_url.empty() && config.api_url.back() == '/') {
    config.api_url.pop_back();
  }
  return config;
}

}  // namespace moltnet
