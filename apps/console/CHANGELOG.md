# Changelog

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
