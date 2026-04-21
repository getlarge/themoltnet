# Changelog

## [0.32.3](https://github.com/getlarge/themoltnet/compare/legreffier-v0.32.2...legreffier-v0.32.3) (2026-04-21)


### Bug Fixes

* **legreffier-cli:** sync buildGhTokenRule with $MOLTNET_CLI convention ([d93aa15](https://github.com/getlarge/themoltnet/commit/d93aa15b39ef1738cec700bdc5ae5cdd226aec39))
* **legreffier:** hardcode moltnet CLI in gh-token rule, forbid $MOLTNET_CLI ([6131606](https://github.com/getlarge/themoltnet/commit/6131606e81f8058c15897c35cfb9df0b8a71b8b2))
* **legreffier:** hardcode moltnet CLI in gh-token rule, forbid $MOLTNET_CLI ([7e0e1b5](https://github.com/getlarge/themoltnet/commit/7e0e1b5d1d069cb69ad272e1156ab98d0cb3fc96))
* **skills:** address PR review — MOLTNET_CLI fallback, arch detection, host/guest consistency ([3801502](https://github.com/getlarge/themoltnet/commit/38015022fd8928add81761793dccfcefdc9106b6))

## [0.32.2](https://github.com/getlarge/themoltnet/compare/legreffier-v0.32.1...legreffier-v0.32.2) (2026-04-17)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/github-agent bumped to 0.23.2
    * @themoltnet/sdk bumped to 0.91.0

## [0.32.1](https://github.com/getlarge/themoltnet/compare/legreffier-v0.32.0...legreffier-v0.32.1) (2026-04-13)


### Bug Fixes

* address review feedback — stale PEM path, dynamic imports, regex ([4506627](https://github.com/getlarge/themoltnet/commit/4506627a4f74fea4305d26495b54ad70e6fcba4f))
* auto-resolve GitHub App installation_id during port ([de5c38b](https://github.com/getlarge/themoltnet/commit/de5c38b0a3b571a403bf249866b3c00159c69008))
* auto-resolve GitHub App installation_id during port ([08e3c3e](https://github.com/getlarge/themoltnet/commit/08e3c3e94d04cf6b8f1170fc5b1458bdbfa2eca0)), closes [#793](https://github.com/getlarge/themoltnet/issues/793)

## [0.32.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.31.0...legreffier-v0.32.0) (2026-04-13)


### Features

* **cli,skill:** add env-driven commit authorship modes ([5e5cb11](https://github.com/getlarge/themoltnet/commit/5e5cb11f5b9509f2fc4eb3be349a9a478ec58614))
* **cli,skill:** add env-driven commit authorship modes ([#786](https://github.com/getlarge/themoltnet/issues/786)) ([61b643e](https://github.com/getlarge/themoltnet/commit/61b643e53e9c42fd4a5e9531ed80fe201dd09a8b))


### Bug Fixes

* **cli,skill:** address PR [#792](https://github.com/getlarge/themoltnet/issues/792) review feedback ([4c4970c](https://github.com/getlarge/themoltnet/commit/4c4970ce6d3de622c27aee255ed06fc28e0f5f63))
* **legreffier-cli:** replace runtime figlet with pre-rendered wordmark ([5a970a6](https://github.com/getlarge/themoltnet/commit/5a970a6c847e615a1c24d5caebcbebd1f8298b1a))
* **legreffier-cli:** replace runtime figlet with pre-rendered wordmark ([13953f9](https://github.com/getlarge/themoltnet/commit/13953f911570be062c50d1d4e9bb7f6e0da7594e)), closes [#788](https://github.com/getlarge/themoltnet/issues/788)

## [0.31.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.30.0...legreffier-v0.31.0) (2026-04-11)


### Features

* onboarding improvements (CLI help, port hints, external ref, temporal signals) ([cf76bcb](https://github.com/getlarge/themoltnet/commit/cf76bcb2e66ff58ee8009fb0d652cd16cbeb48c7))


### Bug Fixes

* **legreffier-cli:** address PR [#760](https://github.com/getlarge/themoltnet/issues/760) review issues ([24858c2](https://github.com/getlarge/themoltnet/commit/24858c285f93dd5feb0cea68eccb96296f64c07b))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.29.1...legreffier-v0.30.0) (2026-04-11)


### Features

* **legreffier:** wire onboarding skill into download list and add discoverability ([5fdaacc](https://github.com/getlarge/themoltnet/commit/5fdaacc6a1d84c20cdd08d93571a267cb3294ba3)), closes [#737](https://github.com/getlarge/themoltnet/issues/737)

## [0.29.1](https://github.com/getlarge/themoltnet/compare/legreffier-v0.29.0...legreffier-v0.29.1) (2026-04-09)


### Bug Fixes

* **legreffier-cli:** address Claude review on [#726](https://github.com/getlarge/themoltnet/issues/726) ([cc673b0](https://github.com/getlarge/themoltnet/commit/cc673b083e047f07adee286bfa45ee168070ab47))
* **legreffier-cli:** address Copilot review on [#726](https://github.com/getlarge/themoltnet/issues/726) ([5f0cac0](https://github.com/getlarge/themoltnet/commit/5f0cac0d598ea21ff33621abd515cac55ddbbc22))
* **legreffier-cli:** write signingkey under [user], not [gpg "ssh"] ([b35dd45](https://github.com/getlarge/themoltnet/commit/b35dd456613db033948d31fa4b290067ccc9e9ae))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.28.1...legreffier-v0.29.0) (2026-04-09)


### Features

* **legreffier-cli:** add `port` subcommand to reuse agent identity across repos ([7bc60df](https://github.com/getlarge/themoltnet/commit/7bc60dfd1671f91561d25b3dc751c98c00db4749))
* **legreffier-cli:** add portCopy phase for port command ([65a9394](https://github.com/getlarge/themoltnet/commit/65a9394f848cca2e0dbb8434482da358a3f8eb94))
* **legreffier-cli:** add portDiary phase for port command ([d83e872](https://github.com/getlarge/themoltnet/commit/d83e8729b9f823d868eabc1818dc4ace1f35adba))
* **legreffier-cli:** add portRewrite phase for port command ([dd2d9e2](https://github.com/getlarge/themoltnet/commit/dd2d9e29f7b14490e25172dc74631ff77f5e334d))
* **legreffier-cli:** add portValidate phase for port command ([d61e8f3](https://github.com/getlarge/themoltnet/commit/d61e8f3bd314c839b19dac4a589778ed01ded3ed))
* **legreffier-cli:** add portVerifyInstallation phase (warning-only) ([841a295](https://github.com/getlarge/themoltnet/commit/841a295b8a0b08db13cfe2385325e07af5d3633a))
* **legreffier-cli:** wire PortApp + `port` subcommand (P6) ([179ebae](https://github.com/getlarge/themoltnet/commit/179ebae98c88abf679058710801a46d0a0e67580))
* **legreffier:** support GitHub org account in manifest flow ([fdb9621](https://github.com/getlarge/themoltnet/commit/fdb9621a90d5fa4fab1cde1862d33d19695990e8))
* **legreffier:** support GitHub org account in onboarding ([d2194d5](https://github.com/getlarge/themoltnet/commit/d2194d555e14aa119b08a3c3d73300e438199a63))


### Bug Fixes

* **legreffier-cli:** address PR [#722](https://github.com/getlarge/themoltnet/issues/722) review feedback ([a705063](https://github.com/getlarge/themoltnet/commit/a7050632a1bd726e04aad4757fef66f596979b6b))
* **legreffier-cli:** fix typecheck in api.test.ts, add gh auth to skill ([5f5df0f](https://github.com/getlarge/themoltnet/commit/5f5df0fffdf0d800ac5f9b8d49b92b380ccd9115))
* **legreffier-cli:** propagate numeric GitHub App ID through init flow ([70e9182](https://github.com/getlarge/themoltnet/commit/70e9182c3650a0a2ba14f32868f2482b926fb9de))
* **rest-api:** escape HTML in manifest relay page, improve org tests ([753246e](https://github.com/getlarge/themoltnet/commit/753246e344e1632d12195ee511db7d2655fb9b1f))

## [0.28.1](https://github.com/getlarge/themoltnet/compare/legreffier-v0.28.0...legreffier-v0.28.1) (2026-04-02)


### Bug Fixes

* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.27.0...legreffier-v0.28.0) (2026-03-31)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** download scan + explore skills alongside main legreffier skill ([50930f9](https://github.com/getlarge/themoltnet/commit/50930f93c44d98bad3f90efb1ac0e0ed89aa761a))
* **cli:** session launcher — moltnet start, use, env check ([7e564f5](https://github.com/getlarge/themoltnet/commit/7e564f5ba21f3d20c9218ecf3098baf9d40079f1))
* **skills:** add legreffier-explore diary discovery skill ([936bc58](https://github.com/getlarge/themoltnet/commit/936bc587361e7f3819daa06245b368fb1f406190))


### Bug Fixes

* address Copilot review feedback ([8ecc587](https://github.com/getlarge/themoltnet/commit/8ecc587bff3ea840d4ccaee284a70305474cd884))
* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* follow up legreffier skill bundle review comments ([df19ad9](https://github.com/getlarge/themoltnet/commit/df19ad9c709913ebd7b77e0b3a32c1949ab3fbb8))
* **legreffier-cli:** ship scan skill companion docs ([d1e3860](https://github.com/getlarge/themoltnet/commit/d1e38602362c014e231d241103c96429fd33f8a7))
* **legreffier-explore:** ship adjacent template bundle ([7e4f722](https://github.com/getlarge/themoltnet/commit/7e4f7227c4066fa68ff388b1cf2ed445ccfded0a))
* **sdk,legreffier-cli:** include API error detail in user-facing messages ([5c34095](https://github.com/getlarge/themoltnet/commit/5c340953b41dc073d3e4bee9f34c314210e88dc9))
* update check:pack script paths after scripts/ → tools/src/ move ([41f010b](https://github.com/getlarge/themoltnet/commit/41f010b808aeee4f14d72b76f15e15f921ff79ec))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.26.2...legreffier-v0.27.0) (2026-03-31)


### Features

* **cli:** session launcher — moltnet start, use, env check ([7e564f5](https://github.com/getlarge/themoltnet/commit/7e564f5ba21f3d20c9218ecf3098baf9d40079f1))

## [0.26.2](https://github.com/getlarge/themoltnet/compare/legreffier-v0.26.1...legreffier-v0.26.2) (2026-03-29)


### Bug Fixes

* address Copilot review feedback ([8ecc587](https://github.com/getlarge/themoltnet/commit/8ecc587bff3ea840d4ccaee284a70305474cd884))
* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* **sdk,legreffier-cli:** include API error detail in user-facing messages ([5c34095](https://github.com/getlarge/themoltnet/commit/5c340953b41dc073d3e4bee9f34c314210e88dc9))

## [0.26.1](https://github.com/getlarge/themoltnet/compare/legreffier-v0.26.0...legreffier-v0.26.1) (2026-03-27)


### Bug Fixes

* follow up legreffier skill bundle review comments ([df19ad9](https://github.com/getlarge/themoltnet/commit/df19ad9c709913ebd7b77e0b3a32c1949ab3fbb8))
* **legreffier-cli:** ship scan skill companion docs ([d1e3860](https://github.com/getlarge/themoltnet/commit/d1e38602362c014e231d241103c96429fd33f8a7))
* **legreffier-explore:** ship adjacent template bundle ([7e4f722](https://github.com/getlarge/themoltnet/commit/7e4f7227c4066fa68ff388b1cf2ed445ccfded0a))

## [0.26.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.25.0...legreffier-v0.26.0) (2026-03-23)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** download scan + explore skills alongside main legreffier skill ([50930f9](https://github.com/getlarge/themoltnet/commit/50930f93c44d98bad3f90efb1ac0e0ed89aa761a))
* **design-system:** make publishable as @themoltnet/design-system ([c242d26](https://github.com/getlarge/themoltnet/commit/c242d26f752c0deea4410c8b96b12765b759e9ef))
* **design-system:** make publishable as @themoltnet/design-system ([fd4275e](https://github.com/getlarge/themoltnet/commit/fd4275edf669057bd39d50b9d1c1de5eabba137e))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier:** Codex Starlark rules + GH auth in skill ([dc05d7d](https://github.com/getlarge/themoltnet/commit/dc05d7d1c8a0dbd2798ad4b91512f7e277524475))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **skills:** add legreffier-explore diary discovery skill ([936bc58](https://github.com/getlarge/themoltnet/commit/936bc587361e7f3819daa06245b368fb1f406190))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.24.0...legreffier-v0.25.0) (2026-03-23)


### Features

* **cli:** download scan + explore skills alongside main legreffier skill ([50930f9](https://github.com/getlarge/themoltnet/commit/50930f93c44d98bad3f90efb1ac0e0ed89aa761a))
* **skills:** add legreffier-explore diary discovery skill ([936bc58](https://github.com/getlarge/themoltnet/commit/936bc587361e7f3819daa06245b368fb1f406190))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.23.0...legreffier-v0.24.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
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

## [0.23.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.22.0...legreffier-v0.23.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
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

## [0.22.0](https://github.com/getlarge/themoltnet/compare/legreffier-v0.21.0...legreffier-v0.22.0) (2026-03-17)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))

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
