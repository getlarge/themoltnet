# Changelog

## [0.6.0](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.5.0...dspy-adapters-v0.6.0) (2026-04-06)


### Features

* **dspy-adapters:** add judge usage to fidelity scores, deduplicate ExtractLLMUsage ([777d376](https://github.com/getlarge/themoltnet/commit/777d376131995d5a24f16f8b8224fa7ff1d32ba7))
* **eval:** add Codex agent and judge support for DSPy engine ([7694cf0](https://github.com/getlarge/themoltnet/commit/7694cf01b5c69c2e47de41b12e8fde0193c86652))


### Bug Fixes

* **checklist:** unwrap LLM decorator to extract judge usage ([5f2efd8](https://github.com/getlarge/themoltnet/commit/5f2efd8b57ba04cee1cb9866189c7439cd51d6f3))
* **dspy-adapters:** capture usage in run() for judge metrics ([b54280c](https://github.com/getlarge/themoltnet/commit/b54280ce0bcfcd6da6d1e0e0a06277930a629e33))
* **eval:** address claude[bot] review findings from PR [#673](https://github.com/getlarge/themoltnet/issues/673) ([e7766f0](https://github.com/getlarge/themoltnet/commit/e7766f00a02b45fc842d1b0cdaae421bcc827c3b))
* **eval:** address Copilot review findings ([428c5aa](https://github.com/getlarge/themoltnet/commit/428c5aa27c58a408313f35127a650c068f99a8e6))
* **eval:** address review findings from DSPy Codex adapter PR ([62caab9](https://github.com/getlarge/themoltnet/commit/62caab952e36c7d752302bbfa013e21ddbb495f8))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.4.0...dspy-adapters-v0.5.0) (2026-04-05)


### Features

* **eval:** DSPy engine phase 2 — concurrency, artifacts, batch mode ([dafcc44](https://github.com/getlarge/themoltnet/commit/dafcc441827047dbf4575220515d4989c3571e6c))


### Bug Fixes

* **dspy-adapters:** bypass global LLM in structured judge output ([3888cc2](https://github.com/getlarge/themoltnet/commit/3888cc26dea0db4b6c7352345758bfe4793e71b5))
* **eval:** address Copilot review findings ([1fb87cb](https://github.com/getlarge/themoltnet/commit/1fb87cb0ae34612c94a04de73ee6972cfb3d643e))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.3.0...dspy-adapters-v0.4.0) (2026-04-04)


### Features

* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **dspy-adapters:** add default judge runtime policy ([4d2e3a2](https://github.com/getlarge/themoltnet/commit/4d2e3a2334f5856806547625edc1ea35e60474d1))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))


### Bug Fixes

* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.2.1...dspy-adapters-v0.3.0) (2026-04-03)


### Features

* **dspy-adapters:** add Codex CLI adapter and isolate both CLI adapters ([73fa3b0](https://github.com/getlarge/themoltnet/commit/73fa3b028a919b3fb5193acf6012a1189706b879))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))

## [0.2.1](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.2.0...dspy-adapters-v0.2.1) (2026-04-02)


### Bug Fixes

* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** implement JSON schema extraction for Claude Code provider ([10254c5](https://github.com/getlarge/themoltnet/commit/10254c5e4d0340adbb29584261b13aa3abb2530a))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/dspy-adapters-v0.1.0...dspy-adapters-v0.2.0) (2026-04-02)


### Features

* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* **fidelity:** harden verification authz and workflow lifecycle ([0cffb0e](https://github.com/getlarge/themoltnet/commit/0cffb0ea5f2557834311a90b5db02abce85e3f3c))
* **moltnet:** add rendered-pack verification CLI and DSPy adapters ([8cb0713](https://github.com/getlarge/themoltnet/commit/8cb071348e25a1f2506383b50a72cf40726d87b7))
