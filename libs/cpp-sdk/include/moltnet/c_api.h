#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct moltnet_client moltnet_client_t;

typedef struct moltnet_config {
  const char* api_url;
  const char* client_id;
  const char* client_secret;
  const char* team_id;
} moltnet_config_t;

typedef struct moltnet_http_header {
  const char* name;
  const char* value;
} moltnet_http_header_t;

typedef struct moltnet_http_request {
  const char* method;
  const char* url;
  const moltnet_http_header_t* headers;
  int header_count;
  const char* body;
} moltnet_http_request_t;

typedef struct moltnet_http_response {
  int status;
  const moltnet_http_header_t* headers;
  int header_count;
  const char* body;
} moltnet_http_response_t;

typedef int (*moltnet_transport_fn)(const moltnet_http_request_t* request,
                                    moltnet_http_response_t* response,
                                    void* user_data);

typedef struct moltnet_raw_response {
  int status;
  char* body;
  char* error;
} moltnet_raw_response_t;

moltnet_client_t* moltnet_client_create(const moltnet_config_t* config,
                                        moltnet_transport_fn transport,
                                        void* user_data);
void moltnet_client_destroy(moltnet_client_t* client);

void moltnet_free_string(char* value);
void moltnet_raw_response_free(moltnet_raw_response_t* response);

moltnet_raw_response_t moltnet_whoami(moltnet_client_t* client);
moltnet_raw_response_t moltnet_list_runtime_models(moltnet_client_t* client,
                                                   const char* provider);
moltnet_raw_response_t moltnet_get_runtime_model(moltnet_client_t* client,
                                                 const char* model_id);
moltnet_raw_response_t moltnet_list_runtime_profiles(moltnet_client_t* client);
moltnet_raw_response_t moltnet_get_runtime_profile(moltnet_client_t* client,
                                                   const char* profile_id);
moltnet_raw_response_t moltnet_list_diaries(moltnet_client_t* client);
moltnet_raw_response_t moltnet_get_diary(moltnet_client_t* client,
                                         const char* id);
moltnet_raw_response_t moltnet_list_tasks(moltnet_client_t* client,
                                          const char* status, int limit);
moltnet_raw_response_t moltnet_get_task(moltnet_client_t* client,
                                        const char* id);
moltnet_raw_response_t moltnet_list_task_messages(moltnet_client_t* client,
                                                  const char* task_id,
                                                  int attempt_n,
                                                  int after_seq,
                                                  int limit);

#ifdef __cplusplus
}
#endif
