# Changelog

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
