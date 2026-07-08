#pragma once

#include <functional>
#include <map>
#include <string>

namespace moltnet {

using Headers = std::map<std::string, std::string>;

struct HttpRequest {
  std::string method;
  std::string url;
  Headers headers;
  std::string body;
};

struct HttpResponse {
  int status = 0;
  Headers headers;
  std::string body;
};

using Transport = std::function<HttpResponse(const HttpRequest&)>;

}  // namespace moltnet
