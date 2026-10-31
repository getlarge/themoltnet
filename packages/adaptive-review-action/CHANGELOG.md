# Changelog

## [0.2.0](https://github.com/getlarge/themoltnet/compare/adaptive-review-action-v0.1.2...adaptive-review-action-v0.2.0) (2026-10-31)


### Features

* **adaptive-review:** investigate performance regressions ([780820b](https://github.com/getlarge/themoltnet/commit/780820b30e296d7ff89ff3b1777ad98cb1cd861b))
* **adaptive-review:** investigate performance regressions ([9485fc0](https://github.com/getlarge/themoltnet/commit/9485fc0497b9f3d77896f98b425ee07fc47077f3))
* **review:** add scoped diary context and preserve referenced findings ([3336013](https://github.com/getlarge/themoltnet/commit/3336013441d06ccad05b735433a82e37fec8a3f6))


### Bug Fixes

* **adaptive-review-action:** refresh released workflow runtime lock ([a951333](https://github.com/getlarge/themoltnet/commit/a951333cd61a36297a13a73a0159a41bcc13b1c1))
* **adaptive-review-action:** refresh workflow dependency runtime lock ([59fe52a](https://github.com/getlarge/themoltnet/commit/59fe52a88e349b239ef20f8bf93db55bb94b2026))
* **adaptive-review-action:** sync compatible daemon and action pins ([5aa08f1](https://github.com/getlarge/themoltnet/commit/5aa08f184734e29501a14f3af4e297da6b7114c1))
* **adaptive-review-action:** sync compatible daemon and action pins ([70e10b4](https://github.com/getlarge/themoltnet/commit/70e10b4614c55199b0ff9da2ef28926e2cdc2781))
* **adaptive-review:** align tests with rebased workspace conventions ([6960776](https://github.com/getlarge/themoltnet/commit/6960776fe1034bd497ac3ab350a3d7fb8f9f5b12))
* **adaptive-review:** preserve referenced concerns in summaries ([66a5827](https://github.com/getlarge/themoltnet/commit/66a5827589ce35450f99b6aa1a2d0298caac2420))
* **adaptive-review:** restore workflow pins and inferred CI tests ([ace4f98](https://github.com/getlarge/themoltnet/commit/ace4f98ba043ac4317cf799c04d7da4d7c685a9a))
* **adaptive-review:** retain performance finding history ([18284ff](https://github.com/getlarge/themoltnet/commit/18284ff696616e6ab16599692b3ef6bb2fc6dba5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-daemon bumped to 0.74.2
    * @themoltnet/pi-runtime bumped to 0.29.0

## [0.1.2](https://github.com/getlarge/themoltnet/compare/adaptive-review-action-v0.1.1...adaptive-review-action-v0.1.2) (2026-10-30)


### Bug Fixes

* **release:** refresh the adaptive-review runtime lock when syncing consumer pins ([05a8f74](https://github.com/getlarge/themoltnet/commit/05a8f740a31b779ac5a4d60970791c0485125c39))
* **release:** refresh the adaptive-review runtime lock when syncing consumer pins ([a0f603c](https://github.com/getlarge/themoltnet/commit/a0f603c37f14d74cd8e17986a6a9d376009daf7c))

## [0.1.1](https://github.com/getlarge/themoltnet/compare/adaptive-review-action-v0.1.0...adaptive-review-action-v0.1.1) (2026-10-30)


### Bug Fixes

* **adaptive-review:** give reruns prior finding context ([26a2f20](https://github.com/getlarge/themoltnet/commit/26a2f20480e22b6b8fffed86745d93de83c6473b))
* **adaptive-review:** label binary patches, skipped classifier, and footer accurately ([4796040](https://github.com/getlarge/themoltnet/commit/4796040ad72720b701a8766ed5a242524a7fca41))
* **adaptive-review:** label binary patches, skipped classifier, and footer accurately ([397a11b](https://github.com/getlarge/themoltnet/commit/397a11bfa0c2ddc67e2a988128cd1be25781598f))
* **adaptive-review:** preserve prior finding context across reruns ([e148d6b](https://github.com/getlarge/themoltnet/commit/e148d6bbfcf4b28a9a8a1dfc0f54ed92d698ff66))

## 0.1.0 (2026-10-30)


### Features

* **adaptive-review-action:** release the adaptive review under a major tag ([76be1ff](https://github.com/getlarge/themoltnet/commit/76be1ff4e1e758fb567435fdbf3f8d43327524a7))
* **adaptive-review-action:** release the adaptive review under a major tag ([9f26f17](https://github.com/getlarge/themoltnet/commit/9f26f17a65b6bfd0c8448b1f376e504861a00c3e))
* **adaptive-review:** record finding outcomes when a PR closes ([8c45fe5](https://github.com/getlarge/themoltnet/commit/8c45fe5794a72bd8dd412ebae417f21c04fdfe66))
* **adaptive-review:** record finding outcomes when a PR closes ([a5401e8](https://github.com/getlarge/themoltnet/commit/a5401e84c3796dc9f2fc9d1fff8437d7ec0d7310))


### Bug Fixes

* **adaptive-review-action:** exclude spec files from the lock and pin by SHA in docs ([e1865b5](https://github.com/getlarge/themoltnet/commit/e1865b5e9b006bfd769cabecbe9cde1f6c450f27))
* **adaptive-review:** make reruns reliable and expose incomplete coverage ([b3a805b](https://github.com/getlarge/themoltnet/commit/b3a805b0912b7ee313ceae585a7f9523cb753011))
* address review round 1 on adaptive review gates ([433d0a6](https://github.com/getlarge/themoltnet/commit/433d0a665613c89c5a9dd87bb92e759e59319acb)), closes [#2774](https://github.com/getlarge/themoltnet/issues/2774)
* **ci:** preserve adaptive review artifacts across reruns ([6887182](https://github.com/getlarge/themoltnet/commit/688718274dbcfabf73123a4bf61084e7019ddb8d))


### Performance Improvements

* **adaptive-review:** build the review action once per run ([2e8fa55](https://github.com/getlarge/themoltnet/commit/2e8fa55ad97bd20ba5acb9bc7fda84f877372ea9))
