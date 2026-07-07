#include "json.hpp"

#include <cctype>
#include <sstream>

#if __has_include(<ArduinoJson.h>)
#include <ArduinoJson.h>
#define MOLTNET_HAS_ARDUINOJSON 1
#else
#define MOLTNET_HAS_ARDUINOJSON 0
#endif

namespace moltnet::json {

std::optional<std::string> string_field(const std::string& body,
                                        const std::string& key) {
#if MOLTNET_HAS_ARDUINOJSON
  ArduinoJson::JsonDocument doc;
  if (ArduinoJson::deserializeJson(doc, body)) {
    return std::nullopt;
  }
  if (!doc[key].is<const char*>()) {
    return std::nullopt;
  }
  return std::string(doc[key].as<const char*>());
#else
  const std::string needle = "\"" + key + "\"";
  const auto key_pos = body.find(needle);
  if (key_pos == std::string::npos) return std::nullopt;
  const auto colon = body.find(':', key_pos + needle.size());
  if (colon == std::string::npos) return std::nullopt;
  auto pos = colon + 1;
  while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) {
    pos++;
  }
  if (pos >= body.size() || body[pos] != '"') return std::nullopt;
  pos++;
  std::string value;
  while (pos < body.size()) {
    const char ch = body[pos++];
    if (ch == '"') return value;
    if (ch == '\\' && pos < body.size()) {
      const char escaped = body[pos++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          value.push_back(escaped);
          break;
        case 'n':
          value.push_back('\n');
          break;
        case 'r':
          value.push_back('\r');
          break;
        case 't':
          value.push_back('\t');
          break;
        default:
          value.push_back(escaped);
      }
    } else {
      value.push_back(ch);
    }
  }
  return std::nullopt;
#endif
}

std::optional<int> int_field(const std::string& body, const std::string& key) {
#if MOLTNET_HAS_ARDUINOJSON
  ArduinoJson::JsonDocument doc;
  if (ArduinoJson::deserializeJson(doc, body)) {
    return std::nullopt;
  }
  if (!doc[key].is<int>()) {
    return std::nullopt;
  }
  return doc[key].as<int>();
#else
  const std::string needle = "\"" + key + "\"";
  const auto key_pos = body.find(needle);
  if (key_pos == std::string::npos) return std::nullopt;
  const auto colon = body.find(':', key_pos + needle.size());
  if (colon == std::string::npos) return std::nullopt;
  auto pos = colon + 1;
  while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) {
    pos++;
  }
  bool negative = false;
  if (pos < body.size() && body[pos] == '-') {
    negative = true;
    pos++;
  }
  if (pos >= body.size() || !std::isdigit(static_cast<unsigned char>(body[pos]))) {
    return std::nullopt;
  }
  int value = 0;
  while (pos < body.size() && std::isdigit(static_cast<unsigned char>(body[pos]))) {
    value = value * 10 + (body[pos++] - '0');
  }
  return negative ? -value : value;
#endif
}

std::string quote(const std::string& value) {
  std::ostringstream out;
  out << '"';
  for (const char ch : value) {
    switch (ch) {
      case '"':
        out << "\\\"";
        break;
      case '\\':
        out << "\\\\";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        out << ch;
    }
  }
  out << '"';
  return out.str();
}

std::string object(std::vector<std::pair<std::string, std::string>> fields) {
  std::ostringstream out;
  out << '{';
  bool first = true;
  for (const auto& field : fields) {
    if (field.second.empty()) continue;
    if (!first) out << ',';
    first = false;
    out << quote(field.first) << ':' << field.second;
  }
  out << '}';
  return out.str();
}

}  // namespace moltnet::json
