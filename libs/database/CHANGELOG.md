# Changelog

## [0.10.1](https://github.com/getlarge/themoltnet/compare/database-v0.10.0...database-v0.10.1) (2026-09-12)


### Bug Fixes

* **database:** enforce unique personal teams ([66dfa44](https://github.com/getlarge/themoltnet/commit/66dfa4432ea02a1cd78b94db32779c68b70f3d23))
* **registration:** close serialization review gaps ([decde6b](https://github.com/getlarge/themoltnet/commit/decde6b8126f3f92b19fc81a4658185dd4302da9))
* **workflows:** serialise principal onboarding ([ee4ef0b](https://github.com/getlarge/themoltnet/commit/ee4ef0b8608693282cb53cc418ee33f8a72be3f7))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/database-v0.9.0...database-v0.10.0) (2026-09-12)


### Features

* add role-aware agent keys and agent aliases ([f16f7cf](https://github.com/getlarge/themoltnet/commit/f16f7cf2a985de29959717081412c44763a5eb82))
* **identity:** publish agent aliases through self profile ([7a1db5c](https://github.com/getlarge/themoltnet/commit/7a1db5cd0476c4a96d7d1f881bf475ce4acfee52))


### Bug Fixes

* **rest-api:** reserve agent alias writes for the primary credential ([4b03273](https://github.com/getlarge/themoltnet/commit/4b03273fbd2590152fe4bedae3616317bf695c52))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/database-v0.8.0...database-v0.9.0) (2026-09-09)


### Features

* **auth:** expose agentId on AgentPrincipal and fix creator lookups ([723e636](https://github.com/getlarge/themoltnet/commit/723e63688d82a648182cda3cae139e9f5ba92c37))
* **auth:** use internal principal IDs as Keto subjects ([9cdab23](https://github.com/getlarge/themoltnet/commit/9cdab23abd12adcc5d601742a70034da145f241f))
* **database:** give agents a fresh internal id instead of seeding from identity ([ac0c1d5](https://github.com/getlarge/themoltnet/commit/ac0c1d571bd769d6367199cc90583172547ec77f))
* **database:** make agents.id the internal primary key ([faae794](https://github.com/getlarge/themoltnet/commit/faae79407c53df5b69e7a187b2c3e5f5fd9d6113))
* **database:** rename agent_identity_id to agent_id in migration 0041 ([d94cc26](https://github.com/getlarge/themoltnet/commit/d94cc264b4ebe818ecb61edbb426d31a9af38958))
* decouple MoltNet principals from Ory Kratos identity IDs ([395823d](https://github.com/getlarge/themoltnet/commit/395823da4550fe66af2fc189b1bf3ef4fa6a464b))
* **rest-api:** create the agent before its Kratos identity in registration ([6f2d2ff](https://github.com/getlarge/themoltnet/commit/6f2d2fff6566e4c1e8ba5c493d6e7b9d1f23cb8a))


### Bug Fixes

* **auth,ory:** address review — conflated fixture, Hydra SSRF, wrong docs ([af7158e](https://github.com/getlarge/themoltnet/commit/af7158e5990c3ee7365d073e4f55c6458606d7da))
* **database:** drop agent foreign keys by discovered name in migration 0041 ([32e373e](https://github.com/getlarge/themoltnet/commit/32e373e81ee18ac2d6134fa5348c69342afae55d))
* **database:** give 0042 a timestamp after the migration it now follows ([b74ee4f](https://github.com/getlarge/themoltnet/commit/b74ee4f060a7d5dc204aef50222009d4f6e6d6b8))
* **database:** never rebind an agent on a fingerprint conflict ([ae13323](https://github.com/getlarge/themoltnet/commit/ae13323899745828d1f1056ac59d1ea1698584f4))
* **database:** reconcile the 0042 snapshot with its new base ([288d373](https://github.com/getlarge/themoltnet/commit/288d37347526ad7fcc01c81a4baae7de77d3c4fb))
* **database:** repoint diary_search's author join at agents.id ([5fb1f39](https://github.com/getlarge/themoltnet/commit/5fb1f39632726861078b1caef04e2211cf12c285))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/database-v0.7.0...database-v0.8.0) (2026-09-04)


### Features

* **runtime:** reconcile global model catalog ([5fc9d3e](https://github.com/getlarge/themoltnet/commit/5fc9d3ec0f9d30a548880876e991b82d629bc315))
* **runtime:** reconcile version-pinned provider catalog ([4be927b](https://github.com/getlarge/themoltnet/commit/4be927bda4e29b99b45786a9860ab9b4d27d5638))


### Bug Fixes

* **agent-daemon:** preserve enrollment roles and provider keys ([5cbfbeb](https://github.com/getlarge/themoltnet/commit/5cbfbebddeff78efb56e13cd8b326b2dd1977761))
* **agent-daemon:** support Safari loopback HTTPS ([b650d9a](https://github.com/getlarge/themoltnet/commit/b650d9a302ed35961de5bec56f0cf65bc8c4f676))
* **runtime:** handle optional visibility predicate ([d4c4e1d](https://github.com/getlarge/themoltnet/commit/d4c4e1dd594693dc421c24b6c34734acd28a4973))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/database-v0.6.0...database-v0.7.0) (2026-08-25)


### Features

* add executor team role ([e02be38](https://github.com/getlarge/themoltnet/commit/e02be38d318236d468af2c2ab3e3b677939b349f))
* **auth:** add executor role projections ([cc6507d](https://github.com/getlarge/themoltnet/commit/cc6507d4dff80645af35494a79ee69828ab2797b))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/database-v0.5.0...database-v0.6.0) (2026-08-19)


### Features

* **dbos:** harden durable workflow execution ([ca2a22c](https://github.com/getlarge/themoltnet/commit/ca2a22cb992c45802791b7e7a265badb9712311e))
* **rest-api:** contain production workflow history ([654abfd](https://github.com/getlarge/themoltnet/commit/654abfdc95d4d934c4e1d0305fc21c5bdb2d1092))


### Bug Fixes

* **database:** preserve first terminal task timestamp ([fd6a338](https://github.com/getlarge/themoltnet/commit/fd6a338e5b3602f7a5908c6f3bc2637646cb64aa))
* **dbos:** address workflow hardening review ([e87a2bb](https://github.com/getlarge/themoltnet/commit/e87a2bb834dda5cef4d5c188af515d4bd5646a2d))
* **retention:** satisfy CI and review feedback ([2173ccf](https://github.com/getlarge/themoltnet/commit/2173ccfb70195034779da250a69081e4cf1bc209))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/database-v0.4.0...database-v0.5.0) (2026-08-17)


### Features

* **tasks:** add Keto-backed task ownership ([5a86e87](https://github.com/getlarge/themoltnet/commit/5a86e87db9cac486316ab1e0eebac93425d248c1))
* **tasks:** enforce Keto-backed ownership ([8928352](https://github.com/getlarge/themoltnet/commit/8928352a7b10ecdd474406aa776e5b64024381f2))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/database-v0.3.0...database-v0.4.0) (2026-08-15)


### Features

* **packs:** serve the team catalog from GET /packs ([efc75b1](https://github.com/getlarge/themoltnet/commit/efc75b13de0c1c0704702a02745eaf8066180889))
* **packs:** serve the team catalog from GET /packs ([f3c328e](https://github.com/getlarge/themoltnet/commit/f3c328ed17738e39182a73820a1da083f0df5802))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/database-v0.2.0...database-v0.3.0) (2026-08-14)


### Features

* **auth:** implement signed registration core ([b6e477f](https://github.com/getlarge/themoltnet/commit/b6e477fb3a850fe68d1e297899d677dcc4bb7e64))
* **auth:** replace vouchers with signed registration ([2d39a41](https://github.com/getlarge/themoltnet/commit/2d39a418bb3558cd93eac0d3f05c53e9df5de34d))


### Bug Fixes

* **database:** cascade enrollments with team deletion ([d98ce6b](https://github.com/getlarge/themoltnet/commit/d98ce6b539eae01d3b9e6b7152aa269d3eae5a8b))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/database-v0.1.0...database-v0.2.0) (2026-08-07)


### Features

* **credentials:** pin task attempt authority ([1a3d11d](https://github.com/getlarge/themoltnet/commit/1a3d11d9bb312e2892613da096095c5e6030769f))
* **credentials:** pin task attempt authority ([bd95c83](https://github.com/getlarge/themoltnet/commit/bd95c837b7e1c1bfd791456636329433d2bf2cd7))
* **runtime-policy:** authorize scoped shell commands ([da43c3b](https://github.com/getlarge/themoltnet/commit/da43c3b684ae9803c377a38046b453dcb7c5093c))
* **runtime-policy:** persist scoped shell commands ([19ec9ec](https://github.com/getlarge/themoltnet/commit/19ec9ecb8aaed9da5d554ee42333b6e83bd840d5))


### Bug Fixes

* **credentials:** bind authority to executor manifests ([aa5f297](https://github.com/getlarge/themoltnet/commit/aa5f297f8a61f78aa85d0ab570654766287c09af))
* **credentials:** harden pinned task authority ([d09458f](https://github.com/getlarge/themoltnet/commit/d09458fdee943bcd32acf9606c811da3ef832653))
* **credentials:** pin scoped shell authority ([a06c705](https://github.com/getlarge/themoltnet/commit/a06c705a1edea62cb966ae97f0c0741ff0cda25c))
* **database:** consolidate task authority migration ([9a25d04](https://github.com/getlarge/themoltnet/commit/9a25d041e153e4ef549005cb5c35714f88e0e530))
* **database:** split task authority validation ([bbfae9b](https://github.com/getlarge/themoltnet/commit/bbfae9ba61a7c4de4cecf8ae452b3c05e9840260))
