#include <chrono>
#include <iostream>
#include <thread>

#include "moltnet/client.hpp"

int main() {
  moltnet::Config config = moltnet::load_config();
  config.client_id = config.client_id.empty() ? "example-client" : config.client_id;
  config.client_secret =
      config.client_secret.empty() ? "example-secret" : config.client_secret;

  moltnet::Client client(config, [](const moltnet::HttpRequest& request) {
    if (request.url.find("/oauth2/token") != std::string::npos) {
      return moltnet::HttpResponse{
          200,
          {},
          "{\"access_token\":\"example-token\",\"token_type\":\"bearer\",\"expires_in\":3600}",
      };
    }
    return moltnet::HttpResponse{200, {}, "{\"kind\":\"poll\",\"url\":\"" +
                                            request.url + "\"}"};
  });

  for (int i = 0; i < 3; i++) {
    moltnet::TasksQuery query;
    query.limit = 10;
    const auto response = config.team_id.empty()
                              ? moltnet::RawResponse{200, "{\"tasks\":[]}"}
                              : client.list_tasks(query);
    std::cout << "{\"event\":\"tasks\",\"status\":" << response.status
              << ",\"body\":" << response.body << "}" << std::endl;
    std::this_thread::sleep_for(std::chrono::seconds(1));
  }
  return 0;
}
