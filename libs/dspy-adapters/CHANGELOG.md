# Changelog

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
