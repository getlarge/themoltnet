# Changelog

## [0.9.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.8.0...pi-extension-v0.9.0) (2026-04-26)


### Features

* **pi-extension:** honor reporter.cancelSignal via session.abort() ([#947](https://github.com/getlarge/themoltnet/issues/947)) ([39c7db7](https://github.com/getlarge/themoltnet/commit/39c7db757db3842a7a65af61d8d7d181eacd5faa))
* **pi-extension:** honor reporter.cancelSignal via session.abort() ([#947](https://github.com/getlarge/themoltnet/issues/947)) ([d237a8e](https://github.com/getlarge/themoltnet/commit/d237a8ef6a4ca0b7fd48797fd2ab427d6a371a7c))


### Bug Fixes

* **pi-extension:** correct misleading llmAbort comment per [#954](https://github.com/getlarge/themoltnet/issues/954) review ([0a4ac9c](https://github.com/getlarge/themoltnet/commit/0a4ac9cdbcb3dd719a0595b1b0f55e976bd0f54b))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.7.0...pi-extension-v0.8.0) (2026-04-25)


### Features

* **tasks:** add executor manifests ([f704b57](https://github.com/getlarge/themoltnet/commit/f704b57ccf0b6caa6f505a058fe074e8b86a5d1c))
* **tasks:** add executor manifests ([1034ee7](https://github.com/getlarge/themoltnet/commit/1034ee77efbf14a48bfa0ff0f8b23191dfa4d557))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.6.0...pi-extension-v0.7.0) (2026-04-24)


### Features

* **pi-extension:** OTel gen-ai semconv instrumentation ([a9b61ff](https://github.com/getlarge/themoltnet/commit/a9b61ffb82dca7fe1b1d6b63a0a83827ad32de33))
* **pi-extension:** OTel gen-ai semconv instrumentation as extension factory ([eaf983e](https://github.com/getlarge/themoltnet/commit/eaf983e83cb56831898dd038eff48a8d00ab4d63)), closes [#920](https://github.com/getlarge/themoltnet/issues/920)


### Bug Fixes

* **pi-extension:** address [#924](https://github.com/getlarge/themoltnet/issues/924) review feedback ([3715543](https://github.com/getlarge/themoltnet/commit/37155433b6b5e113869d08b63c2f7da21c33e78c))
* **reporter:** close data-loss triangle — restore batch on fail, await inflight, log swallowed errors ([e937003](https://github.com/getlarge/themoltnet/commit/e937003184cd16169fac6037d37fd7feeed7bb4c))
* **tasks:** serialize appendMessages seq, batch reporter, log pg errors ([#921](https://github.com/getlarge/themoltnet/issues/921)) ([2279ea5](https://github.com/getlarge/themoltnet/commit/2279ea5b37a7e23cfc0f4b0c64c2a0e1c6d9527c))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.5.0...pi-extension-v0.6.0) (2026-04-24)


### Features

* **database,rest-api:** migrate rendered pack verification to Tasks API ([455fd04](https://github.com/getlarge/themoltnet/commit/455fd041f839d351d0bc3b3986ab805f529a0a33))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.4.0...pi-extension-v0.5.0) (2026-04-23)


### Features

* **agent-runtime:** add tasks api source and reporter ([b4986c0](https://github.com/getlarge/themoltnet/commit/b4986c076ec337e54b345e299083cf383c96169d))
* **agent-runtime:** publish as @themoltnet/agent-runtime ([bb71b3e](https://github.com/getlarge/themoltnet/commit/bb71b3e0e6e210195c5ebe4ceffb704d5adcd512))
* **pi-extension:** enforce host-exec approval via ctx.ui.confirm() ([b4b2a46](https://github.com/getlarge/themoltnet/commit/b4b2a463000f4ef4688d05062a577b16b0563987))
* run task demos through the Tasks API ([1adea18](https://github.com/getlarge/themoltnet/commit/1adea18c30ecf2e32617f8aebeb4f23094fd581d))
* **sandbox:** inject GitHub App PEM into VM + add host-exec escape hatch ([9cd3e09](https://github.com/getlarge/themoltnet/commit/9cd3e096427971caa94ec4da712ea6dfe599707e))
* **sandbox:** inject GitHub App PEM into VM + host-exec escape hatch ([#907](https://github.com/getlarge/themoltnet/issues/907)) ([1ea74fb](https://github.com/getlarge/themoltnet/commit/1ea74fbec547e6842d4077f42348361d89a72a92))


### Bug Fixes

* **ci:** remove __testables and refresh task artifacts ([113c8bc](https://github.com/getlarge/themoltnet/commit/113c8bcd30344b4bfafc3ef7a85bd026df204c68))
* **curate-pack:** clarify packId vs id in creator prompt ([d0cfd9b](https://github.com/getlarge/themoltnet/commit/d0cfd9b169f375bdc59f6cd5bd011e4aec834780))
* **pi-extension:** address getlarge PR [#905](https://github.com/getlarge/themoltnet/issues/905) review ([ce98073](https://github.com/getlarge/themoltnet/commit/ce98073a60be7467fb303190a218632c675eb1e3))
* **pi-extension:** address PR [#905](https://github.com/getlarge/themoltnet/issues/905) review issues ([7f35783](https://github.com/getlarge/themoltnet/commit/7f3578324bb7f412b19aec9457b748bc84db0322))
* **pi-extension:** set MOLTNET_CREDENTIALS_PATH in guest VM env ([dee0080](https://github.com/getlarge/themoltnet/commit/dee008003d7a40bebece8ccac0f3e1c7679a32a3))
* **pi-extension:** validate task outputs locally ([ce3e2f1](https://github.com/getlarge/themoltnet/commit/ce3e2f10dcc67ce46a84afffcf4287184644fcf8))
* **tasks:** camelCase task contracts and expose tasks SDK ([ccbf203](https://github.com/getlarge/themoltnet/commit/ccbf203de6b1cce86c7e38ef27ac3c5d0954f13c))
* **tasks:** camelcase task payload contracts ([525f094](https://github.com/getlarge/themoltnet/commit/525f094bbabda641c49ea5e65822bf6af9edb681))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.3.0...pi-extension-v0.4.0) (2026-04-23)


### Features

* **pack-pipeline:** curate/render/judge_pack task types + prompt builders ([be89841](https://github.com/getlarge/themoltnet/commit/be89841ae09227779c7f514b12a2a2304b7fd002))
* **pi-extension:** expose moltnet_diary_tags + moltnet_pack_create ([1974f45](https://github.com/getlarge/themoltnet/commit/1974f45819c1d2cd94994c93143bbb104cf59773))


### Bug Fixes

* **curate-pack:** clarify packId vs id in creator prompt ([d0cfd9b](https://github.com/getlarge/themoltnet/commit/d0cfd9b169f375bdc59f6cd5bd011e4aec834780))
* **pack-pipeline:** address PR [#882](https://github.com/getlarge/themoltnet/issues/882) review ([e4c1900](https://github.com/getlarge/themoltnet/commit/e4c19008779a6519eccb64fa3e2f70f855fd0502))
* **pack-pipeline:** unbreak judge_pack end-to-end run ([8f0f4c4](https://github.com/getlarge/themoltnet/commit/8f0f4c4a8ca5fb7f9e08bb9e1d3f249c2ac4b71e))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.2.0...pi-extension-v0.3.0) (2026-04-22)


### Features

* **agent-runtime:** PR 0 — local-mode task runtime + wire-format types ([613af6c](https://github.com/getlarge/themoltnet/commit/613af6ce3abcb2f05112ab3e18b6350933082fac))
* **pack-pipeline:** curate/render/judge_pack task types + prompt builders ([be89841](https://github.com/getlarge/themoltnet/commit/be89841ae09227779c7f514b12a2a2304b7fd002))
* **pi-extension:** expose moltnet_diary_tags + moltnet_pack_create ([1974f45](https://github.com/getlarge/themoltnet/commit/1974f45819c1d2cd94994c93143bbb104cf59773))
* **pi-extension:** pi-native fidelity judge + signed-envelope renderer fix ([7ced200](https://github.com/getlarge/themoltnet/commit/7ced200cc1080ab51d7941f6a8bde5de19395c3a))


### Bug Fixes

* **agent-runtime:** address Copilot review round 2 ([452ed38](https://github.com/getlarge/themoltnet/commit/452ed389e30e625c5164f522db2edd17b91da816))
* **curate-pack:** clarify packId vs id in creator prompt ([d0cfd9b](https://github.com/getlarge/themoltnet/commit/d0cfd9b169f375bdc59f6cd5bd011e4aec834780))
* **pack-pipeline:** address PR [#882](https://github.com/getlarge/themoltnet/issues/882) review ([e4c1900](https://github.com/getlarge/themoltnet/commit/e4c19008779a6519eccb64fa3e2f70f855fd0502))
* **pack-pipeline:** unbreak judge_pack end-to-end run ([8f0f4c4](https://github.com/getlarge/themoltnet/commit/8f0f4c4a8ca5fb7f9e08bb9e1d3f249c2ac4b71e))
* **pi-extension:** resolve judge-recipe versions in src and dist layouts ([86114de](https://github.com/getlarge/themoltnet/commit/86114de7ca7ddcad949e002d43f6a18639e779d8))
* **pi-extension:** route Gondolin tools via customTools, repair worktrees, accept guest paths ([94893b6](https://github.com/getlarge/themoltnet/commit/94893b6839df14137e44aa97a00d0d82df2ec4ed))
* **runtime:** address Copilot review on PR [#876](https://github.com/getlarge/themoltnet/issues/876) ([13b79d8](https://github.com/getlarge/themoltnet/commit/13b79d80f2d1df39aa271fca5dff341e101e0b3b))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.1.0...pi-extension-v0.2.0) (2026-04-21)


### Features

* **pi-extension:** configurable VM resources (memory/cpus) ([c0ff13d](https://github.com/getlarge/themoltnet/commit/c0ff13d1db2616942ab61f29e47e56d07a091cb7))
* **pi-extension:** sandbox.json config, shadow VFS, env isolation ([a8b80b9](https://github.com/getlarge/themoltnet/commit/a8b80b998ca234c83432ffc7b920361321abf294))
* **pi-extension:** sandbox.json config, shadow VFS, env isolation ([89828c3](https://github.com/getlarge/themoltnet/commit/89828c34367865e1f79edc5a2e956a711081cfe6))


### Bug Fixes

* **legreffier-cli:** sync buildGhTokenRule with $MOLTNET_CLI convention ([d93aa15](https://github.com/getlarge/themoltnet/commit/d93aa15b39ef1738cec700bdc5ae5cdd226aec39))
* **pi-extension:** dynamic arch, async branch detection, require --agent ([84883a2](https://github.com/getlarge/themoltnet/commit/84883a2c71e4c2168cb0a033f1a847c3b47dd812))
* **pi-extension:** pass full sandboxConfig to headless resolver, fail-fast on missing GH token ([5e76c78](https://github.com/getlarge/themoltnet/commit/5e76c784f13f25b4ab88a7aa7fc48f80797efac5))
* **pi-extension:** stop auto-writing incidents; fix VM worktree paths ([0265f2e](https://github.com/getlarge/themoltnet/commit/0265f2e0bf62f14326b0fe49f3761be39b95a732))
* **pi-extension:** use relative worktree paths inside the sandbox ([3151ee7](https://github.com/getlarge/themoltnet/commit/3151ee761fd7c4e33b5a73087fe992bc81ae6b4d))
* **skills:** address PR review — MOLTNET_CLI fallback, arch detection, host/guest consistency ([3801502](https://github.com/getlarge/themoltnet/commit/38015022fd8928add81761793dccfcefdc9106b6))
* tweak pi sandbox [skip ci] ([201eb5a](https://github.com/getlarge/themoltnet/commit/201eb5afd77e59c1c2b6482cab834a0bf5482879))
