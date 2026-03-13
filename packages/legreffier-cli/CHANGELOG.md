# Changelog

## [0.21.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.20.0...legreffier-v0.21.0) (2026-03-12)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **design-system:** make publishable as @themoltnet/design-system ([c242d26](https://github.com/getlarge/themoltnet/commit/c242d26f752c0deea4410c8b96b12765b759e9ef))
* **design-system:** make publishable as @themoltnet/design-system ([fd4275e](https://github.com/getlarge/themoltnet/commit/fd4275edf669057bd39d50b9d1c1de5eabba137e))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.19.0...legreffier-v0.20.0) (2026-03-12)


### Features

* **design-system:** make publishable as @themoltnet/design-system ([c242d26](https://github.com/getlarge/themoltnet/commit/c242d26f752c0deea4410c8b96b12765b759e9ef))
* **design-system:** make publishable as @themoltnet/design-system ([fd4275e](https://github.com/getlarge/themoltnet/commit/fd4275edf669057bd39d50b9d1c1de5eabba137e))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.18.0...legreffier-v0.19.0) (2026-03-08)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.17.0...legreffier-v0.18.0) (2026-03-07)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.16.0...legreffier-v0.17.0) (2026-03-07)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.15.0...legreffier-v0.16.0) (2026-03-06)


### Features

* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.14.0...legreffier-v0.15.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.13.0...legreffier-v0.14.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.12.0...legreffier-v0.13.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.11.0...legreffier-v0.12.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.10.0...legreffier-v0.11.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.9.0...legreffier-v0.10.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.8.0...legreffier-v0.9.0) (2026-03-03)


### Features

* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.7.0...legreffier-v0.8.0) (2026-03-03)


### Features

* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))
* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.6.0...legreffier-v0.7.0) (2026-03-03)


### Features

* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **legreffier:** add 'legreffier github token' subcommand ([6a3d5a3](https://github.com/getlarge/themoltnet/commit/6a3d5a3c844d082cd399fa55468d0d4afcd457b7)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **legreffier:** generate agent rules for gh CLI authentication ([207e639](https://github.com/getlarge/themoltnet/commit/207e639045e4529dea633af6e182b73995040cda)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)


### Bug Fixes

* **cli:** address copilot review feedback ([1ec9fe4](https://github.com/getlarge/themoltnet/commit/1ec9fe4890c338aa808b48c22216798a0cf98048))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.5.1...legreffier-v0.6.0) (2026-03-03)


### Features

* **legreffier-cli:** add `setup` subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([5be5c14](https://github.com/getlarge/themoltnet/commit/5be5c1477312db75f607c1ef443dcf2c21c88e39))
* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))
* **legreffier-cli:** write env file for Codex and source it in codex script ([f69c1ca](https://github.com/getlarge/themoltnet/commit/f69c1cae3cfdffe712e29bdc13c99c51f7838eee))


### Bug Fixes

* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([c315c22](https://github.com/getlarge/themoltnet/commit/c315c224bfdf285b9c670972323f42be82f51a0b))
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.5.1](https://github.com/getlarge/themoltnet/compare/legreffier-v0.5.0...legreffier-v0.5.1) (2026-03-02)


### Bug Fixes

* **legreffier:** move workspace deps to devDependencies ([b369bda](https://github.com/getlarge/themoltnet/commit/b369bda645a3875c4f7f78f9cc84bbfe5990e5a0))
* **legreffier:** workspace deps leaked into published package ([ff45dc8](https://github.com/getlarge/themoltnet/commit/ff45dc85234a13fcb610b1f3ec7e8c9a00d2deed))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.4.0...legreffier-v0.5.0) (2026-02-27)


### Features

* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.3.0...legreffier-v0.4.0) (2026-02-27)


### Features

* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))


### Bug Fixes

* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.2.0...legreffier-v0.3.0) (2026-02-27)


### Features

* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))


### Bug Fixes

* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.1.0...legreffier-v0.2.0) (2026-02-27)


### Features

* **legreffier-cli:** add agent selection step and refactor phase rendering ([4c061a4](https://github.com/getlarge/themoltnet/commit/4c061a4c4eaedf49b5e8f09fb5c4ceff8d7ac67c))
* **legreffier-cli:** add permission allow-list to settings.local.json ([890fc98](https://github.com/getlarge/themoltnet/commit/890fc9840f1a7dce2d7659d116910637e7c8132e))
* **legreffier-cli:** add release-please and npm publishing pipeline ([69418f1](https://github.com/getlarge/themoltnet/commit/69418f154761165c2c08325432eb2b79adf4add4))
* **legreffier-cli:** enabledMcpjsonServers + skill agent name & worktree support ([dc47947](https://github.com/getlarge/themoltnet/commit/dc47947e5e643462ef58b32832b496923f7b91af))
* **legreffier-cli:** FP phase refactor, agent-scoped config, prefixed env vars ([8bcf2d5](https://github.com/getlarge/themoltnet/commit/8bcf2d54fecda84b65e89bbdc5438cb0b0724806))
* **legreffier-cli:** GitHub helpers — manifest code exchange, bot lookup, PEM writer ([81d0240](https://github.com/getlarge/themoltnet/commit/81d0240b6bf3c2fd798f51e2dfd44b1e16589911))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier-cli:** main InitApp component — full 4-step onboarding flow ([208aa73](https://github.com/getlarge/themoltnet/commit/208aa73ed2817b881ecb6f6dd184cb19415b74cf))
* **legreffier-cli:** MoltNet API helpers with startOnboarding, pollStatus, pollUntil ([5f77321](https://github.com/getlarge/themoltnet/commit/5f77321db8487d6a610750a4881a3dcfdeb40b93))
* **legreffier-cli:** polish CLI — config centralization, skill upgrades, publishing ([3b543e6](https://github.com/getlarge/themoltnet/commit/3b543e6cca7caab3448d0067510d2eebf2076bef))
* **legreffier-cli:** polished UX — hero banner, disclaimer, summary, delayed fallback URLs ([97237b1](https://github.com/getlarge/themoltnet/commit/97237b18de141305c7250a15504645264936f7a3))
* **legreffier-cli:** project-scoped state file helpers, tsconfig split, precommit check ([50a6e7a](https://github.com/getlarge/themoltnet/commit/50a6e7a662e050a8a0eedabea3ef09a2559c9f29))
* **legreffier-cli:** robust resume, name availability, installation URL display ([7744904](https://github.com/getlarge/themoltnet/commit/7744904529ddb205d61df8f3c86068f51fece5f4))
* **legreffier-cli:** scaffold Ink CLI package with visual smoke test ([7c4fbcb](https://github.com/getlarge/themoltnet/commit/7c4fbcb42ddf7901e9c44a1e66111ef888e29bbd))
* **legreffier-cli:** show API URL and manifest form URL in terminal ([1ac4830](https://github.com/getlarge/themoltnet/commit/1ac483012f8628ac404804a1636948b96634f675))
* **legreffier-cli:** skills downloader and settings.local.json writer with tests ([ca989ec](https://github.com/getlarge/themoltnet/commit/ca989ec3bac33b65c1b334d561699baead89e54d))
* **legreffier-cli:** validate agent name, pin skill URL, per-agent skill dirs ([d7e30cf](https://github.com/getlarge/themoltnet/commit/d7e30cfd2fc35018e0c321e09014381e919356c7))


### Bug Fixes

* **design-system:** align CliHero halo border with wordmark + add CLI README ([26b307b](https://github.com/getlarge/themoltnet/commit/26b307b0c58b69f51d954ca89f8e085472b64756)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** address PR review findings ([382c301](https://github.com/getlarge/themoltnet/commit/382c3018cba8728d6c3230970c33aa96609a003b))
* **legreffier-cli:** auto-enable project MCP servers in settings.local.json ([f685c97](https://github.com/getlarge/themoltnet/commit/f685c97163c62e1023b76d3a6062dc0446e0f504)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** centralize all config in .moltnet/ directory ([c4ced24](https://github.com/getlarge/themoltnet/commit/c4ced24318b26336ef1d4afa8c0d0449eb6676b8))
* **legreffier-cli:** drop accountable-commit skill — single legreffier skill only ([eb61d61](https://github.com/getlarge/themoltnet/commit/eb61d61b15b9b5bf3351333694d6b29caa5fe632))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **legreffier-cli:** fix lookupBotUser test timeout with retry params ([2848ec7](https://github.com/getlarge/themoltnet/commit/2848ec7a8476301cb30b444c3e3b22c91e75dc24)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** merge into existing settings.local.json instead of overwriting ([c3fe3df](https://github.com/getlarge/themoltnet/commit/c3fe3df85546ee12b048d1b5f02422d4b037776c)), closes [#323](https://github.com/getlarge/themoltnet/issues/323)
* **legreffier-cli:** narrow files to dist/index.js only ([39636b6](https://github.com/getlarge/themoltnet/commit/39636b6d88cb8f84fae6ac4adbfc2a10c6a91d10))
* **legreffier-cli:** proper error message extraction for ProblemDetails ([46762fe](https://github.com/getlarge/themoltnet/commit/46762fe986ed312345484944b0e6ab67d2273a8a))
* **legreffier-cli:** retry bot user lookup and isolate state per agent ([4f1a3a3](https://github.com/getlarge/themoltnet/commit/4f1a3a3560e56de8b220957555b03d38c2c0e689))
* **legreffier-cli:** write gitconfig file and git section in moltnet.json ([32046e2](https://github.com/getlarge/themoltnet/commit/32046e2be9881a2d7b8f72f87ddba2d53454dbc1))
