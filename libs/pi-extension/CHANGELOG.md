# Changelog

## [0.4.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.4.0...pi-extension-v0.4.1) (2026-04-23)


### Bug Fixes

* **curate-pack:** clarify packId vs id in creator prompt ([d0cfd9b](https://github.com/getlarge/themoltnet/commit/d0cfd9b169f375bdc59f6cd5bd011e4aec834780))

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
