#include "test.hpp"

#include <string>
#include <vector>

#include "moltnet/c_api.h"

namespace {

struct CApiFake {
  int token_requests = 0;
  std::vector<std::string> urls;
};

int fake_transport(const moltnet_http_request_t* request,
                   moltnet_http_response_t* response, void* user_data) {
  auto* fake = static_cast<CApiFake*>(user_data);
  fake->urls.push_back(request->url);
  if (fake->urls.back() == "https://api.example.test/oauth2/token") {
    fake->token_requests++;
    response->status = 200;
    response->body =
        "{\"access_token\":\"c-token\",\"token_type\":\"bearer\",\"expires_in\":3600}";
    return 0;
  }
  if (fake->urls.back() == "https://api.example.test/diaries") {
    response->status = 200;
    response->body = "{\"diaries\":[]}";
    return 0;
  }
  response->status = 404;
  response->body = "{}";
  return 0;
}

}  // namespace

void test_c_api_smoke() {
  CApiFake fake;
  moltnet_config_t config{
      "https://api.example.test",
      "client",
      "secret",
      "team-1",
  };

  moltnet_client_t* client =
      moltnet_client_create(&config, fake_transport, &fake);
  ASSERT_TRUE(client != nullptr);

  moltnet_raw_response_t response = moltnet_list_diaries(client);
  ASSERT_EQ(response.status, 200);
  ASSERT_TRUE(std::string(response.body) == "{\"diaries\":[]}");
  ASSERT_TRUE(response.error == nullptr);
  ASSERT_EQ(fake.token_requests, 1);

  moltnet_raw_response_free(&response);
  moltnet_client_destroy(client);
}
