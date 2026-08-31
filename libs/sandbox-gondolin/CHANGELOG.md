# Changelog

## [0.5.0](https://github.com/getlarge/themoltnet/compare/sandbox-gondolin-v0.4.0...sandbox-gondolin-v0.5.0) (2026-08-31)


### ⚠ BREAKING CHANGES

* **sandbox-gondolin:** remove VmConfig.testOnlyHttpRoutes and TestOnlyHttpRoute.

### Features

* **sandbox-gondolin:** productionize conformance findings ([40de081](https://github.com/getlarge/themoltnet/commit/40de0813556317c60cc92664714432a15bbfa3a2))
* **sandbox-gondolin:** productionize issue 2007 conformance findings ([e308b04](https://github.com/getlarge/themoltnet/commit/e308b04503c0cf10f15ccd9721ad91c0baf59c2d))
* **sandbox:** prove exact-origin credential delivery ([b143846](https://github.com/getlarge/themoltnet/commit/b143846ec11f8817df4395bdf60a214b43a2f149))
* **sandbox:** prove Gondolin exact-origin credential delivery ([5bdfe15](https://github.com/getlarge/themoltnet/commit/5bdfe1549f9d8f0d41b8d5b95996d12e23bae3d1))


### Bug Fixes

* **sandbox-gondolin:** make trailing-dot stripping linear ([f95ea32](https://github.com/getlarge/themoltnet/commit/f95ea32499ec2e88b836f247ea5af54ce0a39379))
* **sandbox:** address Gondolin credential-boundary review ([032281d](https://github.com/getlarge/themoltnet/commit/032281d4fd5db062f3814ef6ab665006cfe968d6))
* **sandbox:** preserve Gondolin IP pinning ([656a9fb](https://github.com/getlarge/themoltnet/commit/656a9fb58711b5eed1743b643e483c4db42bf615))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/sandbox-gondolin-v0.3.0...sandbox-gondolin-v0.4.0) (2026-08-26)


### Features

* **sandbox-gondolin:** enforce exact origins and managed exec ([f641178](https://github.com/getlarge/themoltnet/commit/f64117858d7a74689a7353e8b6a86604bc2e2b29))


### Bug Fixes

* **sandbox-gondolin:** ignore zombie-only process groups ([e2103ab](https://github.com/getlarge/themoltnet/commit/e2103ab02bc1ab92a9ec18213f8d8b221d9008f8))
* **sandbox-gondolin:** retire interrupted VMs ([5d4e2fa](https://github.com/getlarge/themoltnet/commit/5d4e2fac2c97abf463f37b9f241a3248f16e8ea1))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/sandbox-gondolin-v0.2.0...sandbox-gondolin-v0.3.0) (2026-08-25)


### Features

* **agent-runtime:** host capabilities with brokered agent signing ([268a56e](https://github.com/getlarge/themoltnet/commit/268a56e24c0b919cd2010be999b543ae20c975e1))
* **sandbox-gondolin:** host-origin transport, guest projection, service readiness ([891955d](https://github.com/getlarge/themoltnet/commit/891955d7f18431a9760c3f463a6b900083fc2638))


### Bug Fixes

* **sandbox-gondolin:** existence-guard .pi chown (E2E regression) and add PID-liveness readiness ([6efd965](https://github.com/getlarge/themoltnet/commit/6efd965e4901b624c57104626b7e790136478fd4))
* **sandbox-gondolin:** SSRF fail-closed origins, exit-checked setup, correct chown, concurrent readiness ([87c440e](https://github.com/getlarge/themoltnet/commit/87c440e64c0b17809e3d120debca063b71c0c298))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/sandbox-gondolin-v0.1.0...sandbox-gondolin-v0.2.0) (2026-08-22)


### Features

* **sandbox-gondolin:** broker destination-bound HTTP secrets ([95d155f](https://github.com/getlarge/themoltnet/commit/95d155fc8f413377a8f48c63a323cb1bb4061c68))
* **sandbox-gondolin:** broker destination-bound HTTP secrets ([e9411a5](https://github.com/getlarge/themoltnet/commit/e9411a5fba61aa38b95ab67c4c6e1af1bb7fb8d7)), closes [#1953](https://github.com/getlarge/themoltnet/issues/1953)


### Bug Fixes

* **runtime:** enforce brokered credential origin ([509a312](https://github.com/getlarge/themoltnet/commit/509a31240ef2da3eca11bbd8dcc63b7dccbaa21d))
* **sandbox-gondolin:** harden brokered secret boundary ([beecc0e](https://github.com/getlarge/themoltnet/commit/beecc0eec46df39965c2871d1a8d3d52a59693d5))
