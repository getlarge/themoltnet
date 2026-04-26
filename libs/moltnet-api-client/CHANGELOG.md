# Changelog

## [1.22.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.21.0...moltnet-api-client-v1.22.0) (2026-04-26)


### Features

* **agent-daemon:** new app + polling source + GET /tasks/schemas ([317c399](https://github.com/getlarge/themoltnet/commit/317c39967c5bf27054bdb91df05c9465a46e0a45))
* **rest-api:** GET /tasks/schemas + regenerate clients ([0f25ca1](https://github.com/getlarge/themoltnet/commit/0f25ca17cc201e375b5dcaaf26c8c4f8a483a9d8))
* **tasks:** imposer-set timeouts; LLM-decided entry types; cancel/fail/timeout e2e ([f98fe1f](https://github.com/getlarge/themoltnet/commit/f98fe1f0de2c2ccb76f2b7a0e43dea1958fa5efc))
* **tasks:** imposer-set timeouts; LLM-decided entry types; cancel/fail/timeout e2e ([7488f17](https://github.com/getlarge/themoltnet/commit/7488f1708de228c8209bba47ee0c892d565cf195))


### Bug Fixes

* **tasks:** address PR [#935](https://github.com/getlarge/themoltnet/issues/935) review feedback ([69699cd](https://github.com/getlarge/themoltnet/commit/69699cd7c1c07521eee1d2d9460ead14137b90f8))
* **tasks:** cancel stops the worker; late /complete cannot revive ([#938](https://github.com/getlarge/themoltnet/issues/938)) ([7d85002](https://github.com/getlarge/themoltnet/commit/7d850028592f2658225530b18f56df593bc284bc))

## [1.21.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.20.0...moltnet-api-client-v1.21.0) (2026-04-25)


### Features

* **tasks:** add executor manifests ([f704b57](https://github.com/getlarge/themoltnet/commit/f704b57ccf0b6caa6f505a058fe074e8b86a5d1c))
* **tasks:** add executor manifests ([1034ee7](https://github.com/getlarge/themoltnet/commit/1034ee77efbf14a48bfa0ff0f8b23191dfa4d557))

## [1.20.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.19.1...moltnet-api-client-v1.20.0) (2026-04-24)


### Features

* **database,rest-api:** migrate rendered pack verification to Tasks API ([455fd04](https://github.com/getlarge/themoltnet/commit/455fd041f839d351d0bc3b3986ab805f529a0a33))


### Bug Fixes

* **tasks:** heartbeat on open, timed_out→409, traceparent propagation ([aaf524f](https://github.com/getlarge/themoltnet/commit/aaf524fe88a08233860bf59f72407522b38fde5a))


### Codegen

* **codegen:** regenerate OpenAPI spec and API clients ([6ffc907](https://github.com/getlarge/themoltnet/commit/6ffc90756aca259ba33afb87dbbf47269bb73be5))
* **codegen:** regenerate OpenAPI spec and API clients ([e67103a](https://github.com/getlarge/themoltnet/commit/e67103a7fb40e0de95b49e65cb01b3aad52b75c4))

## [1.19.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.19.0...moltnet-api-client-v1.19.1) (2026-04-23)


### Bug Fixes

* **ci:** regenerate go task api client ([0a5939d](https://github.com/getlarge/themoltnet/commit/0a5939d1c3b7123b6c8e8df91155cf1630ba8eb7))
* **rest-api:** regenerate OpenAPI spec and API clients after after_seq schema change ([ce34c1c](https://github.com/getlarge/themoltnet/commit/ce34c1c23fc3c69b0ed3dbc839197f0d9af8ed2f))
* **tasks:** camelCase task contracts and expose tasks SDK ([ccbf203](https://github.com/getlarge/themoltnet/commit/ccbf203de6b1cce86c7e38ef27ac3c5d0954f13c))


### Codegen

* **api:** regenerate task client artifacts ([ab5088c](https://github.com/getlarge/themoltnet/commit/ab5088cc80b363a68ade3ed3d062b9a840b3f3a8))

## [1.19.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.18.0...moltnet-api-client-v1.19.0) (2026-04-23)


### Features

* **api-client:** regenerate TS and Go clients for task routes ([5093fad](https://github.com/getlarge/themoltnet/commit/5093fad92dfdb17e4bb3f8ecb0631e83b53a2f3c))
* **packs:** pack diff API — compare two context packs ([b706e37](https://github.com/getlarge/themoltnet/commit/b706e37c6d476f030a534c4c643433045c9ebfc2))
* **tasks:** Phase 3 REST API — task routes, service, and tests ([7d38ab8](https://github.com/getlarge/themoltnet/commit/7d38ab80ad4862306db22f9e63b1f270a64c58b5))


### Bug Fixes

* **moltnet-api-client:** narrow dedup to conflict-only inline schemas ([cfbed43](https://github.com/getlarge/themoltnet/commit/cfbed438217eeb93ab96bbec728269ac34f7d923))
* **rest-api:** address all reviewer security and correctness issues ([9b1dbfd](https://github.com/getlarge/themoltnet/commit/9b1dbfd79200a69ede7c720a5bf2077df08ae0e8))


### Codegen

* **generated:** regenerate TS and Go API clients for pack diff endpoints ([6b06b19](https://github.com/getlarge/themoltnet/commit/6b06b193b542c3d7103988169e0a1008995fa9f3))

## [1.18.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.17.2...moltnet-api-client-v1.18.0) (2026-04-22)


### Features

* **pack-pipeline:** curate/render/judge_pack task types + prompt builders ([be89841](https://github.com/getlarge/themoltnet/commit/be89841ae09227779c7f514b12a2a2304b7fd002))


### Bug Fixes

* **rest-api:** return packId on custom pack create ([008f8bb](https://github.com/getlarge/themoltnet/commit/008f8bb9d0302dbd1e03cf368beb80c692e3a720))

## [1.17.2](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.17.1...moltnet-api-client-v1.17.2) (2026-04-21)


### Bug Fixes

* **api-client:** sync Go array query params ([1b5ec23](https://github.com/getlarge/themoltnet/commit/1b5ec2356365018887ec67b5b83462e03fc11096))
* **rest-api:** regenerate public api artifacts for issue 825 ([12e70de](https://github.com/getlarge/themoltnet/commit/12e70de76f121ee452b2d92497d4b61dd6473ae0))

## [1.17.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.17.0...moltnet-api-client-v1.17.1) (2026-04-17)


### Bug Fixes

* **cli,rest-api:** surface REST error bodies + declare missing 400 responses ([998a211](https://github.com/getlarge/themoltnet/commit/998a21151875e00f3ac410a067d9ca6b6f8a14b3))
* **cli,rest-api:** surface REST error bodies and declare 400 responses ([7bc7c66](https://github.com/getlarge/themoltnet/commit/7bc7c6633586b5840301306e6cb3941495f4dc60)), closes [#827](https://github.com/getlarge/themoltnet/issues/827)

## [1.17.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.16.0...moltnet-api-client-v1.17.0) (2026-04-17)


### Features

* find packs and rendered packs referencing an entry ([c7c0003](https://github.com/getlarge/themoltnet/commit/c7c00035cf6fd963facf5c4be7c84f099350059d))


### Codegen

* **api:** regenerate pack listing clients ([86043ac](https://github.com/getlarge/themoltnet/commit/86043ac5e1a367f8002233a38539ecf9997d074f))

## [1.16.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.15.0...moltnet-api-client-v1.16.0) (2026-04-16)


### Features

* **entries:** expose ids filter end-to-end on list entries ([254a1dc](https://github.com/getlarge/themoltnet/commit/254a1dcd27b0a452b332b033fb57beec35e409e5))


### Bug Fixes

* add missing diary entry createdBy in API response ([c4573ea](https://github.com/getlarge/themoltnet/commit/c4573eae3dbc6196fe78cf77c2864245ff643c50))
* **rest-api:** expose diary entry createdBy in API responses ([810888f](https://github.com/getlarge/themoltnet/commit/810888fe274f43d06c214e6bcba2250da1f6215a))


### Codegen

* **moltnet-api-client:** regen Go client for case-insensitive ids regex ([3dd6710](https://github.com/getlarge/themoltnet/commit/3dd6710352c71c442aa1d8bbab8050da1eed8bab))
* **moltnet-api-client:** regen Go client for ids filter ([b7ef8d7](https://github.com/getlarge/themoltnet/commit/b7ef8d7f226443c371cf12ce33fd37d82bb74bcb))

## [1.15.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.14.0...moltnet-api-client-v1.15.0) (2026-04-14)


### Features

* **console:** team & group management UI — Phase 1 ([#659](https://github.com/getlarge/themoltnet/issues/659)) ([ac923b7](https://github.com/getlarge/themoltnet/commit/ac923b7be47695db32e625b00f3ab15e05a5d0c4))
* **teams:** team onboarding Phase 1 — API + SDK + MCP ([670607b](https://github.com/getlarge/themoltnet/commit/670607b766cf7e6fbc52f8ceabfb4be1de1537ef))


### Bug Fixes

* **models,rest-api:** add id to TeamInviteResponseSchema + fix MCP e2e tests ([86a3d43](https://github.com/getlarge/themoltnet/commit/86a3d43d6372e572062072ef78aea04a352200a7))


### Codegen

* regenerate API clients after rebase on origin/main ([e26c60f](https://github.com/getlarge/themoltnet/commit/e26c60f24ee14bece5051529e675c070a9fe1a13))
* regenerate API clients for enriched team schemas ([b923337](https://github.com/getlarge/themoltnet/commit/b923337b02db6176b3dabf020c648fc9c670f79d))

## [1.14.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.13.0...moltnet-api-client-v1.14.0) (2026-04-12)


### Features

* **cli,mcp-server:** regen clients + wire expand/depth params ([#740](https://github.com/getlarge/themoltnet/issues/740)) ([b6549ef](https://github.com/getlarge/themoltnet/commit/b6549ef9a03cd193af3225b53e618bdba150f26f))
* expand entry relations inline with depth traversal ([#740](https://github.com/getlarge/themoltnet/issues/740)) ([147c5d4](https://github.com/getlarge/themoltnet/commit/147c5d4221e9c133a7bc10f6a2d37e30a3470eaa))

## [1.13.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.12.0...moltnet-api-client-v1.13.0) (2026-04-11)


### Features

* Kratos cookie auth + OpenAPI declarations + self-service UI ([38bec91](https://github.com/getlarge/themoltnet/commit/38bec9165480b9d5203e751a381c81ac1678ce3a))


### Codegen

* **api-client:** regenerate TS + Go clients with cookieAuth ([cc7982d](https://github.com/getlarge/themoltnet/commit/cc7982dc8bcdc6ff46595241308535baf6067897))

## [1.12.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.11.0...moltnet-api-client-v1.12.0) (2026-04-11)


### Features

* add rendered pack update endpoint across the stack ([7394985](https://github.com/getlarge/themoltnet/commit/73949853c76fe04623b6529e53b7681225d387c3))
* **rest-api,mcp,cli,sdk:** add rendered pack update endpoint ([098363b](https://github.com/getlarge/themoltnet/commit/098363b6843eb79501706efc8c6bdd4b379aaece)), closes [#752](https://github.com/getlarge/themoltnet/issues/752)


### Bug Fixes

* **rest-api:** add expiresAt to RenderedPackWithContentSchema ([8804ad8](https://github.com/getlarge/themoltnet/commit/8804ad816c88b57315226d99af3fa5b030cb6dd7))
* **rest-api:** block unknown-property bodies on PATCH endpoints ([aa38cc3](https://github.com/getlarge/themoltnet/commit/aa38cc34c76d7f2fec7895a7134ca2e5f0a035e5))
* **rest-api:** minProperties on PATCH bodies + 409 on concurrent pin ([c16a8c4](https://github.com/getlarge/themoltnet/commit/c16a8c4c196294cc362c56dba55b2647755bdc8f))


### Codegen

* **api-client:** regenerate clients for PATCH schema fixes ([b360503](https://github.com/getlarge/themoltnet/commit/b3605039705c1b058def2b32e06b10937a38c888))

## [1.11.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.10.0...moltnet-api-client-v1.11.0) (2026-04-09)


### Features

* **governance:** team founding workflow, diary transfer, personal team limits ([9df1e74](https://github.com/getlarge/themoltnet/commit/9df1e746f54768bc989c8afbe3c81fb7f0a9ff54))
* **legreffier:** support GitHub org account in onboarding ([d2194d5](https://github.com/getlarge/themoltnet/commit/d2194d555e14aa119b08a3c3d73300e438199a63))


### Bug Fixes

* **governance:** address code review — idempotency, compensation, race conditions ([38253db](https://github.com/getlarge/themoltnet/commit/38253db6d8fd449844e87dd77b8f08a61a34763c))


### Codegen

* include missed Go client generated files ([dfc0bcb](https://github.com/getlarge/themoltnet/commit/dfc0bcbf853712acc47fae2b3713d1a84865a4d1))
* regenerate OpenAPI spec and TS/Go clients with org field ([a65d284](https://github.com/getlarge/themoltnet/commit/a65d284cfb094a78ee91a44f05eb9c944c5fbbc4))

## [1.10.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.9.0...moltnet-api-client-v1.10.0) (2026-04-06)


### Features

* add dashboard app with Kratos session auth support ([#652](https://github.com/getlarge/themoltnet/issues/652)) ([7c0aab4](https://github.com/getlarge/themoltnet/commit/7c0aab43e63cca749495c7b74f1014b787422af0))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* **fidelity:** harden verification authz and workflow lifecycle ([0cffb0e](https://github.com/getlarge/themoltnet/commit/0cffb0ea5f2557834311a90b5db02abce85e3f3c))
* implement per-diary grants API (chunk 3) ([54778e0](https://github.com/getlarge/themoltnet/commit/54778e0e2f7709188380425c34122c08fd3d15da))
* **monitoring:** add deep readiness probes for REST API and MCP server ([3a9ce21](https://github.com/getlarge/themoltnet/commit/3a9ce21ce810a378b64c98bb5ac210c49fc51d1e))


### Bug Fixes

* **go-client:** regenerate API client from updated OpenAPI spec ([cd6341f](https://github.com/getlarge/themoltnet/commit/cd6341f2bb22f47766483f114d778c60f2bbfd76))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))
* update normalized OpenAPI spec for Go client generation ([531ea8b](https://github.com/getlarge/themoltnet/commit/531ea8bd73fff93b114bf4dc170cf6e53e56f59f))


### Codegen

* **codegen:** regenerate OpenAPI spec and API clients ([452f00f](https://github.com/getlarge/themoltnet/commit/452f00f7aa2573667dfb3d765ba45555ec08499b))
* **codegen:** regenerate TS and Go clients for listDiaryRenderedPacks ([4286cfb](https://github.com/getlarge/themoltnet/commit/4286cfb76a71ae19a2bc00f323be00b12a8c5106))
* **go:** migrate to apps/libs layout with go.work ([8204f16](https://github.com/getlarge/themoltnet/commit/8204f16a1ff11e38628337352194fb044105bf97))
* **go:** migrate to apps/libs layout with go.work ([d9a05e8](https://github.com/getlarge/themoltnet/commit/d9a05e84e8f96305ad486da43cee9e43ac2a75ca))
* **go:** rename api-client module path to libs/moltnet-api-client ([e79647d](https://github.com/getlarge/themoltnet/commit/e79647d7ce9d696cb00ad218f16a842fd65c2cf3))
* **go:** rename api-client module path to libs/moltnet-api-client ([8a2717b](https://github.com/getlarge/themoltnet/commit/8a2717bdf67da6352924ad32e8b8ed6dded55c3e)), closes [#590](https://github.com/getlarge/themoltnet/issues/590)
* regenerate Go API client after rebase onto main ([5c03340](https://github.com/getlarge/themoltnet/commit/5c0334047f0823dad8e377eea5a2f86d31ce37e1))
* release main ([f70c30e](https://github.com/getlarge/themoltnet/commit/f70c30ef4a11e2ba70f0886c7134963b3a5c29dc))
* release main ([3ee905f](https://github.com/getlarge/themoltnet/commit/3ee905f61633a5ef88b9f73489d605e241b5a48a))
* release main ([a0ef510](https://github.com/getlarge/themoltnet/commit/a0ef5103bf95e154fedd9647c754eb9c8ece5191))
* release main ([38f9993](https://github.com/getlarge/themoltnet/commit/38f9993c5c926a1ec0bdc4dddea582af74a73bcb))
* release main ([67c8ccb](https://github.com/getlarge/themoltnet/commit/67c8ccb17b5731f0877199d1c20f93ae40e95a61))
* release main ([35b000a](https://github.com/getlarge/themoltnet/commit/35b000aaf7821331878987ca6db6aa137adf2bd4))
* release main ([2174363](https://github.com/getlarge/themoltnet/commit/21743638faf1eaf4ce1960285f58ef8bd601e333))
* release main ([c5b27c0](https://github.com/getlarge/themoltnet/commit/c5b27c030c5e912e71c4e4f6e4cf560e5f056437))
* release main ([ae49053](https://github.com/getlarge/themoltnet/commit/ae49053aa1f90c345e64c3dbbc7be7e8ee6b540a))
* release main ([061b86a](https://github.com/getlarge/themoltnet/commit/061b86a1d14684d27902ff9e1938427459ee10d8))

## [1.9.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.8.0...moltnet-api-client-v1.9.0) (2026-04-06)


### Features

* add dashboard app with Kratos session auth support ([#652](https://github.com/getlarge/themoltnet/issues/652)) ([7c0aab4](https://github.com/getlarge/themoltnet/commit/7c0aab43e63cca749495c7b74f1014b787422af0))


### Bug Fixes

* **go-client:** regenerate API client from updated OpenAPI spec ([cd6341f](https://github.com/getlarge/themoltnet/commit/cd6341f2bb22f47766483f114d778c60f2bbfd76))
* update normalized OpenAPI spec for Go client generation ([531ea8b](https://github.com/getlarge/themoltnet/commit/531ea8bd73fff93b114bf4dc170cf6e53e56f59f))

## [1.8.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.7.2...moltnet-api-client-v1.8.0) (2026-04-04)


### Features

* **monitoring:** add deep readiness probes for REST API and MCP server ([3a9ce21](https://github.com/getlarge/themoltnet/commit/3a9ce21ce810a378b64c98bb5ac210c49fc51d1e))


### Codegen

* regenerate Go API client after rebase onto main ([5c03340](https://github.com/getlarge/themoltnet/commit/5c0334047f0823dad8e377eea5a2f86d31ce37e1))

## [1.7.2](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.7.1...moltnet-api-client-v1.7.2) (2026-04-02)


### Bug Fixes

* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))


### Codegen

* **codegen:** regenerate OpenAPI spec and API clients ([452f00f](https://github.com/getlarge/themoltnet/commit/452f00f7aa2573667dfb3d765ba45555ec08499b))

## [1.7.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.7.0...moltnet-api-client-v1.7.1) (2026-04-02)


### Codegen

* **codegen:** regenerate TS and Go clients for listDiaryRenderedPacks ([4286cfb](https://github.com/getlarge/themoltnet/commit/4286cfb76a71ae19a2bc00f323be00b12a8c5106))

## [1.7.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.6.0...moltnet-api-client-v1.7.0) (2026-04-02)


### Features

* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* **fidelity:** harden verification authz and workflow lifecycle ([0cffb0e](https://github.com/getlarge/themoltnet/commit/0cffb0ea5f2557834311a90b5db02abce85e3f3c))
* implement per-diary grants API (chunk 3) ([54778e0](https://github.com/getlarge/themoltnet/commit/54778e0e2f7709188380425c34122c08fd3d15da))

## [1.6.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.5.0...moltnet-api-client-v1.6.0) (2026-04-01)


### Features

* Option B chunk 2 — team-only diary permissions ([0143a31](https://github.com/getlarge/themoltnet/commit/0143a31f8136487308aaad29f17e68dc72df469d))

## [1.5.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.4.1...moltnet-api-client-v1.5.0) (2026-04-01)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.4.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.4.0...moltnet-api-client-v1.4.1) (2026-04-01)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.4.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.3.0...moltnet-api-client-v1.4.0) (2026-03-31)


### Features

* add Group entity — teams/groups chunk 1 ([8e79714](https://github.com/getlarge/themoltnet/commit/8e79714519eec8767b9f3ab77c40f4ff64dc4004))

## [1.3.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.2.0...moltnet-api-client-v1.3.0) (2026-03-31)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.2.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.1.1...moltnet-api-client-v1.2.0) (2026-03-31)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.1.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.1.0...moltnet-api-client-v1.1.1) (2026-03-30)


### Bug Fixes

* **ci:** repair rendered-pack validation and generated clients ([3d4a05d](https://github.com/getlarge/themoltnet/commit/3d4a05dadb96d878fc6431b8e3be8ff4039d85f5))
* **packs:** return rendered markdown from persisted renders ([5acec13](https://github.com/getlarge/themoltnet/commit/5acec1304b249186cb54557b9d16383dc28dbeaa))

## [1.1.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.1...moltnet-api-client-v1.1.0) (2026-03-30)


### Features

* teams foundation — schema, Keto OPL, auth layer ([753e8ac](https://github.com/getlarge/themoltnet/commit/753e8ac56a9af6feb63c37edfef81699870444a2))

## [1.0.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.0...moltnet-api-client-v1.0.1) (2026-03-29)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [2.0.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.0...moltnet-api-client-v2.0.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [1.0.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.83.1...moltnet-api-client-v1.0.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.83.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.83.0...moltnet-api-client-v0.83.1) (2026-03-29)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.83.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.82.0...moltnet-api-client-v0.83.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.82.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.81.0...moltnet-api-client-v0.82.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.81.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.80.0...moltnet-api-client-v0.81.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.80.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.79.0...moltnet-api-client-v0.80.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.79.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.78.0...moltnet-api-client-v0.79.0) (2026-03-28)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.78.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.77.0...moltnet-api-client-v0.78.0) (2026-03-25)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.77.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.76.0...moltnet-api-client-v0.77.0) (2026-03-25)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.76.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.75.0...moltnet-api-client-v0.76.0) (2026-03-25)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.75.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.74.0...moltnet-api-client-v0.75.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.74.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.73.0...moltnet-api-client-v0.74.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.73.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.72.0...moltnet-api-client-v0.73.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.72.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.71.0...moltnet-api-client-v0.72.0) (2026-03-23)


### Features

* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))


### Bug Fixes

* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))

## [0.71.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.70.0...moltnet-api-client-v0.71.0) (2026-03-21)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))


### Bug Fixes

* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.70.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.69.1...moltnet-api-client-v0.70.0) (2026-03-21)


### Features

* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))


### Bug Fixes

* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))

## [0.69.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.45.0...moltnet-api-client-v0.69.1) (2026-03-21)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.45.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.44.0...moltnet-api-client-v0.45.0) (2026-03-21)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.44.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.43.0...moltnet-api-client-v0.44.0) (2026-03-21)


### Features

* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))

## [0.43.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.42.0...moltnet-api-client-v0.43.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.42.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.41.0...moltnet-api-client-v0.42.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.41.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.40.0...moltnet-api-client-v0.41.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.40.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.39.0...moltnet-api-client-v0.40.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))


### Bug Fixes

* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))

## [0.39.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.38.0...moltnet-api-client-v0.39.0) (2026-03-19)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.38.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.37.0...moltnet-api-client-v0.38.0) (2026-03-19)


### Features

* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))

## [0.37.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.36.0...moltnet-api-client-v0.37.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.36.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.35.0...moltnet-api-client-v0.36.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.35.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.34.0...moltnet-api-client-v0.35.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.34.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.33.0...moltnet-api-client-v0.34.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.33.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.32.0...moltnet-api-client-v0.33.0) (2026-03-16)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.32.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.31.0...moltnet-api-client-v0.32.0) (2026-03-15)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.31.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.30.0...moltnet-api-client-v0.31.0) (2026-03-14)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.29.0...moltnet-api-client-v0.30.0) (2026-03-14)


### Features

* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.28.0...moltnet-api-client-v0.29.0) (2026-03-08)


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
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.27.0...moltnet-api-client-v0.28.0) (2026-03-08)


### Features

* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.26.0...moltnet-api-client-v0.27.0) (2026-03-08)


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
