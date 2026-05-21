# Changelog

## [0.10.4](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.10.3...agent-daemon-v0.10.4) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.3
    * @themoltnet/pi-extension bumped to 0.19.4
    * @themoltnet/sdk bumped to 0.105.0

## [0.10.3](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.10.2...agent-daemon-v0.10.3) (2026-05-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.2
    * @themoltnet/pi-extension bumped to 0.19.3
    * @themoltnet/sdk bumped to 0.104.0

## [0.10.2](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.10.1...agent-daemon-v0.10.2) (2026-05-21)


### Bug Fixes

* **agent-daemon:** bound eval producer-context retention ([b8c1e16](https://github.com/getlarge/themoltnet/commit/b8c1e1646e82ec5ad831ff96e564b380e47d4edd))
* **agent-daemon:** judge from persisted producer context copy ([58d9bb1](https://github.com/getlarge/themoltnet/commit/58d9bb1e8583d5b1a08cadbf70cd3c8e3128be7a))
* **agent-daemon:** require live producer slot for judging ([59d8446](https://github.com/getlarge/themoltnet/commit/59d844671a2106876cbd5ff5541296cb292115bd))
* **pi-extension:** isolate judge scratch workspace copies ([b83e491](https://github.com/getlarge/themoltnet/commit/b83e4916576324d3f662fbc4d39a941281655eff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.1
    * @themoltnet/pi-extension bumped to 0.19.2

## [0.10.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.10.0...agent-daemon-v0.10.1) (2026-05-19)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.18.0
    * @themoltnet/pi-extension bumped to 0.19.1

## [0.10.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.9.0...agent-daemon-v0.10.0) (2026-05-18)


### Features

* **#943:** Phase 0 eval substrate dogfood — SDK, pi-extension, prompts, daemon, imposers ([5155fd7](https://github.com/getlarge/themoltnet/commit/5155fd7a3c3137d1d18d9203cefbb3d8082b79b4))
* **evals:** refresh legreffier scenarios and runner modes ([4f9a128](https://github.com/getlarge/themoltnet/commit/4f9a1282de40b03b84916c5217b54a2a7af15588))


### Bug Fixes

* **agent-daemon:** use local e2e fallback env in global setup ([41f3fe0](https://github.com/getlarge/themoltnet/commit/41f3fe0c6438249f7c9873c73a34cb485ecb45e3))
* **agent-runtime,agent-daemon:** explicit verification consequence + complete-rejection fallback ([d954209](https://github.com/getlarge/themoltnet/commit/d95420997eb4690615586eb22ffe149a9a76884e)), closes [#943](https://github.com/getlarge/themoltnet/issues/943)
* **ci:** restore agent-daemon typecheck ([017b713](https://github.com/getlarge/themoltnet/commit/017b713d4930ae7b5691c1159c7758c3b9bc0de4))
* **eval:** attach judges to producer context ([0af04e0](https://github.com/getlarge/themoltnet/commit/0af04e084799394f02b492f1cfa6c1b3cde53144))
* **eval:** harden local eval execution and judging ([3fb7a24](https://github.com/getlarge/themoltnet/commit/3fb7a24b599f9d7e02d4b0e880917b94937bd4db))
* **eval:** persist producer context for attempt judging ([5d000f6](https://github.com/getlarge/themoltnet/commit/5d000f633f9652792b56c2faaba88f3ddaca8998))
* **eval:** preserve producer workspaces for judging ([71b0b8a](https://github.com/getlarge/themoltnet/commit/71b0b8a39ac90f1c9587fe87d56b7a8de05acefe))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.17.0
    * @themoltnet/pi-extension bumped to 0.19.0
    * @themoltnet/sdk bumped to 0.103.0

## [0.9.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.8.0...agent-daemon-v0.9.0) (2026-05-16)


### Features

* add LeGreffier PR complexity review flow ([800cd4f](https://github.com/getlarge/themoltnet/commit/800cd4f23f01e22e903861910e2832ac806ef179))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.16.0
    * @themoltnet/pi-extension bumped to 0.18.1

## [0.8.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.7.0...agent-daemon-v0.8.0) (2026-05-15)


### Features

* **runtime:** surface setup and tool failures in task messages ([2070cf7](https://github.com/getlarge/themoltnet/commit/2070cf72e3b66d1ec8b6df500888734018907e46))


### Bug Fixes

* **agent-daemon:** repair dedicated warm-session worktree mounting ([d6051f9](https://github.com/getlarge/themoltnet/commit/d6051f915e2f51ac9963cb40012c3a2423def9e6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.2
    * @themoltnet/pi-extension bumped to 0.18.0

## [0.7.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.6.2...agent-daemon-v0.7.0) (2026-05-14)


### Features

* **agent-daemon:** persist Pi sessions for resumable tasks ([63f3cf6](https://github.com/getlarge/themoltnet/commit/63f3cf6ee59249f131bd324ec7c47aa2fcf484f8))
* **agent-daemon:** track reusable daemon slots ([42bc563](https://github.com/getlarge/themoltnet/commit/42bc563fce841b0dc175d722e5973ece545489de))
* **tasks:** add daemon session policy groundwork ([d6abb36](https://github.com/getlarge/themoltnet/commit/d6abb368106616c2cf9fc1383b24747b3441a07a))


### Bug Fixes

* **agent-daemon:** address PR review follow-up ([669eb77](https://github.com/getlarge/themoltnet/commit/669eb7715d39cbb200e2972243144c184fc43b5e))
* **agent-daemon:** remove regex slugifiers ([dc4190d](https://github.com/getlarge/themoltnet/commit/dc4190df608b62b4abab801fe5aa0d8055052b2f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/pi-extension bumped to 0.17.0

## [0.6.2](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.6.1...agent-daemon-v0.6.2) (2026-05-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.1
    * @themoltnet/pi-extension bumped to 0.16.2

## [0.6.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.6.0...agent-daemon-v0.6.1) (2026-05-12)


### Bug Fixes

* **agent-daemon:** auto-approve host exec in daemon mode ([465420c](https://github.com/getlarge/themoltnet/commit/465420cc1b8c73fbdfb8c46b10f60a12762e12ff))
* **agent-daemon:** auto-approve host exec in daemon mode ([31e77c7](https://github.com/getlarge/themoltnet/commit/31e77c75f9be550cc07a269cd91425ff533dcb19)), closes [#1123](https://github.com/getlarge/themoltnet/issues/1123)
* **agent-daemon:** start attempts before failure finalize ([2f65d1e](https://github.com/getlarge/themoltnet/commit/2f65d1e67ad786d3befce5a6d1593ab2ada71230))
* **agent-daemon:** start attempts before failure finalize ([c59677f](https://github.com/getlarge/themoltnet/commit/c59677ff2edfb2a86a174c3b48a3b231a2d1dcaa))
* **pi-extension:** scope host exec auto approval ([382c9af](https://github.com/getlarge/themoltnet/commit/382c9afe0b254101955895da9a547298836d12dc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/pi-extension bumped to 0.16.1

## [0.6.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.5.3...agent-daemon-v0.6.0) (2026-05-11)


### Features

* **agent-daemon:** --max-turns and --max-bash-timeouts caps ([#1094](https://github.com/getlarge/themoltnet/issues/1094) P1) ([fc5f7bd](https://github.com/getlarge/themoltnet/commit/fc5f7bd99f4578f9460a410faee5c6c89fbb3e15))


### Bug Fixes

* **daemon,pi-extension:** close VM on resume failure; close pino transport; TS narrowing (closes [#1107](https://github.com/getlarge/themoltnet/issues/1107)) ([7cd9bcf](https://github.com/getlarge/themoltnet/commit/7cd9bcf1e104dd766a29ba24c1d6171c40488a19))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/pi-extension bumped to 0.16.0

## [0.5.3](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.5.2...agent-daemon-v0.5.3) (2026-05-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.15.0
    * @themoltnet/pi-extension bumped to 0.15.2
    * @themoltnet/sdk bumped to 0.102.0

## [0.5.2](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.5.1...agent-daemon-v0.5.2) (2026-05-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.14.0
    * @themoltnet/pi-extension bumped to 0.15.1
    * @themoltnet/sdk bumped to 0.101.0

## [0.5.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.5.0...agent-daemon-v0.5.1) (2026-05-10)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.13.0
    * @themoltnet/pi-extension bumped to 0.15.0

## [0.5.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.4.0...agent-daemon-v0.5.0) (2026-05-10)


### Features

* **agent-daemon:** filter and refuse tasks not in allowedExecutors ([7560442](https://github.com/getlarge/themoltnet/commit/75604425c9dafceecf09168b8d9f4ac8eadea9fe))
* **daemon:** mirror task messages to local logger via onTurnEvent ([7607f2f](https://github.com/getlarge/themoltnet/commit/7607f2f8d97f4cf72db62a518fedef3e042ba20f))
* **daemon:** per-task onTurnEvent factory for poll mode (closes [#1078](https://github.com/getlarge/themoltnet/issues/1078)) ([db196cb](https://github.com/getlarge/themoltnet/commit/db196cba3a4214413779826183992ae6dcdd12e1))
* **pi-extension+daemon:** onTurnEvent callback mirrors task messages to local logger ([d24648e](https://github.com/getlarge/themoltnet/commit/d24648ef95a08792b02774331237210e76b4c53f))
* **pi-extension+daemon:** per-task onTurnEvent factory (closes [#1078](https://github.com/getlarge/themoltnet/issues/1078)) ([c7ae663](https://github.com/getlarge/themoltnet/commit/c7ae6632d446a554e92a2b25d8036c43b128a83f))
* **tasks:** add Task.allowedExecutors imposer policy + daemon filter ([6db33b4](https://github.com/getlarge/themoltnet/commit/6db33b4a47ecd72b57b2751ac52945391dda54c7))


### Bug Fixes

* **agent-daemon:** filter allowedExecutors at candidate level, not post-claim ([6f0d926](https://github.com/getlarge/themoltnet/commit/6f0d926f04dd5cae3f096cf65d89405ce9bf317d))
* **daemon:** address [#1074](https://github.com/getlarge/themoltnet/issues/1074) review (info-case truncation, exhaustive types, dedup) ([d9cbf88](https://github.com/getlarge/themoltnet/commit/d9cbf88159102d926589d39593dec524e8dc3ae8))
* **tasks:** address PR [#1075](https://github.com/getlarge/themoltnet/issues/1075) review ([913993b](https://github.com/getlarge/themoltnet/commit/913993b557d14b4677b6e8a3a4a79d223305feb1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.12.0
    * @themoltnet/pi-extension bumped to 0.14.0
    * @themoltnet/sdk bumped to 0.100.0

## [0.4.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.3.1...agent-daemon-v0.4.0) (2026-05-09)


### Features

* **agent-daemon:** SIGTERM/SIGINT handler in once.ts + workflow timeout-minutes ([4914d94](https://github.com/getlarge/themoltnet/commit/4914d94dbe12aec0af0b37226e248a3a22ea1d63))
* two-tier timeout (runner + server) for the dispatch path; [#1064](https://github.com/getlarge/themoltnet/issues/1064) review fixes ([517e84a](https://github.com/getlarge/themoltnet/commit/517e84a34066cd2ef3a453f0e66b35ee669bce89))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.11.0
    * @themoltnet/pi-extension bumped to 0.13.5

## [0.3.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.3.0...agent-daemon-v0.3.1) (2026-05-09)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/pi-extension bumped to 0.13.4

## [0.3.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.2.2...agent-daemon-v0.3.0) (2026-05-08)


### Features

* **agent-daemon:** add --debug flag for poll-source verbose logging ([cca6057](https://github.com/getlarge/themoltnet/commit/cca6057e66e572f81066e464bb2880a59a0236f9))
* **agent-daemon:** correlation anchor helpers (branch / trailer / PR body) ([7f56def](https://github.com/getlarge/themoltnet/commit/7f56deff7ab4d775ac091af81bde42d893aa7d88))
* **agent-daemon:** evaluate input.successCriteria before /complete ([912f2f1](https://github.com/getlarge/themoltnet/commit/912f2f1546e601ad53121d1e1cb522c0f790b721))
* **agent-daemon:** new app + polling source + GET /tasks/schemas ([317c399](https://github.com/getlarge/themoltnet/commit/317c39967c5bf27054bdb91df05c9465a46e0a45))
* **agent-daemon:** new app with poll/once/drain modes ([209c5b8](https://github.com/getlarge/themoltnet/commit/209c5b848f4869c5f3f5229fe76215af32ff4dd8))
* **agent-daemon:** plumb correlation anchor hook through finalize ([6b91944](https://github.com/getlarge/themoltnet/commit/6b9194454dcfd7a1b2bdf04c6e575e4dbd076d52))
* **agent-daemon:** publish to npm as @moltnet/agent-daemon ([03fa781](https://github.com/getlarge/themoltnet/commit/03fa7815d7461a33ed6c3830cb9fee023d63fe5c))
* **agent-daemon:** real --help, required identity flags, validate --task-types ([7c3abf4](https://github.com/getlarge/themoltnet/commit/7c3abf494c8fbed13232631c62665c9c9203bca9))
* **agent-daemon:** real --help, required identity flags, validate --task-types ([84a5290](https://github.com/getlarge/themoltnet/commit/84a5290cc4f0bbee98eb605f310a03be85d37150))
* **agent-daemon:** wire imposer-side cancellation through the daemon ([c7ef131](https://github.com/getlarge/themoltnet/commit/c7ef131cf7ff38efe74112b83727841570ace791))
* **agent-daemon:** wire pino root logger; replace console.error ([ca4bf33](https://github.com/getlarge/themoltnet/commit/ca4bf3395dedd9b781756313b67da9387e5621d1))
* **agent-daemon:** write moltnet-correlation marker to PR body on fulfill ([4faecd8](https://github.com/getlarge/themoltnet/commit/4faecd8be3bca54d3e1d3299370a6f9e1459d66c))
* **agent-runtime:** pino-based lifecycle logging for daemon ([3ee0305](https://github.com/getlarge/themoltnet/commit/3ee03053dbe62b7d4e9b1a1a76ef89cc59247d04))
* **build:** make SSR vite configs inferable via rolldownOptions.input ([9b71d6e](https://github.com/getlarge/themoltnet/commit/9b71d6e31c5ea60a4b1c54dc55466d6fdcdcb27f)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* **build:** unify e2e target across vitest and playwright suites ([9963cd6](https://github.com/getlarge/themoltnet/commit/9963cd6a70c2cbd77b01dda6c0ac41f8d9b78bfb)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* ship agent-daemon (npm + GH Action) with correlationId anchors ([a0b8f98](https://github.com/getlarge/themoltnet/commit/a0b8f98ef5dd14aaf5c3e4e6fb9e723b5cb570e2))
* **tasks:** make assess_brief actually run end-to-end via the daemon ([#951](https://github.com/getlarge/themoltnet/issues/951)) ([ebfcaeb](https://github.com/getlarge/themoltnet/commit/ebfcaeb97f8e6d78b3612c1516582dfd4f88cc7c))
* **tasks:** SuccessCriteria envelope, hard-cut criteria into input ([4448934](https://github.com/getlarge/themoltnet/commit/4448934e6598e4909c924799ed69f3bca5236b2d))


### Bug Fixes

* **agent-daemon-action:** require provider+model; migrate Pi packages to [@earendil-works](https://github.com/earendil-works) ([369d137](https://github.com/getlarge/themoltnet/commit/369d137cbc25100b3614d0c73eb174d306894a7d))
* **agent-daemon-action:** use correlationId, drop URL→correlation lookup ([a3b3291](https://github.com/getlarge/themoltnet/commit/a3b329149ea3fded5c57fd3986534b72acada09c))
* **agent-daemon-e2e:** stub output must satisfy CuratePackOutput schema ([47cb2a2](https://github.com/getlarge/themoltnet/commit/47cb2a2578efcafac497556304f4fdfe9df82829))
* **agent-daemon-e2e:** tighten cleanup, scope cancel test to robust assertions, retry initial heartbeat ([8a2f950](https://github.com/getlarge/themoltnet/commit/8a2f95025a0890adf26ada4c5fe248099d82a79d))
* **agent-daemon:** add non-watch cli script so --help and once exit cleanly ([a5d0407](https://github.com/getlarge/themoltnet/commit/a5d04070936cb7760c55e40beb777c8bfe1fccdd))
* **agent-daemon:** add non-watch cli script so --help and once exit cleanly ([b33beb0](https://github.com/getlarge/themoltnet/commit/b33beb060fadc4f99d534b558a8750e3f119f334))
* **agent-daemon:** apply [#958](https://github.com/getlarge/themoltnet/issues/958) review — typed locals, hasOwnProperty.call, tests ([c655f59](https://github.com/getlarge/themoltnet/commit/c655f59b2b3b0c7641d5ef021c223e746516f43f))
* **agent-daemon:** exclude e2e from unit test run; stub executors must call reporter.open ([16fce63](https://github.com/getlarge/themoltnet/commit/16fce632385ab611e0a9257fa91f609b0169583d))
* **agent-daemon:** resolve sandbox.json by searching up from cwd, accept --sandbox override ([55445d8](https://github.com/getlarge/themoltnet/commit/55445d83f9fc5391409c30626c6eea01f7f2d19b))
* **agent-runtime:** add per-task onTaskFinished hook so poll-mode finalizes tasks ([1bb1d04](https://github.com/getlarge/themoltnet/commit/1bb1d048ffe7bbdd069db7846bf89a4f25ddd716))
* **agent-runtime:** per-task onTaskFinished hook so poll-mode finalizes tasks ([49103db](https://github.com/getlarge/themoltnet/commit/49103dbc1d8bd4a611f0d6d971bc6b4b7d4a1311))
* **auth:** enrich logs with identityId; stop silent Keto error swallow ([95abd66](https://github.com/getlarge/themoltnet/commit/95abd66ef5d9554079992b1b6a90475a1256970a))
* **ci:** bypass nx in rest-api Dockerfile, drop agent-daemon build inference ([a248e0e](https://github.com/getlarge/themoltnet/commit/a248e0ebd1a46864d7856ccdd61aab677fd89111))
* **tasks:** address PR [#957](https://github.com/getlarge/themoltnet/issues/957) review — assess-pr targets a real task; cleaner errors ([34d6ca6](https://github.com/getlarge/themoltnet/commit/34d6ca6f76418eb8ecbb5456f974fb0ebc2a0ed7))
* **tasks:** correct stale cancel comments and tighten daemon cancel e2e after [#949](https://github.com/getlarge/themoltnet/issues/949) closed ([97b8027](https://github.com/getlarge/themoltnet/commit/97b802731606aff72b9cb9a36fc195ec88880fea))
* **tasks:** correct stale cancel comments and tighten daemon cancel e2e after [#949](https://github.com/getlarge/themoltnet/issues/949) closed ([9e2c00b](https://github.com/getlarge/themoltnet/commit/9e2c00b0b866211713298682fb917bfdeb660650))

## [0.2.2](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.2.1...agent-daemon-v0.2.2) (2026-05-08)


### Bug Fixes

* re-bundle to pick up `@themoltnet/pi-extension@0.13.2` snapshot fix (`linux-amd64` → `linux-x64` npm package naming, see [#1052](https://github.com/getlarge/themoltnet/pull/1052)). No source changes in `apps/agent-daemon`. Manually published — release-please does not propagate workspace dep bumps to the daemon.

## [0.2.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.2.0...agent-daemon-v0.2.1) (2026-05-08)


### Bug Fixes

* **agent-daemon-action:** require provider+model; migrate Pi packages to [@earendil-works](https://github.com/earendil-works) ([369d137](https://github.com/getlarge/themoltnet/commit/369d137cbc25100b3614d0c73eb174d306894a7d))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-v0.1.0...agent-daemon-v0.2.0) (2026-05-08)


### Features

* **agent-daemon:** add --debug flag for poll-source verbose logging ([cca6057](https://github.com/getlarge/themoltnet/commit/cca6057e66e572f81066e464bb2880a59a0236f9))
* **agent-daemon:** correlation anchor helpers (branch / trailer / PR body) ([7f56def](https://github.com/getlarge/themoltnet/commit/7f56deff7ab4d775ac091af81bde42d893aa7d88))
* **agent-daemon:** evaluate input.successCriteria before /complete ([912f2f1](https://github.com/getlarge/themoltnet/commit/912f2f1546e601ad53121d1e1cb522c0f790b721))
* **agent-daemon:** new app + polling source + GET /tasks/schemas ([317c399](https://github.com/getlarge/themoltnet/commit/317c39967c5bf27054bdb91df05c9465a46e0a45))
* **agent-daemon:** new app with poll/once/drain modes ([209c5b8](https://github.com/getlarge/themoltnet/commit/209c5b848f4869c5f3f5229fe76215af32ff4dd8))
* **agent-daemon:** plumb correlation anchor hook through finalize ([6b91944](https://github.com/getlarge/themoltnet/commit/6b9194454dcfd7a1b2bdf04c6e575e4dbd076d52))
* **agent-daemon:** publish to npm as @moltnet/agent-daemon ([03fa781](https://github.com/getlarge/themoltnet/commit/03fa7815d7461a33ed6c3830cb9fee023d63fe5c))
* **agent-daemon:** real --help, required identity flags, validate --task-types ([7c3abf4](https://github.com/getlarge/themoltnet/commit/7c3abf494c8fbed13232631c62665c9c9203bca9))
* **agent-daemon:** real --help, required identity flags, validate --task-types ([84a5290](https://github.com/getlarge/themoltnet/commit/84a5290cc4f0bbee98eb605f310a03be85d37150))
* **agent-daemon:** wire imposer-side cancellation through the daemon ([c7ef131](https://github.com/getlarge/themoltnet/commit/c7ef131cf7ff38efe74112b83727841570ace791))
* **agent-daemon:** wire pino root logger; replace console.error ([ca4bf33](https://github.com/getlarge/themoltnet/commit/ca4bf3395dedd9b781756313b67da9387e5621d1))
* **agent-daemon:** write moltnet-correlation marker to PR body on fulfill ([4faecd8](https://github.com/getlarge/themoltnet/commit/4faecd8be3bca54d3e1d3299370a6f9e1459d66c))
* **agent-runtime:** pino-based lifecycle logging for daemon ([3ee0305](https://github.com/getlarge/themoltnet/commit/3ee03053dbe62b7d4e9b1a1a76ef89cc59247d04))
* **build:** make SSR vite configs inferable via rolldownOptions.input ([9b71d6e](https://github.com/getlarge/themoltnet/commit/9b71d6e31c5ea60a4b1c54dc55466d6fdcdcb27f)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* **build:** unify e2e target across vitest and playwright suites ([9963cd6](https://github.com/getlarge/themoltnet/commit/9963cd6a70c2cbd77b01dda6c0ac41f8d9b78bfb)), closes [#1029](https://github.com/getlarge/themoltnet/issues/1029)
* ship agent-daemon (npm + GH Action) with correlationId anchors ([a0b8f98](https://github.com/getlarge/themoltnet/commit/a0b8f98ef5dd14aaf5c3e4e6fb9e723b5cb570e2))
* **tasks:** make assess_brief actually run end-to-end via the daemon ([#951](https://github.com/getlarge/themoltnet/issues/951)) ([ebfcaeb](https://github.com/getlarge/themoltnet/commit/ebfcaeb97f8e6d78b3612c1516582dfd4f88cc7c))
* **tasks:** SuccessCriteria envelope, hard-cut criteria into input ([4448934](https://github.com/getlarge/themoltnet/commit/4448934e6598e4909c924799ed69f3bca5236b2d))


### Bug Fixes

* **agent-daemon-action:** use correlationId, drop URL→correlation lookup ([a3b3291](https://github.com/getlarge/themoltnet/commit/a3b329149ea3fded5c57fd3986534b72acada09c))
* **agent-daemon-e2e:** stub output must satisfy CuratePackOutput schema ([47cb2a2](https://github.com/getlarge/themoltnet/commit/47cb2a2578efcafac497556304f4fdfe9df82829))
* **agent-daemon-e2e:** tighten cleanup, scope cancel test to robust assertions, retry initial heartbeat ([8a2f950](https://github.com/getlarge/themoltnet/commit/8a2f95025a0890adf26ada4c5fe248099d82a79d))
* **agent-daemon:** add non-watch cli script so --help and once exit cleanly ([a5d0407](https://github.com/getlarge/themoltnet/commit/a5d04070936cb7760c55e40beb777c8bfe1fccdd))
* **agent-daemon:** add non-watch cli script so --help and once exit cleanly ([b33beb0](https://github.com/getlarge/themoltnet/commit/b33beb060fadc4f99d534b558a8750e3f119f334))
* **agent-daemon:** apply [#958](https://github.com/getlarge/themoltnet/issues/958) review — typed locals, hasOwnProperty.call, tests ([c655f59](https://github.com/getlarge/themoltnet/commit/c655f59b2b3b0c7641d5ef021c223e746516f43f))
* **agent-daemon:** exclude e2e from unit test run; stub executors must call reporter.open ([16fce63](https://github.com/getlarge/themoltnet/commit/16fce632385ab611e0a9257fa91f609b0169583d))
* **agent-daemon:** resolve sandbox.json by searching up from cwd, accept --sandbox override ([55445d8](https://github.com/getlarge/themoltnet/commit/55445d83f9fc5391409c30626c6eea01f7f2d19b))
* **agent-runtime:** add per-task onTaskFinished hook so poll-mode finalizes tasks ([1bb1d04](https://github.com/getlarge/themoltnet/commit/1bb1d048ffe7bbdd069db7846bf89a4f25ddd716))
* **agent-runtime:** per-task onTaskFinished hook so poll-mode finalizes tasks ([49103db](https://github.com/getlarge/themoltnet/commit/49103dbc1d8bd4a611f0d6d971bc6b4b7d4a1311))
* **auth:** enrich logs with identityId; stop silent Keto error swallow ([95abd66](https://github.com/getlarge/themoltnet/commit/95abd66ef5d9554079992b1b6a90475a1256970a))
* **ci:** bypass nx in rest-api Dockerfile, drop agent-daemon build inference ([a248e0e](https://github.com/getlarge/themoltnet/commit/a248e0ebd1a46864d7856ccdd61aab677fd89111))
* **tasks:** address PR [#957](https://github.com/getlarge/themoltnet/issues/957) review — assess-pr targets a real task; cleaner errors ([34d6ca6](https://github.com/getlarge/themoltnet/commit/34d6ca6f76418eb8ecbb5456f974fb0ebc2a0ed7))
* **tasks:** correct stale cancel comments and tighten daemon cancel e2e after [#949](https://github.com/getlarge/themoltnet/issues/949) closed ([97b8027](https://github.com/getlarge/themoltnet/commit/97b802731606aff72b9cb9a36fc195ec88880fea))
* **tasks:** correct stale cancel comments and tighten daemon cancel e2e after [#949](https://github.com/getlarge/themoltnet/issues/949) closed ([9e2c00b](https://github.com/getlarge/themoltnet/commit/9e2c00b0b866211713298682fb917bfdeb660650))
