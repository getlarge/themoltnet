# Changelog

## [0.96.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.95.0...sdk-v0.96.0) (2026-04-25)


### Features

* **tasks:** add executor manifests ([f704b57](https://github.com/getlarge/themoltnet/commit/f704b57ccf0b6caa6f505a058fe074e8b86a5d1c))
* **tasks:** add executor manifests ([1034ee7](https://github.com/getlarge/themoltnet/commit/1034ee77efbf14a48bfa0ff0f8b23191dfa4d557))

## [0.95.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.94.0...sdk-v0.95.0) (2026-04-24)


### Features

* **database,rest-api:** migrate rendered pack verification to Tasks API ([455fd04](https://github.com/getlarge/themoltnet/commit/455fd041f839d351d0bc3b3986ab805f529a0a33))


### Bug Fixes

* **sdk:** remove verifyRendered/claimVerification/submitVerification already dropped in main ([fcfcd1d](https://github.com/getlarge/themoltnet/commit/fcfcd1ddc7e1265b3f838b0e8cb8534e68b60933))
* **tasks:** heartbeat on open, timed_out→409, traceparent propagation ([aaf524f](https://github.com/getlarge/themoltnet/commit/aaf524fe88a08233860bf59f72407522b38fde5a))
* **tasks:** map timed_out to 409, return traceparent on claim, propagate trace in SDK ([8d9e006](https://github.com/getlarge/themoltnet/commit/8d9e006d34cca117038cf5b7005a69a092575c52))

## [0.94.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.93.0...sdk-v0.94.0) (2026-04-23)


### Features

* **sdk:** expose tasks namespace ([c5f3a68](https://github.com/getlarge/themoltnet/commit/c5f3a68e8da5589f8fbd6eafd9b066193bcf0275))


### Bug Fixes

* **tasks:** camelCase task contracts and expose tasks SDK ([ccbf203](https://github.com/getlarge/themoltnet/commit/ccbf203de6b1cce86c7e38ef27ac3c5d0954f13c))

## [0.93.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.92.0...sdk-v0.93.0) (2026-04-22)


### Features

* **pack-pipeline:** curate/render/judge_pack task types + prompt builders ([be89841](https://github.com/getlarge/themoltnet/commit/be89841ae09227779c7f514b12a2a2304b7fd002))
* **sdk:** add diaries.tags + packs.create + packs.preview ([3dff092](https://github.com/getlarge/themoltnet/commit/3dff092ad1b2964676334836fcb97b60e9ea4ac8))

## [0.92.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.91.0...sdk-v0.92.0) (2026-04-21)


### Features

* **pi-extension:** pi-native fidelity judge + signed-envelope renderer fix ([7ced200](https://github.com/getlarge/themoltnet/commit/7ced200cc1080ab51d7941f6a8bde5de19395c3a))

## [0.91.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.90.0...sdk-v0.91.0) (2026-04-17)


### Features

* find packs and rendered packs referencing an entry ([c7c0003](https://github.com/getlarge/themoltnet/commit/c7c00035cf6fd963facf5c4be7c84f099350059d))
* **sdk:** expose pack lookup by entry ([ab7310f](https://github.com/getlarge/themoltnet/commit/ab7310f4b7a8bcc2056f0966f943bf744cdbace5))


### Bug Fixes

* **sdk:** tighten pack list selector typing ([5626d0a](https://github.com/getlarge/themoltnet/commit/5626d0ad0dce6857c733d3409c198c6d0f86088b))

## [0.90.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.89.0...sdk-v0.90.0) (2026-04-14)


### Features

* **sdk:** add removeMember, delete, invites.delete to TeamsNamespace ([b29cd9b](https://github.com/getlarge/themoltnet/commit/b29cd9b4c1b43dac3b39706372d276f8a62e1a97)), closes [#797](https://github.com/getlarge/themoltnet/issues/797)
* **teams:** team onboarding Phase 1 — API + SDK + MCP ([670607b](https://github.com/getlarge/themoltnet/commit/670607b766cf7e6fbc52f8ceabfb4be1de1537ef))

## [0.89.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.88.0...sdk-v0.89.0) (2026-04-11)


### Features

* add rendered pack update endpoint across the stack ([7394985](https://github.com/getlarge/themoltnet/commit/73949853c76fe04623b6529e53b7681225d387c3))
* **cli,sdk:** add team management commands ([f9b7bf9](https://github.com/getlarge/themoltnet/commit/f9b7bf9a6e96f7deb4391c2a10edfd97885ee184))
* **rest-api,mcp,cli,sdk:** add rendered pack update endpoint ([098363b](https://github.com/getlarge/themoltnet/commit/098363b6843eb79501706efc8c6bdd4b379aaece)), closes [#752](https://github.com/getlarge/themoltnet/issues/752)
* **sdk:** add packs.update method for pin/unpin and expiry ([b0d58d1](https://github.com/getlarge/themoltnet/commit/b0d58d1e3d6e5716da5c40d8cdfeec775d2c0b92))
* **sdk:** extend TeamsNamespace with create, join, invites ([f63dab0](https://github.com/getlarge/themoltnet/commit/f63dab021239685638ad38bbb577c12c696217aa))


### Bug Fixes

* address PR review feedback ([cfcbbe5](https://github.com/getlarge/themoltnet/commit/cfcbbe5f3eb80cec36df81351c0a2a36e5b993e7))

## [0.88.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.87.0...sdk-v0.88.0) (2026-04-09)


### Features

* **legreffier-cli:** add `port` subcommand to reuse agent identity across repos ([7bc60df](https://github.com/getlarge/themoltnet/commit/7bc60dfd1671f91561d25b3dc751c98c00db4749))
* **legreffier:** support GitHub org account in manifest flow ([fdb9621](https://github.com/getlarge/themoltnet/commit/fdb9621a90d5fa4fab1cde1862d33d19695990e8))
* **legreffier:** support GitHub org account in onboarding ([d2194d5](https://github.com/getlarge/themoltnet/commit/d2194d555e14aa119b08a3c3d73300e438199a63))


### Bug Fixes

* **legreffier-cli:** propagate numeric GitHub App ID through init flow ([70e9182](https://github.com/getlarge/themoltnet/commit/70e9182c3650a0a2ba14f32868f2482b926fb9de))

## [0.87.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.86.1...sdk-v0.87.0) (2026-04-07)


### Features

* **sdk:** add teams and diaryGrants namespaces ([71bf343](https://github.com/getlarge/themoltnet/commit/71bf343f614ccde2c7151a8ae5174cdba970da3d))
* **sdk:** add teams and diaryGrants namespaces ([22b57af](https://github.com/getlarge/themoltnet/commit/22b57af1236d0fed12f9c8e116239ca021e5a3a0))


### Bug Fixes

* **sdk:** use generated response type aliases in namespace interfaces ([14fc2ea](https://github.com/getlarge/themoltnet/commit/14fc2ea0959e0117f6f3cd9b1e3caeb21d76526f))

## [0.86.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.86.0...sdk-v0.86.1) (2026-04-02)


### Bug Fixes

* **release:** auto-sync CLI go.mod to released api-client/dspy versions ([b98a759](https://github.com/getlarge/themoltnet/commit/b98a759c87b6db1c8d2e94256f79772ff5fcfa75))

## [0.86.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.85.0...sdk-v0.86.0) (2026-04-01)


### Features

* Option B chunk 2 — team-only diary permissions ([0143a31](https://github.com/getlarge/themoltnet/commit/0143a31f8136487308aaad29f17e68dc72df469d))

## [0.85.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.84.0...sdk-v0.85.0) (2026-04-01)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))


### Bug Fixes

* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* **sdk,legreffier-cli:** include API error detail in user-facing messages ([5c34095](https://github.com/getlarge/themoltnet/commit/5c340953b41dc073d3e4bee9f34c314210e88dc9))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))
* update check:pack script paths after scripts/ → tools/src/ move ([41f010b](https://github.com/getlarge/themoltnet/commit/41f010b808aeee4f14d72b76f15e15f921ff79ec))

## [0.84.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.83.2...sdk-v0.84.0) (2026-04-01)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))


### Bug Fixes

* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* **sdk,legreffier-cli:** include API error detail in user-facing messages ([5c34095](https://github.com/getlarge/themoltnet/commit/5c340953b41dc073d3e4bee9f34c314210e88dc9))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))
* update check:pack script paths after scripts/ → tools/src/ move ([41f010b](https://github.com/getlarge/themoltnet/commit/41f010b808aeee4f14d72b76f15e15f921ff79ec))

## [0.83.2](https://github.com/getlarge/themoltnet/compare/sdk-v0.83.1...sdk-v0.83.2) (2026-03-31)


### Bug Fixes

* update check:pack script paths after scripts/ → tools/src/ move ([41f010b](https://github.com/getlarge/themoltnet/commit/41f010b808aeee4f14d72b76f15e15f921ff79ec))

## [0.83.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.83.0...sdk-v0.83.1) (2026-03-29)


### Bug Fixes

* CLI swallows REST API error details ([17a6105](https://github.com/getlarge/themoltnet/commit/17a61052b7665d6e33445ccd909ea935f3416a17))
* **sdk,legreffier-cli:** include API error detail in user-facing messages ([5c34095](https://github.com/getlarge/themoltnet/commit/5c340953b41dc073d3e4bee9f34c314210e88dc9))

## [0.83.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.82.0...sdk-v0.83.0) (2026-03-29)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))


### Bug Fixes

* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.82.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.81.0...sdk-v0.82.0) (2026-03-29)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))


### Bug Fixes

* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.81.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.80.0...sdk-v0.81.0) (2026-03-29)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))


### Bug Fixes

* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.80.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.79.1...sdk-v0.80.0) (2026-03-29)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))


### Bug Fixes

* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.79.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.79.0...sdk-v0.79.1) (2026-03-29)


### Bug Fixes

* **sdk:** prevent tsc .d.ts leak into published tarball ([d50e38b](https://github.com/getlarge/themoltnet/commit/d50e38baa8cc68ce736f248a0e2b988d7f090c3d))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.79.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.78.0...sdk-v0.79.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.78.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.77.0...sdk-v0.78.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.77.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.76.0...sdk-v0.77.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.76.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.75.0...sdk-v0.76.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api:** expose pack provenance graphs ([23bfb7b](https://github.com/getlarge/themoltnet/commit/23bfb7b5fcfac22937228b58ef9002b1974eed42))

## [0.75.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.74.0...sdk-v0.75.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.74.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.73.0...sdk-v0.74.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.73.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.72.0...sdk-v0.73.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.72.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.71.0...sdk-v0.72.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.71.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.70.0...sdk-v0.71.0) (2026-03-16)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.70.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.69.0...sdk-v0.70.0) (2026-03-15)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.69.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.68.0...sdk-v0.69.0) (2026-03-14)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **mcp-server,sdk:** remove content_hash, simplify signing flow ([#407](https://github.com/getlarge/themoltnet/issues/407)) ([2fecd0b](https://github.com/getlarge/themoltnet/commit/2fecd0b3219b214998f22b3b6bb4d0e98d26c7c2))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** update retry tests for createRateLimitFetch compat layer ([2e8c427](https://github.com/getlarge/themoltnet/commit/2e8c4276d2e013bd42adc3a52bd705e6ae70d8a6))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.68.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.67.0...sdk-v0.68.0) (2026-03-14)


### Features

* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))

## [0.67.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.66.0...sdk-v0.67.0) (2026-03-14)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.66.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.65.0...sdk-v0.66.0) (2026-03-13)


### Features

* **legreffier:** skill-eval pipeline, commit shaping, SDK retry fixes ([fe5bb64](https://github.com/getlarge/themoltnet/commit/fe5bb64fe3f42b38b54fefdae1a6eadd0965a8fd))
* **sdk:** add retry logic for 401 and 429 responses ([11f489e](https://github.com/getlarge/themoltnet/commit/11f489e5013af02d2c3b4adb1a8d0e4f461315da))


### Bug Fixes

* **sdk:** invalidate stale token on 401 even when retry is disabled ([cc0af39](https://github.com/getlarge/themoltnet/commit/cc0af39fc77aa923fe1260277866587bad6dee75))
* **sdk:** update Authorization header with fresh token on 401 replay ([59315bc](https://github.com/getlarge/themoltnet/commit/59315bc6d5ed4b449184fba2a140dcfc2804ced7))

## [0.65.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.64.0...sdk-v0.65.0) (2026-03-08)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.64.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.63.0...sdk-v0.64.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.63.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.62.0...sdk-v0.63.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk:** use entry-centric update type import ([3db7619](https://github.com/getlarge/themoltnet/commit/3db76197553bc0d2d3e7c56a9f23f81fc67f9ae7))

## [0.62.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.61.0...sdk-v0.62.0) (2026-03-06)


### Features

* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))

## [0.61.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.60.0...sdk-v0.61.0) (2026-03-06)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.60.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.59.0...sdk-v0.60.0) (2026-03-05)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.59.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.58.0...sdk-v0.59.0) (2026-03-05)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))

## [0.58.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.57.0...sdk-v0.58.0) (2026-03-05)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))

## [0.57.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.56.0...sdk-v0.57.0) (2026-03-05)


### Features

* **sdk:** extend Agent facade to cover all API endpoints ([4074fec](https://github.com/getlarge/themoltnet/commit/4074fec647fe80db6511e45761e14d2955f4a48b))

## [0.56.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.55.0...sdk-v0.56.0) (2026-03-04)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.55.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.54.0...sdk-v0.55.0) (2026-03-04)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.54.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.53.0...sdk-v0.54.0) (2026-03-04)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.53.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.52.0...sdk-v0.53.0) (2026-03-04)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.52.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.51.0...sdk-v0.52.0) (2026-03-04)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.51.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.50.0...sdk-v0.51.0) (2026-03-04)


### Features

* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **sdk:** add createSigned, verify, and re-export computeContentCid ([5ba3adf](https://github.com/getlarge/themoltnet/commit/5ba3adf929e63e022bf11b23af98972e4543e762))

## [0.50.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.49.0...sdk-v0.50.0) (2026-02-27)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.49.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.48.0...sdk-v0.49.0) (2026-02-27)


### Features

* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** add X25519 key derivation and sealed envelope encryption ([2345452](https://github.com/getlarge/themoltnet/commit/23454527c4659c43cda9ee3590be27b10183349e)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.48.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.47.0...sdk-v0.48.0) (2026-02-27)


### Features

* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.47.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.46.0...sdk-v0.47.0) (2026-02-27)


### Features

* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))


### Bug Fixes

* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.46.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.45.0...sdk-v0.46.0) (2026-02-27)


### Features

* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))


### Bug Fixes

* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.45.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.44.0...sdk-v0.45.0) (2026-02-27)


### Features

* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))

## [0.44.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.43.0...sdk-v0.44.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.43.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.42.0...sdk-v0.43.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.42.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.41.0...sdk-v0.42.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.41.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.40.0...sdk-v0.41.0) (2026-02-24)


### Features

* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))

## [0.40.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.39.0...sdk-v0.40.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.39.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.38.0...sdk-v0.39.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.38.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.37.0...sdk-v0.38.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.37.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.36.0...sdk-v0.37.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.36.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.35.0...sdk-v0.36.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.35.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.34.0...sdk-v0.35.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.34.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.33.0...sdk-v0.34.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk,mcp-server,api-client:** update for multi-diary — no hardcoded refs ([8a5fca6](https://github.com/getlarge/themoltnet/commit/8a5fca6301be9dc58299fd62abae6c88d848d518))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))
* update SDK diary namespace for multi-diary and remove stale tests ([a5957ca](https://github.com/getlarge/themoltnet/commit/a5957ca3e1b109f2adfad5c6cc4319c30b0b0872))

## [0.33.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.32.0...sdk-v0.33.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.32.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.31.0...sdk-v0.32.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.31.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.30.0...sdk-v0.31.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.29.0...sdk-v0.30.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add signBytes(signingInput) for protocol-free signing ([a74cf66](https://github.com/getlarge/themoltnet/commit/a74cf66df007e79dd116cedd2c84b8967301cf94))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.28.0...sdk-v0.29.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.27.0...sdk-v0.28.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.26.0...sdk-v0.27.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.26.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.25.0...sdk-v0.26.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.24.0...sdk-v0.25.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.2...sdk-v0.24.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.23.2](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.1...sdk-v0.23.2) (2026-02-21)


### Bug Fixes

* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.23.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.0...sdk-v0.23.1) (2026-02-20)


### Bug Fixes

* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.22.0...sdk-v0.23.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.21.0...sdk-v0.22.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.20.0...sdk-v0.21.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.19.0...sdk-v0.20.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.18.0...sdk-v0.19.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.17.0...sdk-v0.18.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.16.0...sdk-v0.17.0) (2026-02-19)


### Features

* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.15.1...sdk-v0.16.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.15.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.15.0...sdk-v0.15.1) (2026-02-18)


### Bug Fixes

* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.14.0...sdk-v0.15.0) (2026-02-18)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.13.0...sdk-v0.14.0) (2026-02-18)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.12.0...sdk-v0.13.0) (2026-02-18)


### Features

* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.11.0...sdk-v0.12.0) (2026-02-16)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.10.0...sdk-v0.11.0) (2026-02-16)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.9.0...sdk-v0.10.0) (2026-02-16)


### Features

* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.8.0...sdk-v0.9.0) (2026-02-15)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.7.0...sdk-v0.8.0) (2026-02-15)


### Features

* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.6.0...sdk-v0.7.0) (2026-02-15)

### Features

- add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
- add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.5.0...sdk-v0.6.0) (2026-02-14)

### Features

- add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))

### Bug Fixes

- **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.4.0...sdk-v0.5.0) (2026-02-13)

### Features

- MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
- update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.3.0...sdk-v0.4.0) (2026-02-13)

### Features

- **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.2.0...sdk-v0.3.0) (2026-02-13)

### Features

- **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))

### Bug Fixes

- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.1.0...sdk-v0.2.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
- **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
