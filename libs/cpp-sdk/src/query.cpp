#include "query.hpp"

#include <iomanip>
#include <sstream>

namespace moltnet::query {

std::string encode(const std::string& value) {
  std::ostringstream out;
  for (const unsigned char ch : value) {
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
        (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' ||
        ch == '~') {
      out << ch;
    } else {
      out << '%' << std::uppercase << std::hex << std::setw(2)
          << std::setfill('0') << static_cast<int>(ch) << std::nouppercase
          << std::dec;
    }
  }
  return out.str();
}

void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<std::string>& value) {
  if (value && !value->empty()) parts.push_back(encode(key) + "=" + encode(*value));
}

void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<int>& value) {
  if (value) parts.push_back(encode(key) + "=" + std::to_string(*value));
}

void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<bool>& value) {
  if (value) parts.push_back(encode(key) + "=" + (*value ? "true" : "false"));
}

void add_each(std::vector<std::string>& parts, const std::string& key,
              const std::vector<std::string>& values) {
  for (const auto& value : values) {
    if (!value.empty()) parts.push_back(encode(key) + "=" + encode(value));
  }
}

std::string join(const std::vector<std::string>& parts) {
  std::ostringstream out;
  for (size_t i = 0; i < parts.size(); i++) {
    if (i > 0) out << '&';
    out << parts[i];
  }
  return out.str();
}

}  // namespace moltnet::query
