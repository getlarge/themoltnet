# Changelog

## [0.23.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.5...pi-extension-v0.23.0) (2026-06-12)


### Features

* add daemon runtime profiles API ([09fde86](https://github.com/getlarge/themoltnet/commit/09fde86ef321d9739740047404c5fa0f12c49442))
* **tasks:** replace executor allowlists with profiles ([5341e5f](https://github.com/getlarge/themoltnet/commit/5341e5fe5e6023431d8d3f71db1c0c0902c2ff98))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.23.0
    * @themoltnet/sdk bumped to 0.107.0

## [0.22.5](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.4...pi-extension-v0.22.5) (2026-06-11)


### Bug Fixes

* **pi-extension:** bundle typebox for Pi loader ([9b9c2dc](https://github.com/getlarge/themoltnet/commit/9b9c2dccd0a7834f1aa283138d1638ec6932b968))
* **pi-extension:** bundle TypeBox for Pi loader ([f4d58fd](https://github.com/getlarge/themoltnet/commit/f4d58fda8aa4b89fd32de0c2365ea2b08e390e05))

## [0.22.4](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.3...pi-extension-v0.22.4) (2026-06-11)


### Bug Fixes

* migrate schemas to typebox v1 ([615ffa7](https://github.com/getlarge/themoltnet/commit/615ffa7927cf60f730840e3e07c92f756413449b))
* migrate schemas to TypeBox v1 ([565d3e5](https://github.com/getlarge/themoltnet/commit/565d3e5f93c19dff75dbcf76dce4a36d37a42f2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.22.4

## [0.22.3](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.2...pi-extension-v0.22.3) (2026-06-11)


### Bug Fixes

* trigger task schema package releases ([33b0309](https://github.com/getlarge/themoltnet/commit/33b03098fd48313a8024b7e3927d18292d457fc3))
* trigger task schema package releases ([203c4d4](https://github.com/getlarge/themoltnet/commit/203c4d4384de1c0d6d92bbfb5a69fabbefc85c91))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.22.3

## [0.22.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.1...pi-extension-v0.22.2) (2026-06-10)


### Bug Fixes

* **pi-extension:** harden sandbox path handling ([e9be93e](https://github.com/getlarge/themoltnet/commit/e9be93e55459a276a66a137d3495e7221451d011))
* **pi-extension:** mount sandbox workspaces at host paths ([7446cb9](https://github.com/getlarge/themoltnet/commit/7446cb99e6c25f602494a524b8955086a38943b8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.22.2

## [0.22.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.22.0...pi-extension-v0.22.1) (2026-06-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.22.1

## [0.22.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.21.0...pi-extension-v0.22.0) (2026-06-06)


### Features

* **agent-daemon:** extract durable daemon state ([3512bf1](https://github.com/getlarge/themoltnet/commit/3512bf1bde6ec2d05003e0cc60ff31352bb75f3d))
* **agent-runtime:** allow async continuation state ([d93d0a4](https://github.com/getlarge/themoltnet/commit/d93d0a44efdf7280687946083e0de2fe7135dffd))


### Bug Fixes

* prevent pi-extension private dependency leak ([5ce2ec9](https://github.com/getlarge/themoltnet/commit/5ce2ec94a7837b0cf6cc7427f4bbcbeacc88e154))
* prevent pi-extension private dependency leak ([4d77b82](https://github.com/getlarge/themoltnet/commit/4d77b8232e2df75327713557920403be9d7c2e9d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.22.0

## [0.21.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.20.2...pi-extension-v0.21.0) (2026-06-05)


### Features

* **agent-runtime:** fetch source output for continuation prompt ([69e8a64](https://github.com/getlarge/themoltnet/commit/69e8a642995b06ba645ce4d9d0e456066b0380be)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)


### Bug Fixes

* **tasks:** pre-merge review fixes for PR [#1307](https://github.com/getlarge/themoltnet/issues/1307) ([71db8ac](https://github.com/getlarge/themoltnet/commit/71db8ac6956516dbf571c438d728f16e0eeb2907)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.21.0

## [0.20.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.20.1...pi-extension-v0.20.2) (2026-05-30)


### Bug Fixes

* **pi-extension:** bash non-zero exits no longer emit tool_call_error ([f91d152](https://github.com/getlarge/themoltnet/commit/f91d1520862bcd5a83be3801c503c3b022df243f)), closes [#1261](https://github.com/getlarge/themoltnet/issues/1261)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.20.0

## [0.20.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.20.0...pi-extension-v0.20.1) (2026-05-28)


### Bug Fixes

* **tasks:** steer fulfill PR creation to the in-VM gh path ([#1248](https://github.com/getlarge/themoltnet/issues/1248)) ([#1256](https://github.com/getlarge/themoltnet/issues/1256)) ([53c11de](https://github.com/getlarge/themoltnet/commit/53c11dea74afa76a0ef8cfd65775923522b6f128))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.19.1

## [0.20.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.6...pi-extension-v0.20.0) (2026-05-26)


### Features

* **tasks:** add conditional claimability ([78bb795](https://github.com/getlarge/themoltnet/commit/78bb795ef4c4d88d8b192e1a998c16ce3b831870))
* **tasks:** add conditional claimability ([580161f](https://github.com/getlarge/themoltnet/commit/580161f6d84862e85b7b1d56887ff45f2732a0cf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.19.0
    * @themoltnet/sdk bumped to 0.106.0

## [0.19.6](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.5...pi-extension-v0.19.6) (2026-05-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.5
    * @themoltnet/sdk bumped to 0.105.1

## [0.19.5](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.4...pi-extension-v0.19.5) (2026-05-22)


### Bug Fixes

* **tasks:** make submit output a success criterion ([cf60fd8](https://github.com/getlarge/themoltnet/commit/cf60fd8192c4358b7a4346aacb956e4c46db4bc5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.4

## [0.19.4](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.3...pi-extension-v0.19.4) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.3
    * @themoltnet/sdk bumped to 0.105.0

## [0.19.3](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.2...pi-extension-v0.19.3) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.2
    * @themoltnet/sdk bumped to 0.104.0

## [0.19.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.1...pi-extension-v0.19.2) (2026-05-21)


### Bug Fixes

* **agent-daemon:** judge from persisted producer context copy ([58d9bb1](https://github.com/getlarge/themoltnet/commit/58d9bb1e8583d5b1a08cadbf70cd3c8e3128be7a))
* **pi-extension:** isolate judge scratch workspace copies ([b83e491](https://github.com/getlarge/themoltnet/commit/b83e4916576324d3f662fbc4d39a941281655eff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.1

## [0.19.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.19.0...pi-extension-v0.19.1) (2026-05-19)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.0

## [0.19.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.18.1...pi-extension-v0.19.0) (2026-05-18)


### Features

* **#943:** Phase 0 eval substrate dogfood — SDK, pi-extension, prompts, daemon, imposers ([5155fd7](https://github.com/getlarge/themoltnet/commit/5155fd7a3c3137d1d18d9203cefbb3d8082b79b4))
* **evals:** refresh legreffier scenarios and runner modes ([4f9a128](https://github.com/getlarge/themoltnet/commit/4f9a1282de40b03b84916c5217b54a2a7af15588))
* **pi-extension:** per-step retry policy on resumeCommands ([88db35d](https://github.com/getlarge/themoltnet/commit/88db35dcc4b942af4bc7a62565d3a771c9e3d6c0)), closes [#943](https://github.com/getlarge/themoltnet/issues/943)


### Bug Fixes

* **eval:** attach judges to producer context ([0af04e0](https://github.com/getlarge/themoltnet/commit/0af04e084799394f02b492f1cfa6c1b3cde53144))
* **eval:** enforce submit-tool completion for producer tasks ([e67abc0](https://github.com/getlarge/themoltnet/commit/e67abc06a76adcfc458cc885701a4eeab78bcaf4))
* **eval:** harden local eval execution and judging ([3fb7a24](https://github.com/getlarge/themoltnet/commit/3fb7a24b599f9d7e02d4b0e880917b94937bd4db))
* **eval:** preserve producer workspaces for judging ([71b0b8a](https://github.com/getlarge/themoltnet/commit/71b0b8a39ac90f1c9587fe87d56b7a8de05acefe))
* **eval:** strengthen inline context delivery and prompt discipline ([a2b5f1e](https://github.com/getlarge/themoltnet/commit/a2b5f1eff1059efb6fc0937cab1a0cef2b598248))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.17.0
    * @themoltnet/sdk bumped to 0.103.0

## [0.18.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.18.0...pi-extension-v0.18.1) (2026-05-16)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.16.0

## [0.18.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.17.0...pi-extension-v0.18.0) (2026-05-15)


### Features

* **runtime:** surface setup and tool failures in task messages ([2070cf7](https://github.com/getlarge/themoltnet/commit/2070cf72e3b66d1ec8b6df500888734018907e46))


### Bug Fixes

* **agent-daemon:** repair dedicated warm-session worktree mounting ([d6051f9](https://github.com/getlarge/themoltnet/commit/d6051f915e2f51ac9963cb40012c3a2423def9e6))
* **pi-extension:** mount repo root for dedicated task worktrees ([9038fdf](https://github.com/getlarge/themoltnet/commit/9038fdfb10289acb8caf1335eb2b46f4324c00e9))
* **pi-extension:** repair typecheck after worktree changes ([6c0197b](https://github.com/getlarge/themoltnet/commit/6c0197b4257e8f01faeccd15002edb63c29eed93))
* **pi-extension:** restore agent-runtime package imports ([4907746](https://github.com/getlarge/themoltnet/commit/49077468af72a7619d93cb7f9de2d5620acf97f1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.2

## [0.17.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.16.2...pi-extension-v0.17.0) (2026-05-14)


### Features

* **agent-daemon:** persist Pi sessions for resumable tasks ([63f3cf6](https://github.com/getlarge/themoltnet/commit/63f3cf6ee59249f131bd324ec7c47aa2fcf484f8))
* **agent-daemon:** track reusable daemon slots ([42bc563](https://github.com/getlarge/themoltnet/commit/42bc563fce841b0dc175d722e5973ece545489de))


### Bug Fixes

* **agent-daemon:** address PR review follow-up ([669eb77](https://github.com/getlarge/themoltnet/commit/669eb7715d39cbb200e2972243144c184fc43b5e))
* **agent-daemon:** remove regex slugifiers ([dc4190d](https://github.com/getlarge/themoltnet/commit/dc4190df608b62b4abab801fe5aa0d8055052b2f))

## [0.16.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.16.1...pi-extension-v0.16.2) (2026-05-12)


### Bug Fixes

* **agent-daemon:** isolate assess_brief review worktrees ([b659693](https://github.com/getlarge/themoltnet/commit/b659693dd14e6c914e9da38c26d7bf48856cde55))
* **agent-daemon:** isolate fulfill_brief in dedicated worktree ([2c3c999](https://github.com/getlarge/themoltnet/commit/2c3c9997b3309306475785f74a1dca5be24fe78c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.1

## [0.16.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.16.0...pi-extension-v0.16.1) (2026-05-12)


### Bug Fixes

* **agent-daemon:** auto-approve host exec in daemon mode ([465420c](https://github.com/getlarge/themoltnet/commit/465420cc1b8c73fbdfb8c46b10f60a12762e12ff))
* **agent-daemon:** auto-approve host exec in daemon mode ([31e77c7](https://github.com/getlarge/themoltnet/commit/31e77c75f9be550cc07a269cd91425ff533dcb19)), closes [#1123](https://github.com/getlarge/themoltnet/issues/1123)
* **diary:** lift tag length limit ([508f7e7](https://github.com/getlarge/themoltnet/commit/508f7e7fedf8a78685bb23dc4d41478f840b1f72))
* **pi-extension:** scope host exec auto approval ([382c9af](https://github.com/getlarge/themoltnet/commit/382c9afe0b254101955895da9a547298836d12dc))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.15.2...pi-extension-v0.16.0) (2026-05-11)


### Features

* **agent-daemon:** --max-turns and --max-bash-timeouts caps ([#1094](https://github.com/getlarge/themoltnet/issues/1094) P1) ([fc5f7bd](https://github.com/getlarge/themoltnet/commit/fc5f7bd99f4578f9460a410faee5c6c89fbb3e15))


### Bug Fixes

* **daemon,pi-extension:** close VM on resume failure; close pino transport; TS narrowing (closes [#1107](https://github.com/getlarge/themoltnet/issues/1107)) ([7cd9bcf](https://github.com/getlarge/themoltnet/commit/7cd9bcf1e104dd766a29ba24c1d6171c40488a19))
* **pi-extension:** runtime-instructor forbids `moltnet entry` CLI inside tasks (closes [#1094](https://github.com/getlarge/themoltnet/issues/1094) P4) ([2b4229d](https://github.com/getlarge/themoltnet/commit/2b4229d73ef580446bf4606c5381f7a2afa19256))
* **pi-extension:** use existing configFor helper in tool-description test ([c2180b6](https://github.com/getlarge/themoltnet/commit/c2180b64d2c945cc160aa920eb45a20f0fd5e7ed))
* **pi-extension:** warn against `moltnet entry` CLI in tool description (reinforces [#1094](https://github.com/getlarge/themoltnet/issues/1094) P4) ([9766d55](https://github.com/getlarge/themoltnet/commit/9766d557867214be2c11b8083f4fba299e40c0cc))

## [0.15.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.15.1...pi-extension-v0.15.2) (2026-05-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.0
    * @themoltnet/sdk bumped to 0.102.0

## [0.15.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.15.0...pi-extension-v0.15.1) (2026-05-11)


### Bug Fixes

* **pi-extension:** address PR [#1099](https://github.com/getlarge/themoltnet/issues/1099) review — vmRun helper, pipefail, perms ([a5f68af](https://github.com/getlarge/themoltnet/commit/a5f68af4db62067ff938a27a8930021775e4f2fa))
* **pi-extension:** make pnpm install 100× faster in agent VM ([86b9a9e](https://github.com/getlarge/themoltnet/commit/86b9a9e5eb713d191eee1bb14c8bcbb12ae15258))
* **pi-extension:** make pnpm install 100× faster in agent VM (closes [#1097](https://github.com/getlarge/themoltnet/issues/1097)) ([3200edf](https://github.com/getlarge/themoltnet/commit/3200edf894095276851d438307d1c88dc898048a))
* **pi-extension:** move tmpfs mount to resumeCommands; env defaults for plain pnpm install ([6449f0e](https://github.com/getlarge/themoltnet/commit/6449f0ef9b34134b35c6448912ad2a3f01d6bc4a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.14.0
    * @themoltnet/sdk bumped to 0.101.0

## [0.15.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.14.0...pi-extension-v0.15.0) (2026-05-10)


### Features

* generic subagent primitive ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([46f6799](https://github.com/getlarge/themoltnet/commit/46f679968621da361d4d255896ce9d42fa2a4b01))
* **pi-extension:** subagent cancel + per-call timeout (closes [#1090](https://github.com/getlarge/themoltnet/issues/1090)) ([447398c](https://github.com/getlarge/themoltnet/commit/447398c91f14120f8f7180603034bb0d65d327aa))
* **pi-extension:** subagent custom tool + executor wiring ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([c7ab76a](https://github.com/getlarge/themoltnet/commit/c7ab76a7c1dbf10db9e64c18836c4591b2aff199))


### Bug Fixes

* address PR [#1089](https://github.com/getlarge/themoltnet/issues/1089) review feedback ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([232a667](https://github.com/getlarge/themoltnet/commit/232a667d454dd66ff1201277646e6da31487d9dd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.13.0

## [0.14.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.5...pi-extension-v0.14.0) (2026-05-10)


### Features

* **daemon:** mirror task messages to local logger via onTurnEvent ([7607f2f](https://github.com/getlarge/themoltnet/commit/7607f2f8d97f4cf72db62a518fedef3e042ba20f))
* **daemon:** per-task onTurnEvent factory for poll mode (closes [#1078](https://github.com/getlarge/themoltnet/issues/1078)) ([db196cb](https://github.com/getlarge/themoltnet/commit/db196cba3a4214413779826183992ae6dcdd12e1))
* **pi-extension+daemon:** onTurnEvent callback mirrors task messages to local logger ([d24648e](https://github.com/getlarge/themoltnet/commit/d24648ef95a08792b02774331237210e76b4c53f))
* **pi-extension+daemon:** per-task onTurnEvent factory (closes [#1078](https://github.com/getlarge/themoltnet/issues/1078)) ([c7ae663](https://github.com/getlarge/themoltnet/commit/c7ae6632d446a554e92a2b25d8036c43b128a83f))
* **pi-extension:** wire resolveTaskContext ([#943](https://github.com/getlarge/themoltnet/issues/943) slice 1.5) ([a0f19e1](https://github.com/getlarge/themoltnet/commit/a0f19e1be0aa90731307c2cf9c0856395c5ebd5c))
* **pi-extension:** wire resolveTaskContext into execute-pi-task ([#943](https://github.com/getlarge/themoltnet/issues/943) slice 1.5) ([2ac4b54](https://github.com/getlarge/themoltnet/commit/2ac4b546b50a85794ff79f9b31f017e65f8afe19))
* **tasks:** add Task.allowedExecutors imposer policy + daemon filter ([6db33b4](https://github.com/getlarge/themoltnet/commit/6db33b4a47ecd72b57b2751ac52945391dda54c7))
* **tasks:** add Task.allowedExecutors imposer policy + server filter ([e805406](https://github.com/getlarge/themoltnet/commit/e805406c6b7c0e7f3f25deb50c58b8bd9efe5b2e))


### Bug Fixes

* address inconsistencies found during rebase check ([#943](https://github.com/getlarge/themoltnet/issues/943)) ([e0622f4](https://github.com/getlarge/themoltnet/commit/e0622f4bbc056010a7734bf02d9d66228c59b0a9))
* **daemon:** address [#1074](https://github.com/getlarge/themoltnet/issues/1074) review (info-case truncation, exhaustive types, dedup) ([d9cbf88](https://github.com/getlarge/themoltnet/commit/d9cbf88159102d926589d39593dec524e8dc3ae8))
* **pi-extension:** address PR [#1076](https://github.com/getlarge/themoltnet/issues/1076) review feedback ([#943](https://github.com/getlarge/themoltnet/issues/943)) ([a97720a](https://github.com/getlarge/themoltnet/commit/a97720a2d0551768a375efc6f75b1684373d713d))
* **pi-extension:** MemoryProvider mount for task-context skills + smoke test ([#943](https://github.com/getlarge/themoltnet/issues/943)) ([8d7433c](https://github.com/getlarge/themoltnet/commit/8d7433cd9f14396af15f81feff69dad123039515))
* **pi-extension:** mount task-context skills via MemoryProvider ([#943](https://github.com/getlarge/themoltnet/issues/943)) ([c622e5e](https://github.com/getlarge/themoltnet/commit/c622e5e8f05ab6a3576dcfe4f4953298da26117b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.12.0
    * @themoltnet/sdk bumped to 0.100.0

## [0.13.5](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.4...pi-extension-v0.13.5) (2026-05-09)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.11.0

## [0.13.4](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.3...pi-extension-v0.13.4) (2026-05-09)


### Bug Fixes

* **pi-extension:** honor PI_CODING_AGENT_DIR for pi auth resolution ([1a802e7](https://github.com/getlarge/themoltnet/commit/1a802e74613ed006a34c941b1a5a5fe47297b3c1))
* **pi-extension:** honor PI_CODING_AGENT_DIR; bump gondolin to 0.9.1 ([1e3d2f7](https://github.com/getlarge/themoltnet/commit/1e3d2f7971def7abe8f7fdca6129d3ce47d03f64))

## [0.13.3](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.2...pi-extension-v0.13.3) (2026-05-08)


### Bug Fixes

* **pi-extension:** surface pi's underlying error on llm_api_error ([6ec3cfa](https://github.com/getlarge/themoltnet/commit/6ec3cfaf6e4118c360ed16fd8a46e84fa48941f6))
* surface pi LLM errors, fix PI auth resolution on host runner, cache gondolin snapshot ([fe05ad7](https://github.com/getlarge/themoltnet/commit/fe05ad7fc8df393c3b4784ffe2a2927dd3d38c6a))

## [0.13.2](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.1...pi-extension-v0.13.2) (2026-05-08)


### Bug Fixes

* **pi-extension:** use linux-x64 (not linux-amd64) when fetching MoltNet CLI in snapshots ([9affa3f](https://github.com/getlarge/themoltnet/commit/9affa3fffd9f201a429cbab0d22dff3d28c47a83))

## [0.13.1](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.13.0...pi-extension-v0.13.1) (2026-05-08)


### Bug Fixes

* **agent-daemon-action:** require provider+model; migrate Pi packages to [@earendil-works](https://github.com/earendil-works) ([369d137](https://github.com/getlarge/themoltnet/commit/369d137cbc25100b3614d0c73eb174d306894a7d))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.12.0...pi-extension-v0.13.0) (2026-05-08)


### Features

* **pi-extension:** make pi auth.json optional, support PI_AUTH_PATH override ([43b53bc](https://github.com/getlarge/themoltnet/commit/43b53bc026203ebfa61c6fbe7b4ae52de2d718f3))
* ship agent-daemon (npm + GH Action) with correlationId anchors ([a0b8f98](https://github.com/getlarge/themoltnet/commit/a0b8f98ef5dd14aaf5c3e4e6fb9e723b5cb570e2))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.11.0...pi-extension-v0.12.0) (2026-05-08)


### Features

* **build:** make SSR vite configs inferable via rolldownOptions.input ([9b71d6e](https://github.com/getlarge/themoltnet/commit/9b71d6e31c5ea60a4b1c54dc55466d6fdcdcb27f)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* **tasks:** add llm_assertions scoring mode for binary-with-evidence judges ([b0a06ba](https://github.com/getlarge/themoltnet/commit/b0a06ba8702076e7423afa0bc4734fee921fc1fd))


### Bug Fixes

* **tasks:** enforce llm_checklist score↔assertions consistency + correct moltnet_pack_get arg shape ([0624ae1](https://github.com/getlarge/themoltnet/commit/0624ae1eea01e4b30d4b35c8cf1e033299b90c36))


### Performance Improvements

* **ci:** give rest-api:test a dedicated agent with 4 vitest threads ([c549d6e](https://github.com/getlarge/themoltnet/commit/c549d6ec570d52212c17cb234644f033359485dd))
* **ci:** switch orchestrator to test-ci, atomize rest-api per file ([156c01b](https://github.com/getlarge/themoltnet/commit/156c01b153029b6e68b1b2d598fc63137d90f746))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.10.0...pi-extension-v0.11.0) (2026-05-05)


### Features

* **deps:** bump pi-coding-agent + pi-ai to 0.73.0 and enable submit-tool terminate ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([4c7f4e9](https://github.com/getlarge/themoltnet/commit/4c7f4e9d08bc988d046bdec5e9001d21a93c8b66))
* **pi-extension:** add OTel parse_result counter for task-output capture ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([5efda78](https://github.com/getlarge/themoltnet/commit/5efda7863e3a703e8cb1fde14221e1926e5c69aa))
* **pi-extension:** namespace task provenance tags under task:*, expand list/search filters ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([253135b](https://github.com/getlarge/themoltnet/commit/253135b0a942c910010eedffbc59f5b48b33b657))
* **pi-extension:** wire per-task-type submit-output tool ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([65aa6b3](https://github.com/getlarge/themoltnet/commit/65aa6b3e7112faab582e37f15369491ab10fecdf))
* structured task output via submit-tool + measurement ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([2e86b87](https://github.com/getlarge/themoltnet/commit/2e86b87b0381833bb0747bf25bc708aba4fc3203))


### Bug Fixes

* **pi-extension:** schema-guided submit tool, narrow catch, count invalid args ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([66e104c](https://github.com/getlarge/themoltnet/commit/66e104c9d4673e46e44a525871c405f53de2772e))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/pi-extension-v0.9.0...pi-extension-v0.10.0) (2026-04-30)


### Features

* **runtime:** isolate agent-daemon task VM from local skills and diaries ([2b946bf](https://github.com/getlarge/themoltnet/commit/2b946bfaab8803f27b970ead60555fc30773f244))
* **runtime:** isolate agent-daemon task VM from local skills and diaries ([ed87b30](https://github.com/getlarge/themoltnet/commit/ed87b3007c3470e49290250a7e99fc62f9c9dbdf))
* **tasks:** make assess_brief actually run end-to-end via the daemon ([#951](https://github.com/getlarge/themoltnet/issues/951)) ([ebfcaeb](https://github.com/getlarge/themoltnet/commit/ebfcaeb97f8e6d78b3612c1516582dfd4f88cc7c))
* **tasks:** make assess_brief run end-to-end + PR-complexity rubric ([c9db509](https://github.com/getlarge/themoltnet/commit/c9db5091c1f09af970d8afb014453ebd1f2a867c))


### Bug Fixes

* **runtime:** include task.correlationId in entry provenance; replace cat with readFileSync ([21a88fa](https://github.com/getlarge/themoltnet/commit/21a88fa1c914b638bd7349d5559f92098b80209f))
* **runtime:** tighten runtime instructor — assume moltnet on PATH; rename attempt tag ([ac7662e](https://github.com/getlarge/themoltnet/commit/ac7662e8199ee0e5ffdc41934f3cf4b1e4b67709))
* **tasks:** address PR [#957](https://github.com/getlarge/themoltnet/issues/957) review — assess-pr targets a real task; cleaner errors ([34d6ca6](https://github.com/getlarge/themoltnet/commit/34d6ca6f76418eb8ecbb5456f974fb0ebc2a0ed7))

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
