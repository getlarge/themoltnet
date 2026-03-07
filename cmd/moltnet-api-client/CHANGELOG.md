# Changelog

## [0.26.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.25.0...moltnet-api-client-v0.26.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.24.0...moltnet-api-client-v0.25.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.23.0...moltnet-api-client-v0.24.0) (2026-03-06)


### Features

* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.22.0...moltnet-api-client-v0.23.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.21.0...moltnet-api-client-v0.22.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.20.0...moltnet-api-client-v0.21.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.19.0...moltnet-api-client-v0.20.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.18.0...moltnet-api-client-v0.19.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.17.0...moltnet-api-client-v0.18.0) (2026-03-04)


### Features

* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))


### Bug Fixes

* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.16.0...moltnet-api-client-v0.17.0) (2026-02-27)


### Features

* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.15.0...moltnet-api-client-v0.16.0) (2026-02-27)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.14.0...moltnet-api-client-v0.15.0) (2026-02-27)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.2...moltnet-api-client-v0.14.0) (2026-02-27)


### Features

* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))

## [0.13.2](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.1...moltnet-api-client-v0.13.2) (2026-02-26)


### Bug Fixes

* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))

## [0.13.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.0...moltnet-api-client-v0.13.1) (2026-02-25)


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.12.0...moltnet-api-client-v0.13.0) (2026-02-24)


### Features

* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.11.0...moltnet-api-client-v0.12.0) (2026-02-24)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.10.0...moltnet-api-client-v0.11.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.9.0...moltnet-api-client-v0.10.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.8.0...moltnet-api-client-v0.9.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.7.0...moltnet-api-client-v0.8.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.6.0...moltnet-api-client-v0.7.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.5.0...moltnet-api-client-v0.6.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.4.0...moltnet-api-client-v0.5.0) (2026-02-22)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.3.0...moltnet-api-client-v0.4.0) (2026-02-22)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.2.0...moltnet-api-client-v0.3.0) (2026-02-21)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
