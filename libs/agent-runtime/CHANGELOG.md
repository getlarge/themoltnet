# Changelog

## [0.5.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.4.0...agent-runtime-v0.5.0) (2026-04-26)


### Features

* **agent-daemon:** new app + polling source + GET /tasks/schemas ([317c399](https://github.com/getlarge/themoltnet/commit/317c39967c5bf27054bdb91df05c9465a46e0a45))
* **agent-runtime:** add PollingApiTaskSource for daemon mode ([51559c1](https://github.com/getlarge/themoltnet/commit/51559c125fd449b9cad53ba725815cfc3dad95f3))
* **tasks:** imposer-set timeouts; LLM-decided entry types; cancel/fail/timeout e2e ([f98fe1f](https://github.com/getlarge/themoltnet/commit/f98fe1f0de2c2ccb76f2b7a0e43dea1958fa5efc))
* **tasks:** imposer-set timeouts; LLM-decided entry types; cancel/fail/timeout e2e ([7488f17](https://github.com/getlarge/themoltnet/commit/7488f1708de228c8209bba47ee0c892d565cf195))


### Bug Fixes

* **agent-daemon-e2e:** tighten cleanup, scope cancel test to robust assertions, retry initial heartbeat ([8a2f950](https://github.com/getlarge/themoltnet/commit/8a2f95025a0890adf26ada4c5fe248099d82a79d))
* **agent-runtime:** drain mode must not exit on transient list errors ([c7f3c34](https://github.com/getlarge/themoltnet/commit/c7f3c34d85ad0d8ce1f9063dae48d3d7ad9a04c9))
* **tasks:** cancel stops the worker; late /complete cannot revive ([#938](https://github.com/getlarge/themoltnet/issues/938)) ([7d85002](https://github.com/getlarge/themoltnet/commit/7d850028592f2658225530b18f56df593bc284bc))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.3.0...agent-runtime-v0.4.0) (2026-04-25)


### Features

* **tasks:** add executor manifests ([f704b57](https://github.com/getlarge/themoltnet/commit/f704b57ccf0b6caa6f505a058fe074e8b86a5d1c))
* **tasks:** add executor manifests ([1034ee7](https://github.com/getlarge/themoltnet/commit/1034ee77efbf14a48bfa0ff0f8b23191dfa4d557))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.2.1...agent-runtime-v0.3.0) (2026-04-24)


### Features

* **agent-runtime:** batch ApiTaskReporter records to coalesce token-stream POSTs ([6654122](https://github.com/getlarge/themoltnet/commit/665412252970209a0be1ab18cf711a30a9344a3f))


### Bug Fixes

* **reporter:** address Copilot review — integer validation, NaN guard, docs ([6c31971](https://github.com/getlarge/themoltnet/commit/6c3197113910f78b7f916a1965edf88898e316f6))
* **reporter:** close data-loss triangle — restore batch on fail, await inflight, log swallowed errors ([e937003](https://github.com/getlarge/themoltnet/commit/e937003184cd16169fac6037d37fd7feeed7bb4c))
* **tasks:** serialize appendMessages seq, batch reporter, log pg errors ([#921](https://github.com/getlarge/themoltnet/issues/921)) ([2279ea5](https://github.com/getlarge/themoltnet/commit/2279ea5b37a7e23cfc0f4b0c64c2a0e1c6d9527c))

## [0.2.1](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.2.0...agent-runtime-v0.2.1) (2026-04-24)


### Bug Fixes

* **agent-runtime:** send heartbeat immediately on open ([89cdb6c](https://github.com/getlarge/themoltnet/commit/89cdb6cfbd62358d4d9a4974a26759d69c8db3f5))
* **tasks:** heartbeat on open, timed_out→409, traceparent propagation ([aaf524f](https://github.com/getlarge/themoltnet/commit/aaf524fe88a08233860bf59f72407522b38fde5a))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.1.0...agent-runtime-v0.2.0) (2026-04-23)


### Features

* **agent-runtime:** add FileTaskSource and AgentRuntime local loop ([da03fd2](https://github.com/getlarge/themoltnet/commit/da03fd2075a35935adeb143f6416acc1137726e7))
* **agent-runtime:** add fulfill_brief and assess_brief prompt builders ([dddd162](https://github.com/getlarge/themoltnet/commit/dddd1628c6b72e9cb0d44c2e15fa832c2c55d132))
* **agent-runtime:** add StdoutReporter and JsonlReporter ([047834d](https://github.com/getlarge/themoltnet/commit/047834d07feb51c3036cf4618a2758d304c1c2f0))
* **agent-runtime:** add tasks api source and reporter ([b4986c0](https://github.com/getlarge/themoltnet/commit/b4986c076ec337e54b345e299083cf383c96169d))
* **agent-runtime:** PR 0 — local-mode task runtime + wire-format types ([613af6c](https://github.com/getlarge/themoltnet/commit/613af6ce3abcb2f05112ab3e18b6350933082fac))
* **agent-runtime:** prompt builders for pack pipeline tasks ([8bfd5ec](https://github.com/getlarge/themoltnet/commit/8bfd5ec02b5dc5b9b6cf4d533b037007f3b43f47))
* **agent-runtime:** publish as @themoltnet/agent-runtime ([bb71b3e](https://github.com/getlarge/themoltnet/commit/bb71b3e0e6e210195c5ebe4ceffb704d5adcd512))
* **agent-runtime:** scaffold workspace ([4e52165](https://github.com/getlarge/themoltnet/commit/4e52165ad4bf5fe7a99801893d85581c10eaa28f))
* **demo:** pack-pipeline task fixtures + validation test ([942816b](https://github.com/getlarge/themoltnet/commit/942816b410c281880ce320a125b2761cd6f2de5c))
* **pack-pipeline:** curate/render/judge_pack task types + prompt builders ([be89841](https://github.com/getlarge/themoltnet/commit/be89841ae09227779c7f514b12a2a2304b7fd002))
* run task demos through the Tasks API ([1adea18](https://github.com/getlarge/themoltnet/commit/1adea18c30ecf2e32617f8aebeb4f23094fd581d))


### Bug Fixes

* **agent-runtime:** address Copilot review round 2 ([452ed38](https://github.com/getlarge/themoltnet/commit/452ed389e30e625c5164f522db2edd17b91da816))
* **curate-pack:** clarify packId vs id in creator prompt ([d0cfd9b](https://github.com/getlarge/themoltnet/commit/d0cfd9b169f375bdc59f6cd5bd011e4aec834780))
* **curate-pack:** clarify packId vs id in creator prompt ([1bad9e5](https://github.com/getlarge/themoltnet/commit/1bad9e5f3e7264412b03a02aac02f42ae605e45f))
* **pack-pipeline:** address PR [#882](https://github.com/getlarge/themoltnet/issues/882) review ([e4c1900](https://github.com/getlarge/themoltnet/commit/e4c19008779a6519eccb64fa3e2f70f855fd0502))
* **pack-pipeline:** unbreak judge_pack end-to-end run ([8f0f4c4](https://github.com/getlarge/themoltnet/commit/8f0f4c4a8ca5fb7f9e08bb9e1d3f249c2ac4b71e))
* **pi-extension:** address getlarge PR [#905](https://github.com/getlarge/themoltnet/issues/905) review ([ce98073](https://github.com/getlarge/themoltnet/commit/ce98073a60be7467fb303190a218632c675eb1e3))
* **runtime:** address Copilot review on PR [#876](https://github.com/getlarge/themoltnet/issues/876) ([13b79d8](https://github.com/getlarge/themoltnet/commit/13b79d80f2d1df39aa271fca5dff341e101e0b3b))
* **tasks:** camelCase task contracts and expose tasks SDK ([ccbf203](https://github.com/getlarge/themoltnet/commit/ccbf203de6b1cce86c7e38ef27ac3c5d0954f13c))
* **tasks:** camelcase task payload contracts ([525f094](https://github.com/getlarge/themoltnet/commit/525f094bbabda641c49ea5e65822bf6af9edb681))
