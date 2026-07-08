#pragma once

#include <optional>
#include <string>
#include <vector>

namespace moltnet::query {

std::string encode(const std::string& value);
void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<std::string>& value);
void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<int>& value);
void add(std::vector<std::string>& parts, const std::string& key,
         const std::optional<bool>& value);
void add_each(std::vector<std::string>& parts, const std::string& key,
              const std::vector<std::string>& values);
std::string join(const std::vector<std::string>& parts);

}  // namespace moltnet::query
