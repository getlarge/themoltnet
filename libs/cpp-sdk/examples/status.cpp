#include <iostream>
#include <stdexcept>

#include "moltnet/client.hpp"

int main() {
  std::cerr << "moltnet-native-status is transport-abstracted.\n";
  std::cerr << "Provide a real HTTP transport before using it against MoltNet.\n";

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
    return moltnet::HttpResponse{200, {}, "{\"example\":true,\"url\":\"" +
                                            request.url + "\"}"};
  });

  std::cout << client.list_diaries().body << '\n';
  moltnet::TasksQuery query;
  query.limit = 5;
  if (!config.team_id.empty()) {
    std::cout << client.list_tasks(query).body << '\n';
  }
  return 0;
}
