#include "moltnet/c_api.h"

#include <exception>
#include <memory>
#include <string>
#include <vector>

#include "moltnet/client.hpp"

struct moltnet_client {
  moltnet::Client client;

  moltnet_client(moltnet::Config config, moltnet::Transport transport)
      : client(std::move(config), std::move(transport)) {}
};

namespace {

char* copy_string(const std::string& value) {
  char* result = new char[value.size() + 1];
  std::copy(value.begin(), value.end(), result);
  result[value.size()] = '\0';
  return result;
}

moltnet::Config to_config(const moltnet_config_t* input) {
  moltnet::Config config;
  if (input == nullptr) return config;
  if (input->api_url != nullptr && input->api_url[0] != '\0') config.api_url = input->api_url;
  if (input->client_id != nullptr) config.client_id = input->client_id;
  if (input->client_secret != nullptr) config.client_secret = input->client_secret;
  if (input->team_id != nullptr) config.team_id = input->team_id;
  return config;
}

moltnet_raw_response_t ok(moltnet::RawResponse response) {
  return moltnet_raw_response_t{response.status, copy_string(response.body), nullptr};
}

moltnet_raw_response_t fail(const std::exception& error) {
  return moltnet_raw_response_t{0, nullptr, copy_string(error.what())};
}

moltnet_raw_response_t fail_text(const std::string& error) {
  return moltnet_raw_response_t{0, nullptr, copy_string(error)};
}

}  // namespace

moltnet_client_t* moltnet_client_create(const moltnet_config_t* config,
                                        moltnet_transport_fn transport,
                                        void* user_data) {
  if (transport == nullptr) return nullptr;

  auto cpp_transport = [transport, user_data](const moltnet::HttpRequest& request) {
    std::vector<moltnet_http_header_t> request_headers;
    request_headers.reserve(request.headers.size());
    for (const auto& header : request.headers) {
      request_headers.push_back({header.first.c_str(), header.second.c_str()});
    }

    moltnet_http_request_t c_request{
        request.method.c_str(),
        request.url.c_str(),
        request_headers.data(),
        static_cast<int>(request_headers.size()),
        request.body.c_str(),
    };
    moltnet_http_response_t c_response{0, nullptr, 0, nullptr};
    const int rc = transport(&c_request, &c_response, user_data);
    if (rc != 0) throw std::runtime_error("transport returned non-zero status");

    moltnet::HttpResponse response;
    response.status = c_response.status;
    if (c_response.body != nullptr) response.body = c_response.body;
    for (int i = 0; i < c_response.header_count; i++) {
      response.headers[c_response.headers[i].name] = c_response.headers[i].value;
    }
    return response;
  };

  try {
    return new moltnet_client(to_config(config), cpp_transport);
  } catch (...) {
    return nullptr;
  }
}

void moltnet_client_destroy(moltnet_client_t* client) { delete client; }

void moltnet_free_string(char* value) { delete[] value; }

void moltnet_raw_response_free(moltnet_raw_response_t* response) {
  if (response == nullptr) return;
  moltnet_free_string(response->body);
  moltnet_free_string(response->error);
  response->body = nullptr;
  response->error = nullptr;
}

moltnet_raw_response_t moltnet_list_diaries(moltnet_client_t* client) {
  if (client == nullptr) return fail_text("client is null");
  try {
    return ok(client->client.list_diaries());
  } catch (const std::exception& error) {
    return fail(error);
  }
}

moltnet_raw_response_t moltnet_get_diary(moltnet_client_t* client,
                                         const char* id) {
  if (client == nullptr) return fail_text("client is null");
  try {
    return ok(client->client.get_diary(id == nullptr ? "" : id));
  } catch (const std::exception& error) {
    return fail(error);
  }
}

moltnet_raw_response_t moltnet_list_tasks(moltnet_client_t* client,
                                          const char* status, int limit) {
  if (client == nullptr) return fail_text("client is null");
  try {
    moltnet::TasksQuery query;
    if (status != nullptr && status[0] != '\0') query.status = status;
    if (limit > 0) query.limit = limit;
    return ok(client->client.list_tasks(query));
  } catch (const std::exception& error) {
    return fail(error);
  }
}

moltnet_raw_response_t moltnet_get_task(moltnet_client_t* client,
                                        const char* id) {
  if (client == nullptr) return fail_text("client is null");
  try {
    return ok(client->client.get_task(id == nullptr ? "" : id));
  } catch (const std::exception& error) {
    return fail(error);
  }
}

moltnet_raw_response_t moltnet_list_task_messages(moltnet_client_t* client,
                                                  const char* task_id,
                                                  int attempt_n,
                                                  int after_seq,
                                                  int limit) {
  if (client == nullptr) return fail_text("client is null");
  try {
    moltnet::MessagesQuery query;
    if (after_seq >= 0) query.after_seq = after_seq;
    if (limit > 0) query.limit = limit;
    return ok(client->client.list_task_messages(task_id == nullptr ? "" : task_id,
                                                attempt_n, query));
  } catch (const std::exception& error) {
    return fail(error);
  }
}
