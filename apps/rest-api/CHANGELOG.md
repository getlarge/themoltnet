# Changelog

## [0.12.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.11.0...rest-api-v0.12.0) (2026-06-22)


### Features

* **mcp-server:** remove identity/soul diary-entry profile mechanism ([#1401](https://github.com/getlarge/themoltnet/issues/1401)) ([1487a4b](https://github.com/getlarge/themoltnet/commit/1487a4b6f02600c140727a13a4b51a7f108eab1b))
* **mcp-server:** remove identity/soul diary-entry profile mechanism ([#1401](https://github.com/getlarge/themoltnet/issues/1401)) ([1a807ae](https://github.com/getlarge/themoltnet/commit/1a807aee71a0939e0b1171179d0abb6142ef8c65))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.10.0...rest-api-v0.11.0) (2026-06-19)


### Features

* **#1293:** fork continuation mode + refcounted daemon workspaces ([5266f3b](https://github.com/getlarge/themoltnet/commit/5266f3bedfe9fe2a6cc79cc873db87cc5600bda4))
* **catalog:** runtime_models table + REST + e2e ([#1369](https://github.com/getlarge/themoltnet/issues/1369)) ([c7f51e9](https://github.com/getlarge/themoltnet/commit/c7f51e97a21ed3282660983752d06467e47a8820))
* **rest-api:** add /runtime-models catalog routes ([e78819f](https://github.com/getlarge/themoltnet/commit/e78819f11eb8ec89d63798e5500497478756fa53))
* **rest-api:** regen OpenAPI, drop runtime-profile warnings, e2e ([f802a2e](https://github.com/getlarge/themoltnet/commit/f802a2ecc080234e47c594f170917d4908c9b2b5))
* **rest-api:** type 409 conflict responses ([53a9ef4](https://github.com/getlarge/themoltnet/commit/53a9ef445c4ebbcd31001f07f11eef6ab36ec8db))
* **rest-api:** typed ConflictErrorSchema for all 409 responses ([07bb412](https://github.com/getlarge/themoltnet/commit/07bb412ea0e5748389491e445f7c3cb1ac4fc337))


### Bug Fixes

* **rest-api,database:** resolve CI failures on runtime-models catalog ([718ca42](https://github.com/getlarge/themoltnet/commit/718ca420985660d1ae0169e7292ad19a09616ed4))
* **rest-api:** respect is_active on GET /runtime-models/:entryId ([d16f996](https://github.com/getlarge/themoltnet/commit/d16f99604bb62c691dc3b84376f9b3317890de74))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.9.0...rest-api-v0.10.0) (2026-06-14)


### Features

* **agent-daemon:** apply remote daemon profiles ([94b4448](https://github.com/getlarge/themoltnet/commit/94b44480e81e4c5f04e4a583c0b403737086582d))
* **daemon-profiles:** add runtime lease defaults ([656e7b8](https://github.com/getlarge/themoltnet/commit/656e7b8bb6f1a578779de92c2160e60d3827fd06))
* **runtime:** rename daemon profiles API ([34bcb0a](https://github.com/getlarge/themoltnet/commit/34bcb0ada331505f8c86e09f3bf790207f862894))
* **runtime:** rename daemon profiles API ([b246f9c](https://github.com/getlarge/themoltnet/commit/b246f9c75b987db0a89eadceedb535489dba4d3e))
* **tasks:** add abort task body schema and wire status ([e34d536](https://github.com/getlarge/themoltnet/commit/e34d5360ed776af542ed33bd88c575b6164a1f3e))
* **tasks:** add attempt abort REST endpoint ([15c6042](https://github.com/getlarge/themoltnet/commit/15c6042ccee7ac38ec2e067bd9a0aff0423ce7cf))
* **tasks:** attempt abort/release endpoint for daemon shutdown ([#1382](https://github.com/getlarge/themoltnet/issues/1382)) ([e239ff7](https://github.com/getlarge/themoltnet/commit/e239ff7b458c822c9745413a380a37fa3030f2d9))
* **tasks:** regenerate clients for abort endpoint ([5d9a77b](https://github.com/getlarge/themoltnet/commit/5d9a77b3eb86ce979a8775db35792394716aebdb))


### Bug Fixes

* **ci:** sync runtime profile generated artifacts ([5083134](https://github.com/getlarge/themoltnet/commit/5083134f07934e016e6655ab93f39f03b0c722fd))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.8.1...rest-api-v0.9.0) (2026-06-12)


### Features

* add daemon runtime profiles API ([09fde86](https://github.com/getlarge/themoltnet/commit/09fde86ef321d9739740047404c5fa0f12c49442))
* **api:** add daemon runtime profiles ([45cdcf6](https://github.com/getlarge/themoltnet/commit/45cdcf6bc47b9acedaa7d1a4f8850b923f2df5aa))
* **tasks:** replace executor allowlists with profiles ([5341e5f](https://github.com/getlarge/themoltnet/commit/5341e5fe5e6023431d8d3f71db1c0c0902c2ff98))


### Bug Fixes

* **tasks:** enforce allowed profiles on claim ([be426e8](https://github.com/getlarge/themoltnet/commit/be426e8b6c855b90144b6236011bd091724a2cd4))

## [0.8.1](https://github.com/getlarge/themoltnet/compare/rest-api-v0.8.0...rest-api-v0.8.1) (2026-06-11)


### Bug Fixes

* migrate schemas to typebox v1 ([615ffa7](https://github.com/getlarge/themoltnet/commit/615ffa7927cf60f730840e3e07c92f756413449b))
* migrate schemas to TypeBox v1 ([565d3e5](https://github.com/getlarge/themoltnet/commit/565d3e5f93c19dff75dbcf76dce4a36d37a42f2c))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.7.0...rest-api-v0.8.0) (2026-06-08)


### Features

* **rest-api:** Redis-backed rate-limit store with fail-open ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([f8229e1](https://github.com/getlarge/themoltnet/commit/f8229e1a5f75b32f7239ac72274d9225b0755fe1))
* **rest-api:** Redis-backed rate-limit store with fail-open ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([0c61313](https://github.com/getlarge/themoltnet/commit/0c61313bb4568bd5c0deecd794f16007225ce48f))
* **rest-api:** structured log on rate-limit exceeded ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([cbbfc57](https://github.com/getlarge/themoltnet/commit/cbbfc57f1b9dbd2971d76c1b7d6d726539e68bcc))
* **rest-api:** structured log on rate-limit exceeded ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([5f886b3](https://github.com/getlarge/themoltnet/commit/5f886b3c84e314f60c9df1485826ed642766b92c))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.6.1...rest-api-v0.7.0) (2026-06-07)


### Features

* **rest-api:** read/write rate-limit bucket split ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([3931fe4](https://github.com/getlarge/themoltnet/commit/3931fe47271d2cdc13daca541bb1fd6226b15bd6))
* **rest-api:** read/write rate-limit bucket split ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([4850c41](https://github.com/getlarge/themoltnet/commit/4850c41722ea29a8230e3ae8597c665d3e133420))


### Bug Fixes

* **rest-api:** key rate limiter on credential bytes, not unverified JWT claim ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([23cb2db](https://github.com/getlarge/themoltnet/commit/23cb2db1e97ab3d232f3ee253997c2cb1d3ef6e6))
* **rest-api:** pre-resolve IP throttle + configurable allowlist ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([1c7478b](https://github.com/getlarge/themoltnet/commit/1c7478bfc787993eaa5f20664c79870aa4742b10))
* **rest-api:** rate-limit by identity not IP, add trustProxy ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([eaf519c](https://github.com/getlarge/themoltnet/commit/eaf519c5a76a777294e34dfedcb004ca2a53029b))
* **rest-api:** rate-limit by identity not IP, add trustProxy ([#1336](https://github.com/getlarge/themoltnet/issues/1336)) ([d05a413](https://github.com/getlarge/themoltnet/commit/d05a413b7d9f3aa5f2fc6db9cb23e9525c6441cf))

## [0.6.1](https://github.com/getlarge/themoltnet/compare/rest-api-v0.6.0...rest-api-v0.6.1) (2026-06-06)


### Bug Fixes

* **rest-api:** bake e5-small-v2 into image to stop HF 429s killing CI ([#1309](https://github.com/getlarge/themoltnet/issues/1309)) ([fd91bec](https://github.com/getlarge/themoltnet/commit/fd91bec2c1776a5a8e3aea4c3bfb2d39738bf689))
* **rest-api:** bake e5-small-v2 into the image to stop HF 429s killing CI ([7a9ef7d](https://github.com/getlarge/themoltnet/commit/7a9ef7df181ef18a873a0c38413e63b22f89d4f8))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.5.1...rest-api-v0.6.0) (2026-06-05)


### Features

* **agent-daemon:** stamp daemonState on attempt complete ([27bbd7b](https://github.com/getlarge/themoltnet/commit/27bbd7be0ae8cf761db15813030d6c0b3c9b81f3)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)
* **task-service:** persist daemonState on attempt complete ([afdd41e](https://github.com/getlarge/themoltnet/commit/afdd41e68a15b2b1aeddbd0cce7fba92b3ed2a28)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)
* **tasks:** auto-generate correlationId server-side when absent ([f8acde3](https://github.com/getlarge/themoltnet/commit/f8acde3c4b83111113f747870bbbd821673b030b)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)


### Bug Fixes

* **models:** propagate validation error.code through REST responses ([7c8480a](https://github.com/getlarge/themoltnet/commit/7c8480abc7fd0f4a8bd04523b969c267d3ae8b0d)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)

## [0.5.1](https://github.com/getlarge/themoltnet/compare/rest-api-v0.5.0...rest-api-v0.5.1) (2026-05-29)


### Bug Fixes

* **rest-api:** make openapi.json generation match release-please ([7792575](https://github.com/getlarge/themoltnet/commit/77925750dd970cffb2a03b5870658f030d1d9c12))
* **rest-api:** re-format openapi.json after 0.5.0 release ([cc0a75a](https://github.com/getlarge/themoltnet/commit/cc0a75a355eb57b9a509ae0b72612caa064353ac))
* **rest-api:** re-format openapi.json after 0.5.0 release ([8aeac96](https://github.com/getlarge/themoltnet/commit/8aeac96bd0afe0cbdc023c9334a846c8fa7a9cc8))
* **rest-api:** stop release-please de-formatting openapi.json (the real fix) ([7229363](https://github.com/getlarge/themoltnet/commit/722936339a9b356a35c66bbbf08102439a0251e0))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.4.0...rest-api-v0.5.0) (2026-05-29)


### Features

* **console:** success-criteria editor — assertions + side effects (phase 1 of [#1267](https://github.com/getlarge/themoltnet/issues/1267)) ([de44313](https://github.com/getlarge/themoltnet/commit/de44313f4c3b22c394aba380042835a73715a51e))


### Bug Fixes

* **rest-api:** restore prettier formatting in openapi.json ([8b91277](https://github.com/getlarge/themoltnet/commit/8b9127748c4aa05fa4ae28ad5528ca527a888fb8))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.3.0...rest-api-v0.4.0) (2026-05-29)


### Features

* **console:** create freeform tasks from the board ([3a3c1e2](https://github.com/getlarge/themoltnet/commit/3a3c1e2cdd757c2cf7ef6f692f153552b6330151))
* **console:** per-lane queries + accurate funnel counts on the board ([1f59b7b](https://github.com/getlarge/themoltnet/commit/1f59b7b0b2b12d69b558c8315f259c141cf88a07))
* **console:** task lane board with live agent pane ([e09c94e](https://github.com/getlarge/themoltnet/commit/e09c94e4337adb6b87be04b64d39d1fa26c33d15))
* **landing:** refresh positioning and onboarding ([68801aa](https://github.com/getlarge/themoltnet/commit/68801aaf724924b56ebd3a78368d472d3f011ebe))
* **tasks:** add statuses[] filter + real total count to listTasks ([e66d5a6](https://github.com/getlarge/themoltnet/commit/e66d5a6c9588d2203efa1b4015d11662d12b8aa3))


### Bug Fixes

* **console:** scale the task board with per-lane queries + real counts ([a6e6202](https://github.com/getlarge/themoltnet/commit/a6e62024e240d09dbf309878cf1ca783e6bebda4))
* **task-service:** dereference TaskStatus when validating claimCondition ([02350ef](https://github.com/getlarge/themoltnet/commit/02350ef932fe1597b6b92c14b6d296b8e38d81d4))
* **task-service:** write humans.id (not Kratos identityId) to proposed/cancelled/sealed_by_human_id ([f8919d4](https://github.com/getlarge/themoltnet/commit/f8919d4b7860e86c922be420eb0c3fcd1ada8b30))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.2.0...rest-api-v0.3.0) (2026-05-26)


### Features

* **tasks:** add conditional claimability ([78bb795](https://github.com/getlarge/themoltnet/commit/78bb795ef4c4d88d8b192e1a998c16ce3b831870))
* **tasks:** add conditional claimability ([580161f](https://github.com/getlarge/themoltnet/commit/580161f6d84862e85b7b1d56887ff45f2732a0cf))


### Bug Fixes

* **ci:** refresh generated task contracts ([413618b](https://github.com/getlarge/themoltnet/commit/413618bda46a220fba8dd111ba4ec5291836e37e))
* **tasks:** claim-promote satisfied conditional tasks ([6a86faa](https://github.com/getlarge/themoltnet/commit/6a86faa22687c67f5c3094ea349cb302af47668c))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.1.0...rest-api-v0.2.0) (2026-05-26)


### Features

* **#943:** Phase 0 eval substrate dogfood — SDK, pi-extension, prompts, daemon, imposers ([5155fd7](https://github.com/getlarge/themoltnet/commit/5155fd7a3c3137d1d18d9203cefbb3d8082b79b4))
* **evals:** refresh legreffier scenarios and runner modes ([4f9a128](https://github.com/getlarge/themoltnet/commit/4f9a1282de40b03b84916c5217b54a2a7af15588))
* **rest-api:** drop baked-in embedding model ([244e3ac](https://github.com/getlarge/themoltnet/commit/244e3acbb01af23a2b74b03bfa991d7d1c730eb7))
* **rest-api:** drop baked-in embedding model in favor of startup download ([89bb1fa](https://github.com/getlarge/themoltnet/commit/89bb1fa35acecc90024e3ee9104fa53026a70342)), closes [#1226](https://github.com/getlarge/themoltnet/issues/1226)
* **teams:** support role promotion and updates ([cef6ae3](https://github.com/getlarge/themoltnet/commit/cef6ae3622983e40f9b183464a245197f1580267))
* **teams:** support role promotion and updates ([0fb8e84](https://github.com/getlarge/themoltnet/commit/0fb8e847f2b2ba61e088f4461d1ea910d234e879))
* version deployable app contracts ([b8251ff](https://github.com/getlarge/themoltnet/commit/b8251ffa41fe2c67d76dfcc5e22bed2f7006e80a))


### Bug Fixes

* **ci:** split diary entry route suites to avoid Vitest onTaskUpdate timeout ([53848c7](https://github.com/getlarge/themoltnet/commit/53848c7b78131af6fd58b8f676dcc5bde31a8b01))
* **ci:** stabilize MCP app lint and tests ([94b5a80](https://github.com/getlarge/themoltnet/commit/94b5a80b4b013f84723f56512470e9dc3c11e9bf))
* **docker:** skip nx sync during deploy packaging ([15a6910](https://github.com/getlarge/themoltnet/commit/15a6910f7dae541bc21610c970aaac7f84fd4bb0))
* **nx:** generate spec tsconfigs for source tests ([899d887](https://github.com/getlarge/themoltnet/commit/899d8875775ad7757f41ced89643a1bf3fce1e9f))
* **rest-api:** avoid nested DBOS tx in orphan sweeper ([3ba3109](https://github.com/getlarge/themoltnet/commit/3ba3109e3fe40a9e3747e72d32135d1a91729695))
* **rest-api:** avoid nested DBOS tx in orphan sweeper ([f9c8a69](https://github.com/getlarge/themoltnet/commit/f9c8a692aaa81158e70b10f26eed3e8e1e01ca50))
* **rest-api:** narrow per-target Nx outputs so cache restore doesn't wipe siblings ([ba9c1f7](https://github.com/getlarge/themoltnet/commit/ba9c1f75037997a11f84f1e5eecb15940d0b69f4))
* **rest-api:** use enum in owned-team filter ([f288c04](https://github.com/getlarge/themoltnet/commit/f288c0475b76f72f303d2ff61037c37da023b929))
* **teams:** make role rewrites safe ([be70d26](https://github.com/getlarge/themoltnet/commit/be70d26d74b3455920be1165a9287557a8e8cd9e))
