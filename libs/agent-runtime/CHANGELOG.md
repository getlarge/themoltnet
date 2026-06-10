# Changelog

## [0.22.2](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.22.1...agent-runtime-v0.22.2) (2026-06-10)


### Bug Fixes

* **agent-runtime:** avoid fixed workspace paths in prompts ([7a13abf](https://github.com/getlarge/themoltnet/commit/7a13abff09e725138f1f26f1022c92bd742ea560))

## [0.22.1](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.22.0...agent-runtime-v0.22.1) (2026-06-07)


### Bug Fixes

* **agent-runtime:** scan pages after local claim skips ([4b8bf35](https://github.com/getlarge/themoltnet/commit/4b8bf35401452a44b797f0cce67e59d51ecbd9f6))
* **agent-runtime:** scan pages after local claim skips ([eb0156a](https://github.com/getlarge/themoltnet/commit/eb0156ab7060604ca07f4fc221b57f4eba543287))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.21.0...agent-runtime-v0.22.0) (2026-06-06)


### Features

* **agent-daemon:** extract durable daemon state ([3512bf1](https://github.com/getlarge/themoltnet/commit/3512bf1bde6ec2d05003e0cc60ff31352bb75f3d))
* **agent-runtime:** allow async continuation state ([d93d0a4](https://github.com/getlarge/themoltnet/commit/d93d0a44efdf7280687946083e0de2fe7135dffd))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.20.0...agent-runtime-v0.21.0) (2026-06-05)


### Features

* **agent-runtime:** claim-time affinity filter for continuations ([a5ff332](https://github.com/getlarge/themoltnet/commit/a5ff3320efcecf168d62fe456481738a917930c4)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)
* **agent-runtime:** fetch source output for continuation prompt ([69e8a64](https://github.com/getlarge/themoltnet/commit/69e8a642995b06ba645ce4d9d0e456066b0380be)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)
* **agent-runtime:** prior-context prompt section for continuations ([2541f6a](https://github.com/getlarge/themoltnet/commit/2541f6ac8a28f6be50c49b2fcec63735910e268f)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)

## [0.20.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.19.1...agent-runtime-v0.20.0) (2026-05-30)


### Features

* **agent-runtime:** steer freeform agents to inline artifact body ([b1dce7b](https://github.com/getlarge/themoltnet/commit/b1dce7bcca6a4f6d6af5dc15f6e7a304724df527)), closes [#1261](https://github.com/getlarge/themoltnet/issues/1261)

## [0.19.1](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.19.0...agent-runtime-v0.19.1) (2026-05-28)


### Bug Fixes

* **tasks:** steer fulfill PR creation to the in-VM gh path ([#1248](https://github.com/getlarge/themoltnet/issues/1248)) ([#1256](https://github.com/getlarge/themoltnet/issues/1256)) ([53c11de](https://github.com/getlarge/themoltnet/commit/53c11dea74afa76a0ef8cfd65775923522b6f128))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.5...agent-runtime-v0.19.0) (2026-05-26)


### Features

* **tasks:** add conditional claimability ([78bb795](https://github.com/getlarge/themoltnet/commit/78bb795ef4c4d88d8b192e1a998c16ce3b831870))
* **tasks:** add conditional claimability ([580161f](https://github.com/getlarge/themoltnet/commit/580161f6d84862e85b7b1d56887ff45f2732a0cf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.106.0

## [0.18.5](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.4...agent-runtime-v0.18.5) (2026-05-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.105.1

## [0.18.4](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.3...agent-runtime-v0.18.4) (2026-05-22)


### Bug Fixes

* **tasks:** make submit output a success criterion ([cf60fd8](https://github.com/getlarge/themoltnet/commit/cf60fd8192c4358b7a4346aacb956e4c46db4bc5))

## [0.18.3](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.2...agent-runtime-v0.18.3) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.105.0

## [0.18.2](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.1...agent-runtime-v0.18.2) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.104.0

## [0.18.1](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.18.0...agent-runtime-v0.18.1) (2026-05-21)


### Bug Fixes

* **agent-daemon:** judge from persisted producer context copy ([58d9bb1](https://github.com/getlarge/themoltnet/commit/58d9bb1e8583d5b1a08cadbf70cd3c8e3128be7a))
* **agent-runtime:** drop stale judge prompt source check ([a2d4b61](https://github.com/getlarge/themoltnet/commit/a2d4b61918298dd7463b62ac3ad79663801d0f20))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.17.0...agent-runtime-v0.18.0) (2026-05-19)


### Features

* **agent-runtime:** add render-pack fidelity discipline ([04f211f](https://github.com/getlarge/themoltnet/commit/04f211fef9568f965dcb7ffe849406257095de67))
* **agent-runtime:** add render-pack fidelity discipline ([997a4dc](https://github.com/getlarge/themoltnet/commit/997a4dc9737e5100947fb3269628a1fe50289c35))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.16.0...agent-runtime-v0.17.0) (2026-05-18)


### Features

* **#943:** Phase 0 eval substrate dogfood — SDK, pi-extension, prompts, daemon, imposers ([5155fd7](https://github.com/getlarge/themoltnet/commit/5155fd7a3c3137d1d18d9203cefbb3d8082b79b4))
* **evals:** refresh legreffier scenarios and runner modes ([4f9a128](https://github.com/getlarge/themoltnet/commit/4f9a1282de40b03b84916c5217b54a2a7af15588))


### Bug Fixes

* **agent-runtime,agent-daemon:** explicit verification consequence + complete-rejection fallback ([d954209](https://github.com/getlarge/themoltnet/commit/d95420997eb4690615586eb22ffe149a9a76884e)), closes [#943](https://github.com/getlarge/themoltnet/issues/943)
* **ci:** restore eval PR checks ([75ddad6](https://github.com/getlarge/themoltnet/commit/75ddad652538afc0f0206aba9fb3677f175bedf5))
* **eval:** enforce submit-tool completion for producer tasks ([e67abc0](https://github.com/getlarge/themoltnet/commit/e67abc06a76adcfc458cc885701a4eeab78bcaf4))
* **eval:** harden local eval execution and judging ([3fb7a24](https://github.com/getlarge/themoltnet/commit/3fb7a24b599f9d7e02d4b0e880917b94937bd4db))
* **eval:** preserve producer workspaces for judging ([71b0b8a](https://github.com/getlarge/themoltnet/commit/71b0b8a39ac90f1c9587fe87d56b7a8de05acefe))
* **eval:** strengthen inline context delivery and prompt discipline ([a2b5f1e](https://github.com/getlarge/themoltnet/commit/a2b5f1eff1059efb6fc0937cab1a0cef2b598248))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.103.0

## [0.16.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.15.2...agent-runtime-v0.16.0) (2026-05-16)


### Features

* add LeGreffier PR complexity review flow ([800cd4f](https://github.com/getlarge/themoltnet/commit/800cd4f23f01e22e903861910e2832ac806ef179))
* **tasks:** add generic pr_review task ([479ffb1](https://github.com/getlarge/themoltnet/commit/479ffb190bd471b3bd1835443ccf4d992df1f066))

## [0.15.2](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.15.1...agent-runtime-v0.15.2) (2026-05-15)


### Bug Fixes

* **agent-daemon:** repair dedicated warm-session worktree mounting ([d6051f9](https://github.com/getlarge/themoltnet/commit/d6051f915e2f51ac9963cb40012c3a2423def9e6))
* format subagent-output-contracts.test.ts (nx format) ([d931549](https://github.com/getlarge/themoltnet/commit/d931549bf3547bcf1c0e132a04f72911830a801b))

## [0.15.1](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.15.0...agent-runtime-v0.15.1) (2026-05-12)


### Bug Fixes

* **agent-daemon:** isolate assess_brief review worktrees ([b659693](https://github.com/getlarge/themoltnet/commit/b659693dd14e6c914e9da38c26d7bf48856cde55))
* **agent-daemon:** isolate fulfill_brief in dedicated worktree ([2c3c999](https://github.com/getlarge/themoltnet/commit/2c3c9997b3309306475785f74a1dca5be24fe78c))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.14.0...agent-runtime-v0.15.0) (2026-05-11)


### Features

* **tasks:** support multi-type task polling ([621e4fc](https://github.com/getlarge/themoltnet/commit/621e4fc8f26d9abb74e092a76866142e23f2db7e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.102.0

## [0.14.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.13.0...agent-runtime-v0.14.0) (2026-05-11)


### Features

* **tasks,agent-runtime:** register judge_eval_variant + subagent contract ([#943](https://github.com/getlarge/themoltnet/issues/943)) ([8a47f52](https://github.com/getlarge/themoltnet/commit/8a47f5227cfda7788370f55e296e3bb697e133a2))
* **tasks:** async task validation + correlation seals + judge_eval_variant ([#1096](https://github.com/getlarge/themoltnet/issues/1096), [#943](https://github.com/getlarge/themoltnet/issues/943)) ([68e2c05](https://github.com/getlarge/themoltnet/commit/68e2c05c6c91c2e4a55f994f2c5f6df99582ad6a))


### Bug Fixes

* **agent-runtime:** escape backslashes in judge_eval_variant criteria cells ([a4480d0](https://github.com/getlarge/themoltnet/commit/a4480d04d935aa6b36b9be713601918665bd4d62))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.101.0

## [0.13.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.12.0...agent-runtime-v0.13.0) (2026-05-10)


### Features

* **agent-runtime:** subagent output contract registry ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([8fcd234](https://github.com/getlarge/themoltnet/commit/8fcd23460d520977fb8bf833a38976411b4debbc))
* generic subagent primitive ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([46f6799](https://github.com/getlarge/themoltnet/commit/46f679968621da361d4d255896ce9d42fa2a4b01))
* **pi-extension:** subagent custom tool + executor wiring ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([c7ab76a](https://github.com/getlarge/themoltnet/commit/c7ab76a7c1dbf10db9e64c18836c4591b2aff199))


### Bug Fixes

* address PR [#1089](https://github.com/getlarge/themoltnet/issues/1089) review feedback ([#1087](https://github.com/getlarge/themoltnet/issues/1087)) ([232a667](https://github.com/getlarge/themoltnet/commit/232a667d454dd66ff1201277646e6da31487d9dd))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.11.0...agent-runtime-v0.12.0) (2026-05-10)


### Features

* **agent-daemon:** filter and refuse tasks not in allowedExecutors ([7560442](https://github.com/getlarge/themoltnet/commit/75604425c9dafceecf09168b8d9f4ac8eadea9fe))
* run_eval task type + TaskContext bindings (slice 1 of [#943](https://github.com/getlarge/themoltnet/issues/943)) ([74bb797](https://github.com/getlarge/themoltnet/commit/74bb7976279d8cfc7bd30a05041e76b5ba08e272))
* **tasks:** add Task.allowedExecutors imposer policy + daemon filter ([6db33b4](https://github.com/getlarge/themoltnet/commit/6db33b4a47ecd72b57b2751ac52945391dda54c7))
* **tasks:** add Task.allowedExecutors imposer policy + server filter ([e805406](https://github.com/getlarge/themoltnet/commit/e805406c6b7c0e7f3f25deb50c58b8bd9efe5b2e))


### Bug Fixes

* **agent-daemon:** filter allowedExecutors at candidate level, not post-claim ([6f0d926](https://github.com/getlarge/themoltnet/commit/6f0d926f04dd5cae3f096cf65d89405ce9bf317d))
* **tasks:** address PR [#1075](https://github.com/getlarge/themoltnet/issues/1075) review ([913993b](https://github.com/getlarge/themoltnet/commit/913993b557d14b4677b6e8a3a4a79d223305feb1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.100.0

## [0.11.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.10.0...agent-runtime-v0.11.0) (2026-05-09)


### Features

* two-tier timeout (runner + server) for the dispatch path; [#1064](https://github.com/getlarge/themoltnet/issues/1064) review fixes ([517e84a](https://github.com/getlarge/themoltnet/commit/517e84a34066cd2ef3a453f0e66b35ee669bce89))


### Bug Fixes

* **agent-runtime:** retry first appendMessages on 403 (Keto consistency window) ([6e804b2](https://github.com/getlarge/themoltnet/commit/6e804b29a3e649a8d48262222aa906e186d59407))
* **agent-runtime:** retry first appendMessages on 403 + e2e coverage ([c6d4a09](https://github.com/getlarge/themoltnet/commit/c6d4a09d5d47069c1c8ad8d9919551b819a87d44))
* **agent-runtime:** tighten first-append retry; reset on re-open ([#1064](https://github.com/getlarge/themoltnet/issues/1064) review) ([67610cf](https://github.com/getlarge/themoltnet/commit/67610cfe31345859603ccf5d26e82b2c8911be82))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.9.0...agent-runtime-v0.10.0) (2026-05-08)


### Features

* **agent-daemon:** plumb correlation anchor hook through finalize ([6b91944](https://github.com/getlarge/themoltnet/commit/6b9194454dcfd7a1b2bdf04c6e575e4dbd076d52))
* **agent-runtime:** instruct fulfill_brief agent to embed correlationId ([a228689](https://github.com/getlarge/themoltnet/commit/a2286899e98aa3b6d984b1a8ede2b20f4f17afa8))
* ship agent-daemon (npm + GH Action) with correlationId anchors ([a0b8f98](https://github.com/getlarge/themoltnet/commit/a0b8f98ef5dd14aaf5c3e4e6fb9e723b5cb570e2))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.8.0...agent-runtime-v0.9.0) (2026-05-08)


### Features

* **build:** make SSR vite configs inferable via rolldownOptions.input ([9b71d6e](https://github.com/getlarge/themoltnet/commit/9b71d6e31c5ea60a4b1c54dc55466d6fdcdcb27f)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* **tasks:** add llm_assertions scoring mode for binary-with-evidence judges ([b0a06ba](https://github.com/getlarge/themoltnet/commit/b0a06ba8702076e7423afa0bc4734fee921fc1fd))
* **tasks:** add llm_assertions scoring mode for binary-with-evidence judges ([afe4512](https://github.com/getlarge/themoltnet/commit/afe451235bc31041cacfa826c79b7239b8b84357))


### Bug Fixes

* **agent-runtime:** add per-task onTaskFinished hook so poll-mode finalizes tasks ([1bb1d04](https://github.com/getlarge/themoltnet/commit/1bb1d048ffe7bbdd069db7846bf89a4f25ddd716))
* **agent-runtime:** per-task onTaskFinished hook so poll-mode finalizes tasks ([49103db](https://github.com/getlarge/themoltnet/commit/49103dbc1d8bd4a611f0d6d971bc6b4b7d4a1311))
* **tasks:** enforce llm_checklist score↔assertions consistency + correct moltnet_pack_get arg shape ([0624ae1](https://github.com/getlarge/themoltnet/commit/0624ae1eea01e4b30d4b35c8cf1e033299b90c36))


### Performance Improvements

* **ci:** give rest-api:test a dedicated agent with 4 vitest threads ([c549d6e](https://github.com/getlarge/themoltnet/commit/c549d6ec570d52212c17cb234644f033359485dd))
* **ci:** switch orchestrator to test-ci, atomize rest-api per file ([156c01b](https://github.com/getlarge/themoltnet/commit/156c01b153029b6e68b1b2d598fc63137d90f746))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.7.0...agent-runtime-v0.8.0) (2026-05-05)


### Features

* **agent-runtime:** tighten task-type final-output prompts ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([3117f89](https://github.com/getlarge/themoltnet/commit/3117f891f514dce41f5903fe269043e787972082))
* **pi-extension:** namespace task provenance tags under task:*, expand list/search filters ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([253135b](https://github.com/getlarge/themoltnet/commit/253135b0a942c910010eedffbc59f5b48b33b657))
* structured task output via submit-tool + measurement ([#986](https://github.com/getlarge/themoltnet/issues/986)) ([2e86b87](https://github.com/getlarge/themoltnet/commit/2e86b87b0381833bb0747bf25bc708aba4fc3203))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.6.0...agent-runtime-v0.7.0) (2026-04-30)


### Features

* **runtime:** isolate agent-daemon task VM from local skills and diaries ([2b946bf](https://github.com/getlarge/themoltnet/commit/2b946bfaab8803f27b970ead60555fc30773f244))
* **runtime:** isolate agent-daemon task VM from local skills and diaries ([ed87b30](https://github.com/getlarge/themoltnet/commit/ed87b3007c3470e49290250a7e99fc62f9c9dbdf))
* **tasks:** make assess_brief run end-to-end + PR-complexity rubric ([c9db509](https://github.com/getlarge/themoltnet/commit/c9db5091c1f09af970d8afb014453ebd1f2a867c))


### Bug Fixes

* **tasks:** address PR [#957](https://github.com/getlarge/themoltnet/issues/957) review — assess-pr targets a real task; cleaner errors ([34d6ca6](https://github.com/getlarge/themoltnet/commit/34d6ca6f76418eb8ecbb5456f974fb0ebc2a0ed7))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/agent-runtime-v0.5.0...agent-runtime-v0.6.0) (2026-04-27)


### Features

* **agent-daemon:** add --debug flag for poll-source verbose logging ([cca6057](https://github.com/getlarge/themoltnet/commit/cca6057e66e572f81066e464bb2880a59a0236f9))
* **agent-runtime:** pino-based lifecycle logging for daemon ([3ee0305](https://github.com/getlarge/themoltnet/commit/3ee03053dbe62b7d4e9b1a1a76ef89cc59247d04))
* **agent-runtime:** unconditional pino lifecycle logging ([739595f](https://github.com/getlarge/themoltnet/commit/739595fc3183c4e3d25b90d14bfb21ec0fe6ff22))


### Bug Fixes

* **auth:** enrich logs with identityId; stop silent Keto error swallow ([95abd66](https://github.com/getlarge/themoltnet/commit/95abd66ef5d9554079992b1b6a90475a1256970a))

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
