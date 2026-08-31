# Changelog

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
