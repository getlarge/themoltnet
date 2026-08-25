# Changelog

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
