#pragma once

#include <optional>
#include <string>
#include <vector>

namespace moltnet::json {

std::optional<std::string> string_field(const std::string& body,
                                        const std::string& key);
std::optional<int> int_field(const std::string& body, const std::string& key);
std::string object(std::vector<std::pair<std::string, std::string>> fields);
std::string quote(const std::string& value);

}  // namespace moltnet::json
