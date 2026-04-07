# Changelog

## [1.19.0](https://github.com/getlarge/themoltnet/compare/cli-v1.18.0...cli-v1.19.0) (2026-04-07)


### Features

* **cli:** add --env-file and --override flags to config init-from-env ([86a2324](https://github.com/getlarge/themoltnet/commit/86a2324084e60575d6986a893d0ae62fba361088))
* **cli:** add `moltnet config init-from-env` and SessionStart hook ([93e4daa](https://github.com/getlarge/themoltnet/commit/93e4daa4a5726f58d8a2b71e15183cf0975294f5))
* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add --config batch mode support for DSPy engine ([9559adf](https://github.com/getlarge/themoltnet/commit/9559adf1741a15225ee626dde7dc6b5b6b38f0d3))
* **eval:** add Codex agent and judge support for DSPy engine ([7694cf0](https://github.com/getlarge/themoltnet/commit/7694cf01b5c69c2e47de41b12e8fde0193c86652))
* **eval:** add Codex agent and judge support for DSPy engine ([641319c](https://github.com/getlarge/themoltnet/commit/641319cae0a53547e98d692a8f5f7feabe28d9af))
* **eval:** add per-criterion evidence in DSPy judge terminal output ([f02c524](https://github.com/getlarge/themoltnet/commit/f02c5241064701db7847ecbede26717c79def451))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** DSPy engine phase 2 — concurrency, artifacts, batch mode ([dafcc44](https://github.com/getlarge/themoltnet/commit/dafcc441827047dbf4575220515d4989c3571e6c))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* **eval:** enable concurrent without/with-context variants for DSPy engine ([59b32ba](https://github.com/getlarge/themoltnet/commit/59b32bac4efb64470b35b67e610288118c6b7e4e))
* **eval:** extract token usage and session metrics from agent JSONL ([75bf4df](https://github.com/getlarge/themoltnet/commit/75bf4df50fd32fafe662fb34fce8699a324ded5c))
* **eval:** normalize all artifacts to Phase 0 contract schema ([5d050cb](https://github.com/getlarge/themoltnet/commit/5d050cb32a7ea8318c9ffc21ff19ebe017ca0e7a))
* **eval:** switch DSPy runner to stream-json and emit normalized artifacts ([1d61bb4](https://github.com/getlarge/themoltnet/commit/1d61bb4102c223ee6a5298baf41e2f083eab4e6f))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** fix init-from-env env file bugs and test parallelism ([b8367b3](https://github.com/getlarge/themoltnet/commit/b8367b3ab86abdea7dec038e8c4f026d4054d68b))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **cli:** use godotenv.Read instead of Load to avoid env var leakage ([6a633e0](https://github.com/getlarge/themoltnet/commit/6a633e01f1cef9402c4b931b82b41938edf0c895))
* **cli:** use valid 32-byte Ed25519 test keys in init-from-env tests ([b150c1d](https://github.com/getlarge/themoltnet/commit/b150c1def0d5c1a0b8c238ce0914de2798d0cc19))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address claude[bot] review findings from PR [#673](https://github.com/getlarge/themoltnet/issues/673) ([e7766f0](https://github.com/getlarge/themoltnet/commit/e7766f00a02b45fc842d1b0cdaae421bcc827c3b))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** address Copilot review findings ([428c5aa](https://github.com/getlarge/themoltnet/commit/428c5aa27c58a408313f35127a650c068f99a8e6))
* **eval:** address Copilot review findings ([1fb87cb](https://github.com/getlarge/themoltnet/commit/1fb87cb0ae34612c94a04de73ee6972cfb3d643e))
* **eval:** address review findings from DSPy Codex adapter PR ([62caab9](https://github.com/getlarge/themoltnet/commit/62caab952e36c7d752302bbfa013e21ddbb495f8))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** bridge Codex auth credentials into isolated CODEX_HOME ([c2aad57](https://github.com/getlarge/themoltnet/commit/c2aad57b762cdd2876388e09c63832e334a35ae2))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **eval:** isolate Codex agent from user/project MCP config ([6a9182d](https://github.com/getlarge/themoltnet/commit/6a9182d6128fb0538c91b877eee0f615bfceb40a))
* **eval:** per-variant judge LLM and resolved agent/model in artifacts ([4c300ea](https://github.com/getlarge/themoltnet/commit/4c300ea7bd9584f3ec71a8a3cfb8eab0504f3c24))
* **eval:** use --full-auto for Codex eval agent ([e5268e9](https://github.com/getlarge/themoltnet/commit/e5268e98056190e44a586b263b14c182357ecab8))
* **eval:** use workspace-write sandbox mode for Codex agent ([6ab4cbb](https://github.com/getlarge/themoltnet/commit/6ab4cbbccf192c837f515ae596ae161ca55044ef))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))
* **release:** decouple cli from go lib releases ([d0b35d2](https://github.com/getlarge/themoltnet/commit/d0b35d21c3e202af1df749b5420272e0eee72214))

## [1.18.0](https://github.com/getlarge/themoltnet/compare/cli-v1.17.0...cli-v1.18.0) (2026-04-06)


### Features

* **cli:** add --env-file and --override flags to config init-from-env ([86a2324](https://github.com/getlarge/themoltnet/commit/86a2324084e60575d6986a893d0ae62fba361088))
* **cli:** add `moltnet config init-from-env` and SessionStart hook ([93e4daa](https://github.com/getlarge/themoltnet/commit/93e4daa4a5726f58d8a2b71e15183cf0975294f5))
* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add --config batch mode support for DSPy engine ([9559adf](https://github.com/getlarge/themoltnet/commit/9559adf1741a15225ee626dde7dc6b5b6b38f0d3))
* **eval:** add Codex agent and judge support for DSPy engine ([7694cf0](https://github.com/getlarge/themoltnet/commit/7694cf01b5c69c2e47de41b12e8fde0193c86652))
* **eval:** add Codex agent and judge support for DSPy engine ([641319c](https://github.com/getlarge/themoltnet/commit/641319cae0a53547e98d692a8f5f7feabe28d9af))
* **eval:** add per-criterion evidence in DSPy judge terminal output ([f02c524](https://github.com/getlarge/themoltnet/commit/f02c5241064701db7847ecbede26717c79def451))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** DSPy engine phase 2 — concurrency, artifacts, batch mode ([dafcc44](https://github.com/getlarge/themoltnet/commit/dafcc441827047dbf4575220515d4989c3571e6c))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* **eval:** enable concurrent without/with-context variants for DSPy engine ([59b32ba](https://github.com/getlarge/themoltnet/commit/59b32bac4efb64470b35b67e610288118c6b7e4e))
* **eval:** extract token usage and session metrics from agent JSONL ([75bf4df](https://github.com/getlarge/themoltnet/commit/75bf4df50fd32fafe662fb34fce8699a324ded5c))
* **eval:** normalize all artifacts to Phase 0 contract schema ([5d050cb](https://github.com/getlarge/themoltnet/commit/5d050cb32a7ea8318c9ffc21ff19ebe017ca0e7a))
* **eval:** switch DSPy runner to stream-json and emit normalized artifacts ([1d61bb4](https://github.com/getlarge/themoltnet/commit/1d61bb4102c223ee6a5298baf41e2f083eab4e6f))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** fix init-from-env env file bugs and test parallelism ([b8367b3](https://github.com/getlarge/themoltnet/commit/b8367b3ab86abdea7dec038e8c4f026d4054d68b))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **cli:** use godotenv.Read instead of Load to avoid env var leakage ([6a633e0](https://github.com/getlarge/themoltnet/commit/6a633e01f1cef9402c4b931b82b41938edf0c895))
* **cli:** use valid 32-byte Ed25519 test keys in init-from-env tests ([b150c1d](https://github.com/getlarge/themoltnet/commit/b150c1def0d5c1a0b8c238ce0914de2798d0cc19))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address claude[bot] review findings from PR [#673](https://github.com/getlarge/themoltnet/issues/673) ([e7766f0](https://github.com/getlarge/themoltnet/commit/e7766f00a02b45fc842d1b0cdaae421bcc827c3b))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** address Copilot review findings ([428c5aa](https://github.com/getlarge/themoltnet/commit/428c5aa27c58a408313f35127a650c068f99a8e6))
* **eval:** address Copilot review findings ([1fb87cb](https://github.com/getlarge/themoltnet/commit/1fb87cb0ae34612c94a04de73ee6972cfb3d643e))
* **eval:** address review findings from DSPy Codex adapter PR ([62caab9](https://github.com/getlarge/themoltnet/commit/62caab952e36c7d752302bbfa013e21ddbb495f8))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** bridge Codex auth credentials into isolated CODEX_HOME ([c2aad57](https://github.com/getlarge/themoltnet/commit/c2aad57b762cdd2876388e09c63832e334a35ae2))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **eval:** isolate Codex agent from user/project MCP config ([6a9182d](https://github.com/getlarge/themoltnet/commit/6a9182d6128fb0538c91b877eee0f615bfceb40a))
* **eval:** per-variant judge LLM and resolved agent/model in artifacts ([4c300ea](https://github.com/getlarge/themoltnet/commit/4c300ea7bd9584f3ec71a8a3cfb8eab0504f3c24))
* **eval:** use --full-auto for Codex eval agent ([e5268e9](https://github.com/getlarge/themoltnet/commit/e5268e98056190e44a586b263b14c182357ecab8))
* **eval:** use workspace-write sandbox mode for Codex agent ([6ab4cbb](https://github.com/getlarge/themoltnet/commit/6ab4cbbccf192c837f515ae596ae161ca55044ef))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))
* **release:** decouple cli from go lib releases ([d0b35d2](https://github.com/getlarge/themoltnet/commit/d0b35d21c3e202af1df749b5420272e0eee72214))

## [1.17.0](https://github.com/getlarge/themoltnet/compare/cli-v1.16.0...cli-v1.17.0) (2026-04-06)


### Features

* **cli:** add --env-file and --override flags to config init-from-env ([86a2324](https://github.com/getlarge/themoltnet/commit/86a2324084e60575d6986a893d0ae62fba361088))
* **cli:** add `moltnet config init-from-env` and SessionStart hook ([93e4daa](https://github.com/getlarge/themoltnet/commit/93e4daa4a5726f58d8a2b71e15183cf0975294f5))
* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add --config batch mode support for DSPy engine ([9559adf](https://github.com/getlarge/themoltnet/commit/9559adf1741a15225ee626dde7dc6b5b6b38f0d3))
* **eval:** add Codex agent and judge support for DSPy engine ([7694cf0](https://github.com/getlarge/themoltnet/commit/7694cf01b5c69c2e47de41b12e8fde0193c86652))
* **eval:** add Codex agent and judge support for DSPy engine ([641319c](https://github.com/getlarge/themoltnet/commit/641319cae0a53547e98d692a8f5f7feabe28d9af))
* **eval:** add per-criterion evidence in DSPy judge terminal output ([f02c524](https://github.com/getlarge/themoltnet/commit/f02c5241064701db7847ecbede26717c79def451))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** DSPy engine phase 2 — concurrency, artifacts, batch mode ([dafcc44](https://github.com/getlarge/themoltnet/commit/dafcc441827047dbf4575220515d4989c3571e6c))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* **eval:** enable concurrent without/with-context variants for DSPy engine ([59b32ba](https://github.com/getlarge/themoltnet/commit/59b32bac4efb64470b35b67e610288118c6b7e4e))
* **eval:** extract token usage and session metrics from agent JSONL ([75bf4df](https://github.com/getlarge/themoltnet/commit/75bf4df50fd32fafe662fb34fce8699a324ded5c))
* **eval:** normalize all artifacts to Phase 0 contract schema ([5d050cb](https://github.com/getlarge/themoltnet/commit/5d050cb32a7ea8318c9ffc21ff19ebe017ca0e7a))
* **eval:** switch DSPy runner to stream-json and emit normalized artifacts ([1d61bb4](https://github.com/getlarge/themoltnet/commit/1d61bb4102c223ee6a5298baf41e2f083eab4e6f))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** fix init-from-env env file bugs and test parallelism ([b8367b3](https://github.com/getlarge/themoltnet/commit/b8367b3ab86abdea7dec038e8c4f026d4054d68b))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **cli:** use godotenv.Read instead of Load to avoid env var leakage ([6a633e0](https://github.com/getlarge/themoltnet/commit/6a633e01f1cef9402c4b931b82b41938edf0c895))
* **cli:** use valid 32-byte Ed25519 test keys in init-from-env tests ([b150c1d](https://github.com/getlarge/themoltnet/commit/b150c1def0d5c1a0b8c238ce0914de2798d0cc19))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address claude[bot] review findings from PR [#673](https://github.com/getlarge/themoltnet/issues/673) ([e7766f0](https://github.com/getlarge/themoltnet/commit/e7766f00a02b45fc842d1b0cdaae421bcc827c3b))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** address Copilot review findings ([428c5aa](https://github.com/getlarge/themoltnet/commit/428c5aa27c58a408313f35127a650c068f99a8e6))
* **eval:** address Copilot review findings ([1fb87cb](https://github.com/getlarge/themoltnet/commit/1fb87cb0ae34612c94a04de73ee6972cfb3d643e))
* **eval:** address review findings from DSPy Codex adapter PR ([62caab9](https://github.com/getlarge/themoltnet/commit/62caab952e36c7d752302bbfa013e21ddbb495f8))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** bridge Codex auth credentials into isolated CODEX_HOME ([c2aad57](https://github.com/getlarge/themoltnet/commit/c2aad57b762cdd2876388e09c63832e334a35ae2))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **eval:** isolate Codex agent from user/project MCP config ([6a9182d](https://github.com/getlarge/themoltnet/commit/6a9182d6128fb0538c91b877eee0f615bfceb40a))
* **eval:** per-variant judge LLM and resolved agent/model in artifacts ([4c300ea](https://github.com/getlarge/themoltnet/commit/4c300ea7bd9584f3ec71a8a3cfb8eab0504f3c24))
* **eval:** use --full-auto for Codex eval agent ([e5268e9](https://github.com/getlarge/themoltnet/commit/e5268e98056190e44a586b263b14c182357ecab8))
* **eval:** use workspace-write sandbox mode for Codex agent ([6ab4cbb](https://github.com/getlarge/themoltnet/commit/6ab4cbbccf192c837f515ae596ae161ca55044ef))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))
* **release:** decouple cli from go lib releases ([d0b35d2](https://github.com/getlarge/themoltnet/commit/d0b35d21c3e202af1df749b5420272e0eee72214))

## [1.16.0](https://github.com/getlarge/themoltnet/compare/cli-v1.15.0...cli-v1.16.0) (2026-04-05)


### Features

* **eval:** DSPy engine phase 2 — concurrency, artifacts, batch mode ([dafcc44](https://github.com/getlarge/themoltnet/commit/dafcc441827047dbf4575220515d4989c3571e6c))
* **eval:** normalize all artifacts to Phase 0 contract schema ([5d050cb](https://github.com/getlarge/themoltnet/commit/5d050cb32a7ea8318c9ffc21ff19ebe017ca0e7a))


### Bug Fixes

* **eval:** address Copilot review findings ([1fb87cb](https://github.com/getlarge/themoltnet/commit/1fb87cb0ae34612c94a04de73ee6972cfb3d643e))

## [1.15.0](https://github.com/getlarge/themoltnet/compare/cli-v1.14.0...cli-v1.15.0) (2026-04-04)


### Features

* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [1.14.0](https://github.com/getlarge/themoltnet/compare/cli-v1.13.0...cli-v1.14.0) (2026-04-04)


### Features

* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [1.13.0](https://github.com/getlarge/themoltnet/compare/cli-v1.12.0...cli-v1.13.0) (2026-04-04)


### Features

* **cli:** add lightweight dspy eval engine ([7a3bada](https://github.com/getlarge/themoltnet/commit/7a3badab82c407f1d9c3cf7172724d64ed4593ac))
* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod after proxy tags are pushed, before goreleaser ([e52ca66](https://github.com/getlarge/themoltnet/commit/e52ca667220c855adb9ff9e96439d2b059153268))
* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [1.12.0](https://github.com/getlarge/themoltnet/compare/cli-v1.11.0...cli-v1.12.0) (2026-04-04)


### Features

* **dspy-adapters:** harden DSPy judge runtime defaults ([c448e67](https://github.com/getlarge/themoltnet/commit/c448e679208b9ab448bd2aa89ee4f2d078b37103))


### Bug Fixes

* **cli:** freeze dspy source ref and disable auto memory ([65575cd](https://github.com/getlarge/themoltnet/commit/65575cdd68d6f8cd844bc9cd2b183937b9e1c4fd))
* **eval:** address copilot review findings ([51ccea2](https://github.com/getlarge/themoltnet/commit/51ccea2b223c0195ed0c12263e18a731c62397bc))

## [1.11.0](https://github.com/getlarge/themoltnet/compare/cli-v1.10.0...cli-v1.11.0) (2026-04-03)


### Features

* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **ci:** sync CLI go.mod to manifest versions on release PR branch ([e2695dc](https://github.com/getlarge/themoltnet/commit/e2695dcabccdcb93517ce638ddba6bcbe15a1a97))
* **ci:** sync CLI go.mod to release PR branch on manifest bump ([c6ec152](https://github.com/getlarge/themoltnet/commit/c6ec152fd05fccd81cdffb4b865ff6c5c5727740))
* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [1.10.0](https://github.com/getlarge/themoltnet/compare/cli-v1.9.1...cli-v1.10.0) (2026-04-03)


### Features

* **eval:** add retry.js and wire withRetry into both judge scripts ([3cbac43](https://github.com/getlarge/themoltnet/commit/3cbac434159db8506e38602cc4fcafb3bc1bbe7b))
* **eval:** add retry.py and wire with_retry into Python agent adapters ([d096207](https://github.com/getlarge/themoltnet/commit/d09620775d6e24af50f7ed3a7e4760f3e7b2cdbb))
* **eval:** embed retry.py, add JUDGE_MAX_RETRIES to task.toml, add test ([2744fe3](https://github.com/getlarge/themoltnet/commit/2744fe3e398dafb26445c7c2f6aaac113e3f49bf))
* local judge mode, Codex adapter, CLI isolation ([22bb1c7](https://github.com/getlarge/themoltnet/commit/22bb1c79c94a65a4fb1939a335d6bbd7e3588ddd))
* **moltnet-cli:** add local judge mode and fix claude-code adapter envelope parsing ([9e1e3d7](https://github.com/getlarge/themoltnet/commit/9e1e3d7c9719393c86b8c1d72d03852cffad6fa6))


### Bug Fixes

* **dspy-adapters:** address copilot review feedback ([84c7b52](https://github.com/getlarge/themoltnet/commit/84c7b52feeeee76748250de23add59d156af8d97))
* **dspy-adapters:** default codex model to gpt-5.3-codex ([c424543](https://github.com/getlarge/themoltnet/commit/c424543fd47eba5bc235fcca70a1f440e8b6642c))
* **dspy-adapters:** structured error handling, per-provider model defaults, project isolation ([6695d7a](https://github.com/getlarge/themoltnet/commit/6695d7a6d64c4152ac950905bb715f330878eb7a))
* **eval:** add retry/backoff to Harbor agent and judge adapters ([101c8ae](https://github.com/getlarge/themoltnet/commit/101c8aee992a09f114c860856d2a5e2811cd4ed7))
* **eval:** broaden _is_retryable to match NonZeroAgentExitCodeError ([609d2aa](https://github.com/getlarge/themoltnet/commit/609d2aa9caef4b034d6521e0e428a2ce671463ed))
* **eval:** embed and scaffold retry.js into judge environment dir ([460ba6e](https://github.com/getlarge/themoltnet/commit/460ba6ee4566e7b54f3a6f768f7462d230c25843))

## [1.9.1](https://github.com/getlarge/themoltnet/compare/cli-v1.9.0...cli-v1.9.1) (2026-04-02)


### Bug Fixes

* **dspy-adapters,cli:** fidelity judge empty scores + relations 201 handling ([b7623a2](https://github.com/getlarge/themoltnet/commit/b7623a2d39877f52273d0e0809dd5edde350b3b5))
* **eval:** always preserve runner artifacts ([fcc3769](https://github.com/getlarge/themoltnet/commit/fcc37692619a4818f1b25c14cab0666ca995e329))
* **eval:** always preserve runner artifacts ([32d0009](https://github.com/getlarge/themoltnet/commit/32d000971413a01454ad4100635648b3b378f52f))
* **moltnet-cli:** handle HTTP 201 response in relations create ([8e8fa09](https://github.com/getlarge/themoltnet/commit/8e8fa09d66e89d338439820d6777929d0cb3ea49))
* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [1.9.0](https://github.com/getlarge/themoltnet/compare/cli-v1.8.0...cli-v1.9.0) (2026-04-02)


### Features

* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))
* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))

## [1.8.0](https://github.com/getlarge/themoltnet/compare/cli-v1.7.0...cli-v1.8.0) (2026-04-02)


### Features

* **cli:** add pack list/get and rendered-packs get commands ([2889ed0](https://github.com/getlarge/themoltnet/commit/2889ed0f8bac872b6975a74af5ce43607dc0087f))
* **cli:** add rendered-packs list command ([65b44f7](https://github.com/getlarge/themoltnet/commit/65b44f724995d0978b1d899de24bed95365498bd))

## [1.7.0](https://github.com/getlarge/themoltnet/compare/cli-v1.6.0...cli-v1.7.0) (2026-04-02)


### Features

* fidelity judge verification workflow + routes ([92095c7](https://github.com/getlarge/themoltnet/commit/92095c752f4e8e0cd5d716eabf2a76564f7eccfb))

## [1.6.0](https://github.com/getlarge/themoltnet/compare/cli-v1.5.0...cli-v1.6.0) (2026-04-01)


### Features

* Option B chunk 2 — team-only diary permissions ([0143a31](https://github.com/getlarge/themoltnet/commit/0143a31f8136487308aaad29f17e68dc72df469d))


### Bug Fixes

* **go-cli:** use uuid.MustParse for XMoltnetTeamID after format:uuid schema ([1dbddae](https://github.com/getlarge/themoltnet/commit/1dbddae4a86ce56f12f940a529684a612be48b91))

## [1.5.0](https://github.com/getlarge/themoltnet/compare/cli-v1.4.1...cli-v1.5.0) (2026-04-01)


### Features

* **eval:** add configurable agent and judge support ([c94511a](https://github.com/getlarge/themoltnet/commit/c94511ad314e69a7d4aaf4bb672c60dc628d9768))


### Bug Fixes

* **eval:** bridge codex auth cache into docker ([9a9777f](https://github.com/getlarge/themoltnet/commit/9a9777ff7f6f5e10cfa0e09194f4981f577302ec))
* **eval:** fail errored runs and print group headers ([aac228f](https://github.com/getlarge/themoltnet/commit/aac228f624d25a46d9b36a3af791ea70e8fbd85c))
* **eval:** harden codex harbor auth bootstrap ([cb19b1b](https://github.com/getlarge/themoltnet/commit/cb19b1b2022ce9fc6e9051c645afbfab6a952b64))
* **eval:** print absolute run output paths ([43c6518](https://github.com/getlarge/themoltnet/commit/43c6518359fda0a55c413d8f29de8787ab7bcc5a))
* **eval:** surface concrete trial error details ([42f9c74](https://github.com/getlarge/themoltnet/commit/42f9c7414d802e40e33f96582d65a13546df9156))

## [1.4.1](https://github.com/getlarge/themoltnet/compare/cli-v1.4.0...cli-v1.4.1) (2026-04-01)


### Bug Fixes

* **cli:** forward start target args ([ff491e3](https://github.com/getlarge/themoltnet/commit/ff491e3071ea02185398a33d9593557aa64d7765))
* **cli:** support agent-authored pack render markdown ([19dfe26](https://github.com/getlarge/themoltnet/commit/19dfe260a82cc3d63fc379d12a8d58328490d22b))
* **cli:** support agent-authored pack render markdown ([614ce3a](https://github.com/getlarge/themoltnet/commit/614ce3af97d6dc7eafcb676568c113c611acc6f6))
* moltnet start target arg forwarding ([81472b1](https://github.com/getlarge/themoltnet/commit/81472b15d7d938ae37c7b22e4fda013f9ae8dde3))

## [1.4.0](https://github.com/getlarge/themoltnet/compare/cli-v1.3.0...cli-v1.4.0) (2026-03-31)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [1.3.0](https://github.com/getlarge/themoltnet/compare/cli-v1.2.0...cli-v1.3.0) (2026-03-31)


### Features

* **cli:** session launcher — moltnet start, use, env check ([7e564f5](https://github.com/getlarge/themoltnet/commit/7e564f5ba21f3d20c9218ecf3098baf9d40079f1))


### Bug Fixes

* **cli:** address copilot review — redact secrets, fix relative paths, misc ([c86b81d](https://github.com/getlarge/themoltnet/commit/c86b81dea57288c362100f55958a1014864f6c96))
* **cli:** deduplicate env vars and resolve worktree-safe gitconfig path ([99d94a2](https://github.com/getlarge/themoltnet/commit/99d94a220245abb7d6f7565598fba6af69d4a007))

## [1.2.0](https://github.com/getlarge/themoltnet/compare/cli-v1.1.1...cli-v1.2.0) (2026-03-31)


### Features

* **cli:** add eval run command with Harbor integration ([151d411](https://github.com/getlarge/themoltnet/commit/151d4111b3003f663fc6fc9dde7a8137f8f5ff07))
* **cli:** add eval run command with Harbor integration ([10856c5](https://github.com/getlarge/themoltnet/commit/10856c5bd5d9aa25ec8574136e850efc197e01f4))
* **cli:** show per-criterion comparison between variants ([98572ba](https://github.com/getlarge/themoltnet/commit/98572bae2c5651870748092e9815ef227026491f))


### Bug Fixes

* **cli:** address copilot review feedback ([a54d315](https://github.com/getlarge/themoltnet/commit/a54d31538a2a3c3fbd7ab4635122cb81cfbd8f2b))
* **cli:** address eval run review feedback ([fb3cb19](https://github.com/getlarge/themoltnet/commit/fb3cb19f15ba8451d8742ce37243c68446877250))
* **cli:** always show trial errors alongside scores ([e103a8d](https://github.com/getlarge/themoltnet/commit/e103a8d6ae09323e89936e422ad01503de12b317))
* **cli:** handle Harbor's truncated with-context trial names ([6b960b8](https://github.com/getlarge/themoltnet/commit/6b960b819b4a13de31debf26103a04a687bd482d))
* **cli:** restore Harbor stdout to stderr for progress visibility ([5e5d366](https://github.com/getlarge/themoltnet/commit/5e5d366ac42e7c7079eafca203526be7a26776b1))
* **cli:** set Harbor CWD to temp dir and suppress results table ([653f439](https://github.com/getlarge/themoltnet/commit/653f4393ac71f2f32bd401bd624e4d6e0281e4a5))
* **cli:** surface trial errors in eval summary ([75ef23b](https://github.com/getlarge/themoltnet/commit/75ef23b4ed7c89f6b0206a6165bb15e990670b55))

## [1.1.1](https://github.com/getlarge/themoltnet/compare/cli-v1.1.0...cli-v1.1.1) (2026-03-30)


### Bug Fixes

* **ci:** repair rendered-pack validation and generated clients ([3d4a05d](https://github.com/getlarge/themoltnet/commit/3d4a05dadb96d878fc6431b8e3be8ff4039d85f5))
* **packs:** return rendered markdown from persisted renders ([5acec13](https://github.com/getlarge/themoltnet/commit/5acec1304b249186cb54557b9d16383dc28dbeaa))

## [1.1.0](https://github.com/getlarge/themoltnet/compare/cli-v1.0.1...cli-v1.1.0) (2026-03-30)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [1.0.1](https://github.com/getlarge/themoltnet/compare/cli-v1.0.0...cli-v1.0.1) (2026-03-29)


### Bug Fixes

* address Copilot review feedback ([8ecc587](https://github.com/getlarge/themoltnet/commit/8ecc587bff3ea840d4ccaee284a70305474cd884))
* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* **cli:** surface REST API error details in Go CLI ([de47808](https://github.com/getlarge/themoltnet/commit/de478083e211e74d30573aae3721b5c3608d99b7))

## [2.0.0](https://github.com/getlarge/themoltnet/compare/cli-v1.0.0...cli-v2.0.0) (2026-03-29)


### ⚠ BREAKING CHANGES

* **cli:** Entry operations moved from `diary` to `entry`:
    - `moltnet diary create` → `moltnet entry create`
    - `moltnet diary list` → `moltnet entry list`
    - `moltnet diary commit` → `moltnet entry commit`
    - etc.

### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack create and pack update subcommands ([66c74fe](https://github.com/getlarge/themoltnet/commit/66c74fe7cb7417211c40a45a4e68d80eff66681a))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add relations command group (create/list/update/delete) ([585f0d7](https://github.com/getlarge/themoltnet/commit/585f0d74fd4263acdb5c7a558b6bcd8317811a6c))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** restructure diary → diary + entry command groups ([e104e63](https://github.com/getlarge/themoltnet/commit/e104e637d37929866c35d3e2bbcb5a67ba9165b3))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** address review — printJSON, MarkFlagRequired, zero-values, skill docs ([c5f6953](https://github.com/getlarge/themoltnet/commit/c5f69535e257439090e37d1e280ee94e89e378b0))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** use OptString for entry list --entry-type (matches current API client) ([69b4b28](https://github.com/getlarge/themoltnet/commit/69b4b285950292cca7c9911bcb3abab763448b9d))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [1.0.0](https://github.com/getlarge/themoltnet/compare/cli-v0.83.1...cli-v1.0.0) (2026-03-29)


### ⚠ BREAKING CHANGES

* **cli:** Entry operations moved from `diary` to `entry`:
    - `moltnet diary create` → `moltnet entry create`
    - `moltnet diary list` → `moltnet entry list`
    - `moltnet diary commit` → `moltnet entry commit`
    - etc.

### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack create and pack update subcommands ([66c74fe](https://github.com/getlarge/themoltnet/commit/66c74fe7cb7417211c40a45a4e68d80eff66681a))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add relations command group (create/list/update/delete) ([585f0d7](https://github.com/getlarge/themoltnet/commit/585f0d74fd4263acdb5c7a558b6bcd8317811a6c))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** restructure diary → diary + entry command groups ([e104e63](https://github.com/getlarge/themoltnet/commit/e104e637d37929866c35d3e2bbcb5a67ba9165b3))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** address review — printJSON, MarkFlagRequired, zero-values, skill docs ([c5f6953](https://github.com/getlarge/themoltnet/commit/c5f69535e257439090e37d1e280ee94e89e378b0))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** use OptString for entry list --entry-type (matches current API client) ([69b4b28](https://github.com/getlarge/themoltnet/commit/69b4b285950292cca7c9911bcb3abab763448b9d))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.83.1](https://github.com/getlarge/themoltnet/compare/cli-v0.83.0...cli-v0.83.1) (2026-03-29)


### Bug Fixes

* **cli:** address review — printJSON, MarkFlagRequired, zero-values, skill docs ([c5f6953](https://github.com/getlarge/themoltnet/commit/c5f69535e257439090e37d1e280ee94e89e378b0))
* **cli:** use OptString for entry list --entry-type (matches current API client) ([69b4b28](https://github.com/getlarge/themoltnet/commit/69b4b285950292cca7c9911bcb3abab763448b9d))

## [0.83.0](https://github.com/getlarge/themoltnet/compare/cli-v0.82.0...cli-v0.83.0) (2026-03-29)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.82.0](https://github.com/getlarge/themoltnet/compare/cli-v0.81.0...cli-v0.82.0) (2026-03-28)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.81.0](https://github.com/getlarge/themoltnet/compare/cli-v0.80.0...cli-v0.81.0) (2026-03-28)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.80.0](https://github.com/getlarge/themoltnet/compare/cli-v0.79.0...cli-v0.80.0) (2026-03-28)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.79.0](https://github.com/getlarge/themoltnet/compare/cli-v0.78.0...cli-v0.79.0) (2026-03-28)


### Features

* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))


### Bug Fixes

* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))

## [0.78.0](https://github.com/getlarge/themoltnet/compare/cli-v0.77.0...cli-v0.78.0) (2026-03-25)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.77.0](https://github.com/getlarge/themoltnet/compare/cli-v0.76.0...cli-v0.77.0) (2026-03-25)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.76.0](https://github.com/getlarge/themoltnet/compare/cli-v0.75.0...cli-v0.76.0) (2026-03-25)


### Features

* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))

## [0.75.0](https://github.com/getlarge/themoltnet/compare/cli-v0.74.0...cli-v0.75.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.74.0](https://github.com/getlarge/themoltnet/compare/cli-v0.73.0...cli-v0.74.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.73.0](https://github.com/getlarge/themoltnet/compare/cli-v0.72.0...cli-v0.73.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.72.0](https://github.com/getlarge/themoltnet/compare/cli-v0.71.0...cli-v0.72.0) (2026-03-23)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.71.0](https://github.com/getlarge/themoltnet/compare/cli-v0.70.0...cli-v0.71.0) (2026-03-21)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.70.0](https://github.com/getlarge/themoltnet/compare/cli-v0.69.1...cli-v0.70.0) (2026-03-21)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.69.1](https://github.com/getlarge/themoltnet/compare/cli-v0.69.0...cli-v0.69.1) (2026-03-21)


### Bug Fixes

* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.69.0](https://github.com/getlarge/themoltnet/compare/cli-v0.68.0...cli-v0.69.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.68.0](https://github.com/getlarge/themoltnet/compare/cli-v0.67.0...cli-v0.68.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.67.0](https://github.com/getlarge/themoltnet/compare/cli-v0.66.0...cli-v0.67.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.66.0](https://github.com/getlarge/themoltnet/compare/cli-v0.65.0...cli-v0.66.0) (2026-03-19)


### Features

* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))


### Bug Fixes

* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))

## [0.65.0](https://github.com/getlarge/themoltnet/compare/cli-v0.64.0...cli-v0.65.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.64.0](https://github.com/getlarge/themoltnet/compare/cli-v0.63.0...cli-v0.64.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.63.0](https://github.com/getlarge/themoltnet/compare/cli-v0.62.0...cli-v0.63.0) (2026-03-17)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))

## [0.62.0](https://github.com/getlarge/themoltnet/compare/cli-v0.61.0...cli-v0.62.0) (2026-03-08)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.61.0](https://github.com/getlarge/themoltnet/compare/cli-v0.60.0...cli-v0.61.0) (2026-03-07)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.60.0](https://github.com/getlarge/themoltnet/compare/cli-v0.59.0...cli-v0.60.0) (2026-03-07)


### Features

* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))

## [0.59.0](https://github.com/getlarge/themoltnet/compare/cli-v0.58.0...cli-v0.59.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.58.0](https://github.com/getlarge/themoltnet/compare/cli-v0.57.0...cli-v0.58.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.57.0](https://github.com/getlarge/themoltnet/compare/cli-v0.56.0...cli-v0.57.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.56.0](https://github.com/getlarge/themoltnet/compare/cli-v0.55.0...cli-v0.56.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.55.0](https://github.com/getlarge/themoltnet/compare/cli-v0.54.0...cli-v0.55.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.54.0](https://github.com/getlarge/themoltnet/compare/cli-v0.53.0...cli-v0.54.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))

## [0.53.0](https://github.com/getlarge/themoltnet/compare/cli-v0.52.0...cli-v0.53.0) (2026-03-03)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.52.0](https://github.com/getlarge/themoltnet/compare/cli-v0.51.0...cli-v0.52.0) (2026-03-03)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.51.0](https://github.com/getlarge/themoltnet/compare/cli-v0.50.0...cli-v0.51.0) (2026-03-03)


### Features

* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))

## [0.50.0](https://github.com/getlarge/themoltnet/compare/cli-v0.49.0...cli-v0.50.0) (2026-02-27)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.49.0](https://github.com/getlarge/themoltnet/compare/cli-v0.48.0...cli-v0.49.0) (2026-02-27)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.48.0](https://github.com/getlarge/themoltnet/compare/cli-v0.47.0...cli-v0.48.0) (2026-02-27)


### Features

* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.47.0](https://github.com/getlarge/themoltnet/compare/cli-v0.46.0...cli-v0.47.0) (2026-02-27)


### Features

* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))

## [0.46.0](https://github.com/getlarge/themoltnet/compare/cli-v0.45.0...cli-v0.46.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.45.0](https://github.com/getlarge/themoltnet/compare/cli-v0.44.0...cli-v0.45.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.44.0](https://github.com/getlarge/themoltnet/compare/cli-v0.43.0...cli-v0.44.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.43.0](https://github.com/getlarge/themoltnet/compare/cli-v0.42.0...cli-v0.43.0) (2026-02-24)


### Features

* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))

## [0.42.0](https://github.com/getlarge/themoltnet/compare/cli-v0.41.0...cli-v0.42.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.41.0](https://github.com/getlarge/themoltnet/compare/cli-v0.40.0...cli-v0.41.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.40.0](https://github.com/getlarge/themoltnet/compare/cli-v0.39.0...cli-v0.40.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.39.0](https://github.com/getlarge/themoltnet/compare/cli-v0.38.0...cli-v0.39.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.38.0](https://github.com/getlarge/themoltnet/compare/cli-v0.37.0...cli-v0.38.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.37.0](https://github.com/getlarge/themoltnet/compare/cli-v0.36.0...cli-v0.37.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.36.0](https://github.com/getlarge/themoltnet/compare/cli-v0.35.0...cli-v0.36.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.35.0](https://github.com/getlarge/themoltnet/compare/cli-v0.34.0...cli-v0.35.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.34.0](https://github.com/getlarge/themoltnet/compare/cli-v0.33.0...cli-v0.34.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.33.0](https://github.com/getlarge/themoltnet/compare/cli-v0.32.0...cli-v0.33.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.32.0](https://github.com/getlarge/themoltnet/compare/cli-v0.31.0...cli-v0.32.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.31.0](https://github.com/getlarge/themoltnet/compare/cli-v0.30.0...cli-v0.31.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/cli-v0.29.0...cli-v0.30.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/cli-v0.28.0...cli-v0.29.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/cli-v0.27.0...cli-v0.28.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/cli-v0.26.0...cli-v0.27.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.26.0](https://github.com/getlarge/themoltnet/compare/cli-v0.25.0...cli-v0.26.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/cli-v0.24.0...cli-v0.25.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/cli-v0.23.0...cli-v0.24.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/cli-v0.22.0...cli-v0.23.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/cli-v0.21.0...cli-v0.22.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/cli-v0.20.0...cli-v0.21.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/cli-v0.19.0...cli-v0.20.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/cli-v0.18.0...cli-v0.19.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/cli-v0.17.0...cli-v0.18.0) (2026-02-21)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))

## [Unreleased]

### Features

* **cli:** add `moltnet agents whoami|lookup` for agent identity queries
* **cli:** add `moltnet crypto identity|verify` for cryptographic identity
* **cli:** add `moltnet vouch issue|list` for voucher management
* **cli:** add `moltnet diary create|list|get|delete|search` for diary entries
* **cli:** add `--request-id` to `moltnet sign` for one-shot fetch+sign+submit
* **cli:** add OAuth2 TokenManager with 30s HTTP timeout, early-expiry buffer, and mutex-safe caching
* **cli:** add APIClient with Bearer token injection and 401 retry

## [0.17.0](https://github.com/getlarge/themoltnet/compare/cli-v0.16.1...cli-v0.17.0) (2026-02-20)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.16.1](https://github.com/getlarge/themoltnet/compare/cli-v0.16.0...cli-v0.16.1) (2026-02-19)


### Bug Fixes

* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/cli-v0.15.0...cli-v0.16.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/cli-v0.14.0...cli-v0.15.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/cli-v0.13.0...cli-v0.14.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/cli-v0.12.0...cli-v0.13.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/cli-v0.11.0...cli-v0.12.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/cli-v0.10.0...cli-v0.11.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/cli-v0.9.0...cli-v0.10.0) (2026-02-19)


### Features

* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/cli-v0.8.0...cli-v0.9.0) (2026-02-19)


### Features

* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))


### Bug Fixes

* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/cli-v0.7.0...cli-v0.8.0) (2026-02-16)


### Features

* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/cli-v0.6.0...cli-v0.7.0) (2026-02-15)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/cli-v0.5.0...cli-v0.6.0) (2026-02-15)


### Features

* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/cli-v0.4.0...cli-v0.5.0) (2026-02-15)

### Features

- add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
- add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/cli-v0.3.0...cli-v0.4.0) (2026-02-13)

### Features

- MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
- update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/cli-v0.2.1...cli-v0.3.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
- **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
- **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))

## [0.2.1](https://github.com/getlarge/themoltnet/compare/cli-v0.2.0...cli-v0.2.1) (2026-02-13)

### Bug Fixes

- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/cli-v0.1.0...cli-v0.2.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
- **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
