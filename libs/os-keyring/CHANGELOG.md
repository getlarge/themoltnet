# Changelog

## [0.3.0](https://github.com/getlarge/themoltnet/compare/os-keyring-v0.2.0...os-keyring-v0.3.0) (2026-08-31)


### Features

* **credentials:** Node secret provider write path ([#1833](https://github.com/getlarge/themoltnet/issues/1833), PR 1/4) ([3cf98f0](https://github.com/getlarge/themoltnet/commit/3cf98f0ab15abcb871879cbf7c96d5ee41681c5d))
* **os-keyring:** write, delete, and probe secrets in Go-compatible form ([3eca9cd](https://github.com/getlarge/themoltnet/commit/3eca9cdb32edd4ba75a78c3b4ffc67f26a0409b0))


### Bug Fixes

* **moltnet-cli:** find keytar-written Secret Service items on linux ([ddcaf6e](https://github.com/getlarge/themoltnet/commit/ddcaf6ee841bf3a1fa524370e99cc8aa106d2d5e))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/os-keyring-v0.1.0...os-keyring-v0.2.0) (2026-08-09)


### Features

* **cli:** add state-aware config migrations ([917e48e](https://github.com/getlarge/themoltnet/commit/917e48eafd0daef1690502636286f6258a5e89bf))


### Bug Fixes

* **ci:** launch package tools on Windows ([aee07dd](https://github.com/getlarge/themoltnet/commit/aee07dd6b8fa243f37d74efc80ba6a867c12e959))
* **ci:** make keyring checks hermetic ([646a160](https://github.com/getlarge/themoltnet/commit/646a16011465a3576e3e20354ef2091b4f7a0a16))
* **ci:** scope native keyring matrix with Nx ([28e9670](https://github.com/getlarge/themoltnet/commit/28e967090bcb6b0f931a99ef0da224ab4094f8ea))
* **credentials:** isolate cross-platform keyring access ([c5bf569](https://github.com/getlarge/themoltnet/commit/c5bf5691735d7ae54889dca651554d1753e3d853))
* **keyring:** align native provider contracts ([f4619e7](https://github.com/getlarge/themoltnet/commit/f4619e792f9167a9cb37140d5d6de610b596629d))
* **keyring:** stabilize native interoperability CI ([19b1763](https://github.com/getlarge/themoltnet/commit/19b1763a182434f004ee8dcbe63ba3a2b13e1e54))
* **keyring:** use native Windows keyring bindings ([8840cd6](https://github.com/getlarge/themoltnet/commit/8840cd6eeb1f38bb3c5672a15f5c6a39e0e9f3b3))
* **sdk:** load OS keyring providers lazily ([cb5765d](https://github.com/getlarge/themoltnet/commit/cb5765d57656576932105947fd7c90f6ecc3c067))
* **secrets:** harden provider boundaries ([704fe1d](https://github.com/getlarge/themoltnet/commit/704fe1d62fe5a9b3997a3bbca362955d91a144de))
* **secrets:** stabilize native keyring backends ([6eb529c](https://github.com/getlarge/themoltnet/commit/6eb529c8dc25444dfc6f35be421a9e54ec104191))
