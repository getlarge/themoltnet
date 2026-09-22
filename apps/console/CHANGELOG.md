# Changelog

## [0.21.0](https://github.com/getlarge/themoltnet/compare/console-v0.20.0...console-v0.21.0) (2026-09-22)


### Features

* **console:** render task detail through the shared view ([e2fdf7a](https://github.com/getlarge/themoltnet/commit/e2fdf7a20cdd4eeff9da525ea60a70f89b809d3a))
* **design-system:** promote Disclosure and VisuallyHidden; task-ui follow-ups ([d44d2d6](https://github.com/getlarge/themoltnet/commit/d44d2d6c17131e1bccca262c4b3916dabe696328))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.4.0
  * devDependencies
    * @themoltnet/sdk bumped to 0.145.0

## [0.20.0](https://github.com/getlarge/themoltnet/compare/console-v0.19.0...console-v0.20.0) (2026-09-21)


### Features

* **console:** move local runtime control to Desktop ([1f934aa](https://github.com/getlarge/themoltnet/commit/1f934aae8b837c88b0d052e0cdfd7a2b84828000))
* **console:** move local runtime control to Desktop ([9f3c644](https://github.com/getlarge/themoltnet/commit/9f3c644391a1e9b40d6f36c2943a26b5eccd162b))


### Bug Fixes

* **console:** finish local runtime cutover cleanup ([20184df](https://github.com/getlarge/themoltnet/commit/20184df590d356908a6ccb7a47cd37d8ae5b37ff))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/console-v0.18.0...console-v0.19.0) (2026-09-20)


### Features

* **agent-desktop:** advanced connection settings and Server view refinement ([e0625e8](https://github.com/getlarge/themoltnet/commit/e0625e83e9f7c48d7216a134b1e607ef295d928f))
* **agent-desktop:** configure providers, models and subscriptions ([2777ed6](https://github.com/getlarge/themoltnet/commit/2777ed655225bbbcc1fcab64e9294099f47b56bc))
* **agent-server:** PKCE enrollment, renewal and Console local control ([38c8e2e](https://github.com/getlarge/themoltnet/commit/38c8e2e0e5cbb84c33f9296cf07019dd2a051f6f))
* **agent-server:** use PKCE for provisioning and local control ([675059b](https://github.com/getlarge/themoltnet/commit/675059b5e2007ce7a7c188497cdd52bd6bb97a51))
* **console:** manage shared team projects ([1ecfbd3](https://github.com/getlarge/themoltnet/commit/1ecfbd307815d6554771efa5051103ec92e6f93a))


### Bug Fixes

* **agent-daemon:** resolve optional activation endpoint for enrollment ([26f9c6f](https://github.com/getlarge/themoltnet/commit/26f9c6f923fd38d02d029e46c958fa1c6c2efb1c))
* **console:** address project administration review ([3a2cac9](https://github.com/getlarge/themoltnet/commit/3a2cac9df6edf11e3a71e9974825e17586a7e128))
* **console:** finish project feedback and accessibility fixes ([2b6682e](https://github.com/getlarge/themoltnet/commit/2b6682e67ed95a7b882e3a45568483a50aeb71dd))
* **console:** navigate project catalogue pages ([fa1b60d](https://github.com/getlarge/themoltnet/commit/fa1b60d0ba7748f258cc4d7c47e03524bec1bc3c))
* **console:** preserve existing endpoints when choosing provider presets ([fd95a5a](https://github.com/getlarge/themoltnet/commit/fd95a5abd7024d4a3d1249b0c4c68ef9c9af0719))
* **console:** resolve enrolled run credentials on Agent Server ([b181187](https://github.com/getlarge/themoltnet/commit/b181187da3e4ee9228dfd0710431c78d4da64d3e))
* **console:** reuse local-control tokens across navigation ([095471d](https://github.com/getlarge/themoltnet/commit/095471d2725e502fd6fe994e4790bebfbd4cd0ee))
* **console:** scope project actions and style unavailable controls ([9945b98](https://github.com/getlarge/themoltnet/commit/9945b98b87fee8eeebc5a287af4781dcccc96ebe))
* **console:** use project team headers consistently ([ffc6afd](https://github.com/getlarge/themoltnet/commit/ffc6afd6fc1ebc0d64bb9f4b4aa2588fa13a36a4))
* **desktop:** align Ollama presets with provider storage contract ([80c7b2e](https://github.com/getlarge/themoltnet/commit/80c7b2e1a0b11cb68ab46efb8924f453fb75acce))
* **desktop:** cancel abandoned native approvals ([dfebd27](https://github.com/getlarge/themoltnet/commit/dfebd27558b5e648019f1ad64d7365d734f9c155))
* **oauth:** bind enrollment approvals to native identity proof ([912964f](https://github.com/getlarge/themoltnet/commit/912964ff8e6ec8df93cb30f2cc1e5a19378fbe75))
* **oauth:** simplify grant validation and complete review coverage ([aa0a5db](https://github.com/getlarge/themoltnet/commit/aa0a5db176e66961bd2e2ec20e5f899a72bc15b4))
* **pkce:** align native fixtures and browser test boundaries ([40ff264](https://github.com/getlarge/themoltnet/commit/40ff2642085276443681c000e050c776c10c5bb7))
* **pkce:** clarify operator consent and prove revoked-key renewal ([fa9da02](https://github.com/getlarge/themoltnet/commit/fa9da027917576d1623a6872331a033314908752))
* **providers:** preserve shared form actions and controller contracts ([02baae6](https://github.com/getlarge/themoltnet/commit/02baae6e7632bcf6142674f6936762d38a64cfb6))
* **release:** configure Fly operator OAuth clients ([0318149](https://github.com/getlarge/themoltnet/commit/031814932d489de89dd922ce7eb1101d03df3f55))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.3.0
  * devDependencies
    * @moltnet/database bumped to 0.15.0
    * @themoltnet/sdk bumped to 0.144.0

## [0.18.0](https://github.com/getlarge/themoltnet/compare/console-v0.17.1...console-v0.18.0) (2026-09-18)


### Features

* **auth:** separate invitation redemption from team management ([9714a6c](https://github.com/getlarge/themoltnet/commit/9714a6cfec79903092dd9bd41df48bd219dc6139))
* **teams:** redeem single-use invites through DBOS ([b973116](https://github.com/getlarge/themoltnet/commit/b973116b394deef6eac151f66e7238937ca0dbf6))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.14.0
    * @themoltnet/sdk bumped to 0.143.0

## [0.17.1](https://github.com/getlarge/themoltnet/compare/console-v0.17.0...console-v0.17.1) (2026-09-18)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.13.0

## [0.17.0](https://github.com/getlarge/themoltnet/compare/console-v0.16.2...console-v0.17.0) (2026-09-16)


### Features

* **agent-daemon:** detect model input modalities during discovery ([1005786](https://github.com/getlarge/themoltnet/commit/10057865744bff15a0617f00ccab98545ba19868))
* **agent-daemon:** detect model input modalities during discovery ([fce4288](https://github.com/getlarge/themoltnet/commit/fce42888808e10bb6f5a5f8c0834a0c2bb80ef33)), closes [#2312](https://github.com/getlarge/themoltnet/issues/2312)
* **pi-runtime:** declare model input modalities so vision models receive images ([d9a44f3](https://github.com/getlarge/themoltnet/commit/d9a44f3a3b92d199293a98ba750457cc77e10fab))
* **release:** publish Agent desktop downloads ([0a9c948](https://github.com/getlarge/themoltnet/commit/0a9c9485e7d3dcbea78bff1218437f1625a7dcde))
* **release:** publish MoltNet Agent desktop downloads ([7668228](https://github.com/getlarge/themoltnet/commit/7668228c4507ab72c8149879c707135fb326bfaa))


### Bug Fixes

* **agent-daemon:** address discovery modality review findings ([cf77a92](https://github.com/getlarge/themoltnet/commit/cf77a92e6d845f98f06d9f25c63b3059099fb9e7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.2.0

## [0.16.2](https://github.com/getlarge/themoltnet/compare/console-v0.16.1...console-v0.16.2) (2026-09-15)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.12.0

## [0.16.1](https://github.com/getlarge/themoltnet/compare/console-v0.16.0...console-v0.16.1) (2026-09-15)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.11.0

## [0.16.0](https://github.com/getlarge/themoltnet/compare/console-v0.15.3...console-v0.16.0) (2026-09-15)


### Features

* **console:** create the executor invite code from the Local Runtime page ([6b8098c](https://github.com/getlarge/themoltnet/commit/6b8098c01144a629082c370282cd49a9404cd88a))
* **console:** show onboarding as the three journey steps linked to the docs ([164bc98](https://github.com/getlarge/themoltnet/commit/164bc9824ba1606d9ce53253f8352c7bfbca2e99))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.142.0

## [0.15.3](https://github.com/getlarge/themoltnet/compare/console-v0.15.2...console-v0.15.3) (2026-09-14)


### Bug Fixes

* **packs:** let the server assign the unpin deadline from PACK_GC_COMPILE_TTL_DAYS ([0394030](https://github.com/getlarge/themoltnet/commit/03940307bb35b1c7f529900e09f474187b822248))

## [0.15.2](https://github.com/getlarge/themoltnet/compare/console-v0.15.1...console-v0.15.2) (2026-09-13)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.10.2

## [0.15.1](https://github.com/getlarge/themoltnet/compare/console-v0.15.0...console-v0.15.1) (2026-09-13)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.10.1

## [0.15.0](https://github.com/getlarge/themoltnet/compare/console-v0.14.0...console-v0.15.0) (2026-09-12)


### Features

* add role-aware agent keys and agent aliases ([f16f7cf](https://github.com/getlarge/themoltnet/commit/f16f7cf2a985de29959717081412c44763a5eb82))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.10.0

## [0.14.0](https://github.com/getlarge/themoltnet/compare/console-v0.13.2...console-v0.14.0) (2026-09-11)


### Features

* **auth:** split task write and management authority ([a8e63ca](https://github.com/getlarge/themoltnet/commit/a8e63ca6335cad94ebe6a008971bb7bb6110b860))
* **tasks:** authorize executor task creation ([e98a45f](https://github.com/getlarge/themoltnet/commit/e98a45f0b1520da159fafbe30856d8e97044aa5c))


### Bug Fixes

* **agent-server:** surface agent key rejection guidance ([ee939b9](https://github.com/getlarge/themoltnet/commit/ee939b9a3f4425cecdd373ccf6c7ec30e23288f1))
* **agent-server:** surface agent key rejection guidance ([0d07b19](https://github.com/getlarge/themoltnet/commit/0d07b1907ff53cc91d62fdd0e8765237a183fdd2))

## [0.13.2](https://github.com/getlarge/themoltnet/compare/console-v0.13.1...console-v0.13.2) (2026-09-11)


### Bug Fixes

* **agent-daemon:** use central identities for local runs ([78f061d](https://github.com/getlarge/themoltnet/commit/78f061d4d02c4e5ab4ad5fe62bd410863e239508))
* **agent-daemon:** use central identities for local runs ([daefb51](https://github.com/getlarge/themoltnet/commit/daefb5158f67a12cbf81a042453a1b242956e5ec))

## [0.13.1](https://github.com/getlarge/themoltnet/compare/console-v0.13.0...console-v0.13.1) (2026-09-11)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.141.1

## [0.13.0](https://github.com/getlarge/themoltnet/compare/console-v0.12.1...console-v0.13.0) (2026-09-09)


### Features

* **cli:** anchor credentials to durable agent subjects ([29f062e](https://github.com/getlarge/themoltnet/commit/29f062ed50c6099fedb8d1d2be0345b9505bd4d5))
* decouple MoltNet principals from Ory Kratos identity IDs ([395823d](https://github.com/getlarge/themoltnet/commit/395823da4550fe66af2fc189b1bf3ef4fa6a464b))


### Bug Fixes

* **console,landing:** address the durable subject in the UI surfaces ([250d353](https://github.com/getlarge/themoltnet/commit/250d3538826d495df57cd9a726fc34bdadc3af90))
* **console:** validate canonical agent subjects ([350d7d5](https://github.com/getlarge/themoltnet/commit/350d7d5577f1d5a6b24ceb295d05317ffe8dd9fe))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.9.0
    * @themoltnet/sdk bumped to 0.141.0

## [0.12.1](https://github.com/getlarge/themoltnet/compare/console-v0.12.0...console-v0.12.1) (2026-09-08)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.140.2

## [0.12.0](https://github.com/getlarge/themoltnet/compare/console-v0.11.0...console-v0.12.0) (2026-09-05)


### Features

* **console:** show which scopes the daemon requires ([585fc37](https://github.com/getlarge/themoltnet/commit/585fc37840b4312d3b5db9f5a2801b65dc4f027e))
* **credentials:** add crypto:sign to the canonical daemon grant ([a540bac](https://github.com/getlarge/themoltnet/commit/a540bac32c6f9fc3edfc35b3ed1908d64143ae1c))


### Bug Fixes

* **sdk:** keep request headers on auth retry; warn when the daemon cannot sign ([5b28b4a](https://github.com/getlarge/themoltnet/commit/5b28b4a0505c17ce912c92dfacd68bb4dd8819db))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.140.1

## [0.11.0](https://github.com/getlarge/themoltnet/compare/console-v0.10.1...console-v0.11.0) (2026-09-04)


### Features

* **runtime:** manage local providers ([803d949](https://github.com/getlarge/themoltnet/commit/803d9497d180ec84c865850aebd99f2f070ad8fd))
* **runtime:** reconcile global model catalog ([5fc9d3e](https://github.com/getlarge/themoltnet/commit/5fc9d3ec0f9d30a548880876e991b82d629bc315))
* **runtime:** reconcile version-pinned provider catalog ([4be927b](https://github.com/getlarge/themoltnet/commit/4be927bda4e29b99b45786a9860ab9b4d27d5638))


### Bug Fixes

* **agent-daemon:** preserve enrollment roles and provider keys ([5cbfbeb](https://github.com/getlarge/themoltnet/commit/5cbfbebddeff78efb56e13cd8b326b2dd1977761))
* **agent-daemon:** support Safari loopback HTTPS ([b650d9a](https://github.com/getlarge/themoltnet/commit/b650d9a302ed35961de5bec56f0cf65bc8c4f676))
* **agent-daemon:** support Safari loopback HTTPS ([76e0726](https://github.com/getlarge/themoltnet/commit/76e07265d6e9ff72a26b34719cd4aa692a4ab2ad))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.8.0

## [0.10.1](https://github.com/getlarge/themoltnet/compare/console-v0.10.0...console-v0.10.1) (2026-09-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.1.1

## [0.10.0](https://github.com/getlarge/themoltnet/compare/console-v0.9.1...console-v0.10.0) (2026-09-03)


### Features

* **agent-daemon:** establish the Agent Server API ([a169bee](https://github.com/getlarge/themoltnet/commit/a169beeedd34a88dcaf5861ebefb08903bc84d3c))
* **agent-daemon:** establish the Agent Server API ([8af2474](https://github.com/getlarge/themoltnet/commit/8af24743a33d80d0ca7fdc84c0c5cf50c4e80494))


### Bug Fixes

* **console:** guide operators to the Agent binary ([3d852e7](https://github.com/getlarge/themoltnet/commit/3d852e7b9e514ed0a3e91552d016def3925dc40c))
* **console:** support private-network loopback access ([2a21f5f](https://github.com/getlarge/themoltnet/commit/2a21f5ff02f201a17f4d65e1b3718fccb8b4675d))

## [0.9.1](https://github.com/getlarge/themoltnet/compare/console-v0.9.0...console-v0.9.1) (2026-09-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.1.0

## [0.9.0](https://github.com/getlarge/themoltnet/compare/console-v0.8.3...console-v0.9.0) (2026-09-02)


### Features

* **console:** escalate serve-created agents to team executor ([6b841c8](https://github.com/getlarge/themoltnet/commit/6b841c87d1a136daaf6c5c95b70a24263af4ac15))
* **serve:** broker subscription OAuth logins from the console ([7a09011](https://github.com/getlarge/themoltnet/commit/7a09011187894b5c8e51b295cecf076e4178d6c7))
* **serve:** provider model discovery with console presets ([4bcc034](https://github.com/getlarge/themoltnet/commit/4bcc034975c2364d218b22268d84c1e7f15b38ef)), closes [#2064](https://github.com/getlarge/themoltnet/issues/2064)
* **serve:** subscription OAuth brokering from the console ([7697968](https://github.com/getlarge/themoltnet/commit/76979682a0bc181ab9ecbfbb4d7bfeb7d6457352))


### Bug Fixes

* **agent-daemon:** harden serve provider flows ([c97df47](https://github.com/getlarge/themoltnet/commit/c97df47ec3cb08214c33055f5788a6c73806613e))
* **console:** merge runtime-page hardening into the rebased task-card layout ([5caef65](https://github.com/getlarge/themoltnet/commit/5caef655112356235c415f581eee8e84aa4ebce5))
* **serve:** bind model discovery to stored providers ([bcffa48](https://github.com/getlarge/themoltnet/commit/bcffa48d3ca65f8ff7db37c42615a267b3a883bc))
* **serve:** cancellable logins, surfaced errors, profile picker + tests ([71e5f95](https://github.com/getlarge/themoltnet/commit/71e5f9514ca08f84acb2c93b7032c9f02eaf5c25))
* **serve:** codex device-code login and team-binding guardrails ([5dde4fe](https://github.com/getlarge/themoltnet/commit/5dde4fe549426d8ba60c307a8fb09594bd36befa))
* **serve:** require an enrollment token for managed agents ([bb8e2a7](https://github.com/getlarge/themoltnet/commit/bb8e2a749ef2de86020588c86104362369181f9f))

## [0.8.3](https://github.com/getlarge/themoltnet/compare/console-v0.8.2...console-v0.8.3) (2026-09-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.140.0

## [0.8.2](https://github.com/getlarge/themoltnet/compare/console-v0.8.1...console-v0.8.2) (2026-09-01)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.139.0

## [0.8.1](https://github.com/getlarge/themoltnet/compare/console-v0.8.0...console-v0.8.1) (2026-08-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.0.0
  * devDependencies
    * @themoltnet/sdk bumped to 0.138.0

## [0.8.0](https://github.com/getlarge/themoltnet/compare/console-v0.7.0...console-v0.8.0) (2026-08-25)


### Features

* add executor team role ([e02be38](https://github.com/getlarge/themoltnet/commit/e02be38d318236d468af2c2ab3e3b677939b349f))
* **teams:** add executor controls to console and MCP ([23f410d](https://github.com/getlarge/themoltnet/commit/23f410d45f2b8464571bbbfede4f95a6e91e0eaf))


### Bug Fixes

* **teams:** address executor rollout review ([23e12bf](https://github.com/getlarge/themoltnet/commit/23e12bf1071a8b247f30797a3a5013e29ea60ae3))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.7.0
    * @themoltnet/sdk bumped to 0.137.0

## [0.7.0](https://github.com/getlarge/themoltnet/compare/console-v0.6.1...console-v0.7.0) (2026-08-22)


### Features

* add identity-scoped agent-key lifecycle ([babb76b](https://github.com/getlarge/themoltnet/commit/babb76b12800646e11340e354eaa12f284fb022e))
* **agent-keys:** expose binding-aware clients ([4f71142](https://github.com/getlarge/themoltnet/commit/4f711427981a243fe8f002778d74bc8ba75fe1d0))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.136.0

## [0.6.1](https://github.com/getlarge/themoltnet/compare/console-v0.6.0...console-v0.6.1) (2026-08-19)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.6.0
    * @themoltnet/sdk bumped to 0.135.0

## [0.6.0](https://github.com/getlarge/themoltnet/compare/console-v0.5.1...console-v0.6.0) (2026-08-17)


### Features

* **clients:** expose explicit task grants ([424c65b](https://github.com/getlarge/themoltnet/commit/424c65bb978d5b45c32027bd6a5dc8c6feadcf02))
* share the provenance explorer across apps ([7f89086](https://github.com/getlarge/themoltnet/commit/7f89086bc7162615f0099592491c2d893d7ed111))
* share the provenance explorer across apps ([a90b6d9](https://github.com/getlarge/themoltnet/commit/a90b6d9e35522749928c63de3aae8ef358a5716d))
* **tasks:** add Keto-backed task ownership ([5a86e87](https://github.com/getlarge/themoltnet/commit/5a86e87db9cac486316ab1e0eebac93425d248c1))


### Bug Fixes

* **provenance:** clarify graph trust boundaries ([53b9c82](https://github.com/getlarge/themoltnet/commit/53b9c828270b9a8b5057eb03dc43f6d103b083a3))


### Performance Improvements

* **console:** lazy-load task grants ([c428f89](https://github.com/getlarge/themoltnet/commit/c428f89c3e5076a04b07faa1fd2729c79a44f77b))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.5.0
    * @themoltnet/sdk bumped to 0.134.0

## [0.5.1](https://github.com/getlarge/themoltnet/compare/console-v0.5.0...console-v0.5.1) (2026-08-15)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.4.0

## [0.5.0](https://github.com/getlarge/themoltnet/compare/console-v0.4.0...console-v0.5.0) (2026-08-14)


### Features

* **console:** add linear lineage chain ([93d181f](https://github.com/getlarge/themoltnet/commit/93d181ff699830d0755c214d9b229c12ddb0f18d))
* **console:** add pack lineage panel with all states ([d1d4d6a](https://github.com/getlarge/themoltnet/commit/d1d4d6a8c9b82d5f2e405b2562113cdd4acec8dc))
* **console:** pack lineage panel ([bbb2a15](https://github.com/getlarge/themoltnet/commit/bbb2a150b7a8f1975f9683740593af2264218884))
* **console:** reduce provenance graph to its lineage spine ([7b2c2bb](https://github.com/getlarge/themoltnet/commit/7b2c2bb8afe97dc91b3b93ca58f09ac1bd40442c))
* **console:** show lineage on the pack detail page ([09f7bac](https://github.com/getlarge/themoltnet/commit/09f7bac91ccd1d4e44d50c9602085e0d6195e5b9))


### Bug Fixes

* **console:** real hrefs and an honest root label in lineage ([e027d92](https://github.com/getlarge/themoltnet/commit/e027d926d154fe90b0c13fc73b8c7cd1ef8e24cc))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/console-v0.3.1...console-v0.4.0) (2026-08-14)


### Features

* **console:** pack catalog, decay badge and pin control ([4f75121](https://github.com/getlarge/themoltnet/commit/4f75121e4f8435a5b4accee705e3d59046a97d8b))
* **console:** register /packs/:id with pack detail page ([121131c](https://github.com/getlarge/themoltnet/commit/121131cb0fe7a54aa9c12ba967cfb6a96d3d2b54))
* **console:** register /packs/:id with pack detail page ([6481b09](https://github.com/getlarge/themoltnet/commit/6481b097e31ae138770482d813fbf4ae49bc76f8))


### Bug Fixes

* **console:** address deep review of pack catalog ([50d2294](https://github.com/getlarge/themoltnet/commit/50d22945e17524d9f70d1bc1c5136b0289c3dca1))
* **console:** address deep review of pack detail page ([8b10ed8](https://github.com/getlarge/themoltnet/commit/8b10ed8fa7f83a218144b09f46f6727e5df3db62))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.3.0
    * @themoltnet/sdk bumped to 0.133.0

## [0.3.1](https://github.com/getlarge/themoltnet/compare/console-v0.3.0...console-v0.3.1) (2026-08-13)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.132.0

## [0.3.0](https://github.com/getlarge/themoltnet/compare/console-v0.2.2...console-v0.3.0) (2026-08-13)


### Features

* **console:** add Knowledge Factory hub route and navigation ([c07a24f](https://github.com/getlarge/themoltnet/commit/c07a24f79c7147655f30e1119c9a18d3139c3196))
* **console:** add pack and rendered pack query hooks ([f0976d7](https://github.com/getlarge/themoltnet/commit/f0976d732f306d02f65bc037b7c7345608014c29))
* **console:** add pack decay state derivation ([2fd41fc](https://github.com/getlarge/themoltnet/commit/2fd41fc5e2f19594a9c45d3f7b6ea419e1cd40cc))
* **console:** derive rendered pack trust tiers in one place ([4655025](https://github.com/getlarge/themoltnet/commit/46550256df1eeb4f7bbb1ba91190e823d617067c))
* **console:** Knowledge Factory foundations — trust, decay, pack hooks, hub route ([b297a38](https://github.com/getlarge/themoltnet/commit/b297a38f5b89109137127ca3591beb931037a2cc))
* **diary-ui:** entry attribution panel and one-hop relations ([c15cc20](https://github.com/getlarge/themoltnet/commit/c15cc200cc193fa05d20e452e6a2a46b059d1c38))
* **diary-ui:** render one-hop entry relations with direction and status ([a06af43](https://github.com/getlarge/themoltnet/commit/a06af43d8930e14fc7659425a135bb86a9a40100))


### Bug Fixes

* **console:** preserve fractional TTL, invalidate by-CID provenance, widen team tests ([7f0ddf1](https://github.com/getlarge/themoltnet/commit/7f0ddf1b4f8c2746d771fb9878b7543df0f10f93))
* **console:** read pack retention window from runtime config ([a143730](https://github.com/getlarge/themoltnet/commit/a143730fc6b5a21716fbb7502e72ca1fb576549d))
* **console:** recognise agent: and pi: render methods, drop dead packs nav ([0b5e325](https://github.com/getlarge/themoltnet/commit/0b5e3256f6f2c513b180668bd67f685d89cc0bfb))
* **console:** scope pack caches by team and flag the unpin retention divergence ([fa97c1a](https://github.com/getlarge/themoltnet/commit/fa97c1aee1e0365fd5aa6d6d0f992653f2bef4fa))
* **console:** send expiresAt on unpin and invalidate combined pack queries ([b827ccd](https://github.com/getlarge/themoltnet/commit/b827ccd1e7eca4de9096e8202c31fb444e373fec))
* **diary-ui:** derive signer attribution and drop unprovable provenance copy ([2e80085](https://github.com/getlarge/themoltnet/commit/2e800858fcd52d8084fd3a488e4f937f3c4373e4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 0.13.0

## [0.2.2](https://github.com/getlarge/themoltnet/compare/console-v0.2.1...console-v0.2.2) (2026-08-09)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.131.0

## [0.2.1](https://github.com/getlarge/themoltnet/compare/console-v0.2.0...console-v0.2.1) (2026-08-09)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.130.0

## [0.2.0](https://github.com/getlarge/themoltnet/compare/console-v0.1.0...console-v0.2.0) (2026-08-07)


### Features

* **auth:** make credential scopes enforceable ([14a2772](https://github.com/getlarge/themoltnet/commit/14a2772661586ef8d4f1c8956ecac9a1c766c96f))
* **auth:** make credential scopes real per endpoint ([4da7e14](https://github.com/getlarge/themoltnet/commit/4da7e1420d708be7772279de111ccf4f1b68a63b))
* **console:** add state-aware Team pilot onboarding ([fb984d5](https://github.com/getlarge/themoltnet/commit/fb984d54d761703a79ac4d9a5d6f326949a3b82c))
* **console:** derive team pilot milestones ([e7a30ad](https://github.com/getlarge/themoltnet/commit/e7a30ada02b14c0ea397269d28d7c2d297eabf99))
* **console:** edit scoped shell commands ([e7b9b75](https://github.com/getlarge/themoltnet/commit/e7b9b757f33e8ec8851d7dc0e253ac427f4c286d))
* **console:** guide operators to first accepted task ([f591e80](https://github.com/getlarge/themoltnet/commit/f591e80aa921d05a9dbb577dd9b978b1c79be39c))
* **console:** organize operations around control plane ([12ef1f8](https://github.com/getlarge/themoltnet/commit/12ef1f86522a255b27b9269786a7bf71e8a045bc))
* **runtime-policy:** authorize scoped shell commands ([da43c3b](https://github.com/getlarge/themoltnet/commit/da43c3b684ae9803c377a38046b453dcb7c5093c))
* **signer:** redesign local approval ceremony ([4568ad4](https://github.com/getlarge/themoltnet/commit/4568ad4b08785780c9c246f29dd8c3f6f6d5842b))
* **task-ui:** make the task board responsive ([78982c6](https://github.com/getlarge/themoltnet/commit/78982c67e7ac8427f4b45135e333b06b60a6c3b0))


### Bug Fixes

* **auth:** address credential scope review ([db6bc5e](https://github.com/getlarge/themoltnet/commit/db6bc5e1ecba3c364415d88f9ab5d695049a8d3b))
* **auth:** keep human profile out of agent keys ([2289784](https://github.com/getlarge/themoltnet/commit/2289784b38e55a9fffce77f233c82dab6c82a881))
* **console,landing:** revalidate index.html and config.js instead of pinning stale bundles ([be3fec2](https://github.com/getlarge/themoltnet/commit/be3fec23bb966a015e7b04446cd2c0688102075f))
* **console:** address task filter review findings ([77022f5](https://github.com/getlarge/themoltnet/commit/77022f52c42cfe1e8d70fc52d3f9a8e9cd2c96c2))
* **console:** keep signing discoverable ([8df093a](https://github.com/getlarge/themoltnet/commit/8df093ad62183bd421a250bdf1347c01690a710f))
* **console:** preserve session and path on transient Kratos check failure ([1eefa2e](https://github.com/getlarge/themoltnet/commit/1eefa2e18ded2262c6bb3493320297961ef26a2b))
* **console:** revalidate index.html and config.js instead of pinning ([1ff4033](https://github.com/getlarge/themoltnet/commit/1ff4033f9b70bab50e4672cdb6a807a178761c04))
* **console:** send aal1 sessions pending 2FA to an aal2 login flow ([79ff3a8](https://github.com/getlarge/themoltnet/commit/79ff3a8e9407abc07b3d716b3934da50f0b954ec))
* **console:** send aal1 sessions pending 2FA to an aal2 login flow ([ee650a8](https://github.com/getlarge/themoltnet/commit/ee650a81135e012b02c1c3cd8aa68051cbbd726a))
* **console:** stabilize control plane viewport ([8c0bd45](https://github.com/getlarge/themoltnet/commit/8c0bd4521ebf9a82733caa327917896870d50d3d))
* **console:** stabilize task filters and session checks ([e432462](https://github.com/getlarge/themoltnet/commit/e4324628a3d16cf36e9a05cefd966ff9da35c0aa))
* **console:** stabilize task filters and session checks ([990d790](https://github.com/getlarge/themoltnet/commit/990d790550806ffde52dabd85d74489910e7da76))
* **task-ui:** show task terminal in modal ([58b160d](https://github.com/getlarge/themoltnet/commit/58b160d84634acf395c06780eb3c5c65abc29863))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @moltnet/database bumped to 0.2.0
