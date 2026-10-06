# Changelog

## [0.4.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.3.4...agent-daemon-action-v0.4.0) (2026-10-06)


### Features

* **docs-impact-review:** configurable budgets and docs-first diff packing ([33ea6a5](https://github.com/getlarge/themoltnet/commit/33ea6a5d2a689ac6ef77e9a8f37e85246dbaf5d0))


### Bug Fixes

* **actions:** rebuild action bundles against main ([7d4aa1d](https://github.com/getlarge/themoltnet/commit/7d4aa1d7b4c739b0a73ef201d601f5d66b8aca23))

## [0.3.4](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.3.3...agent-daemon-action-v0.3.4) (2026-10-02)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.149.1

## [0.3.3](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.3.2...agent-daemon-action-v0.3.3) (2026-10-02)


### Bug Fixes

* **actions:** refresh action bundles ([63fca66](https://github.com/getlarge/themoltnet/commit/63fca66b8cc5cdb7117428851622e8cc594f491c))
* **actions:** refresh action bundles ([f21d258](https://github.com/getlarge/themoltnet/commit/f21d25815b976085b34eebd8622614bbaf117ae2))
* **ci:** refresh review action bundles after main update ([c2be13e](https://github.com/getlarge/themoltnet/commit/c2be13e986e9d3b289c67f2d51fd8a850182ab53))
* **release:** prepare bundles and Gondolin CLI pin on release PRs ([a434e27](https://github.com/getlarge/themoltnet/commit/a434e27a6d70b54e26971619e9d11890edad8938))
* **release:** prepare generated artifacts on release PRs ([49ff4d0](https://github.com/getlarge/themoltnet/commit/49ff4d0583b564650209831689cd47b4b9961189))
* **review:** use typed results for docs and complexity stages ([f67533d](https://github.com/getlarge/themoltnet/commit/f67533d7b4e270d8335c7200b0360d1e7b17ada7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.149.0

## [0.3.2](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.3.1...agent-daemon-action-v0.3.2) (2026-10-01)


### Bug Fixes

* **ci:** configure review providers independently of repository Pi files ([61d45cb](https://github.com/getlarge/themoltnet/commit/61d45cb67853c607172dc60034201c762f66a91f))
* **ci:** isolate workflow providers without changing agent runtime ([efee2c8](https://github.com/getlarge/themoltnet/commit/efee2c81be5d8a6c531ce2a33ee043aeb918dfd6))
* **review:** document provider setup with concrete examples ([bde5dec](https://github.com/getlarge/themoltnet/commit/bde5decdade668bd818a1b292f665fd5e22b4c82))
* **review:** require workflow-owned providers and resolve installed daemon version ([3ac69e3](https://github.com/getlarge/themoltnet/commit/3ac69e31e8745445501d1318cea5049bb4188b14))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sdk bumped to 0.148.0

## [0.3.1](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.3.0...agent-daemon-action-v0.3.1) (2026-09-30)


### Bug Fixes

* **agent-daemon-action:** skip mention dispatch in drain mode ([a1b79d0](https://github.com/getlarge/themoltnet/commit/a1b79d0977cd3fcead017dd5cbcd2d9e49192064))
* **agent-daemon-action:** skip mention dispatch in drain mode ([9592fc9](https://github.com/getlarge/themoltnet/commit/9592fc9f36b7ca044cd35a214f0b89cf604a1633))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.2.0...agent-daemon-action-v0.3.0) (2026-09-30)


### Features

* **agent-daemon-action:** configure model providers from a providers input ([cd8fd56](https://github.com/getlarge/themoltnet/commit/cd8fd56545c571ddcbcb3af70a111197e8e9214d))
* **agent-daemon-action:** configure model providers from a providers input ([4f9c4dc](https://github.com/getlarge/themoltnet/commit/4f9c4dcc16d4c0efed74e9e813bba6d0610bec85))


### Bug Fixes

* **agent-daemon-action:** harden the providers input against persistent stores ([c4a7cdb](https://github.com/getlarge/themoltnet/commit/c4a7cdb2f3bb5bbcce4079feb5584d2df0e2d708))
* **agent-daemon-action:** leave operator provider stores intact ([dffe7b9](https://github.com/getlarge/themoltnet/commit/dffe7b99d27db586a37ec6fb299e942077301558))
* **agent-daemon-action:** settle the providers input contract ([0d0309e](https://github.com/getlarge/themoltnet/commit/0d0309edc1fd707dfab50ea5669bdf97b0e4af2d))
* **release:** release GitHub Actions from one matrix job ([af8ee31](https://github.com/getlarge/themoltnet/commit/af8ee318f0fc108d29b52626201916eb0554c33d))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-action-v0.1.0...agent-daemon-action-v0.2.0) (2026-09-29)


### Features

* **agent-daemon-action:** enable KVM and cap drain polling backoff ([1b32e2b](https://github.com/getlarge/themoltnet/commit/1b32e2bce052b350df8791f1604be57ad6097eb5))
* **agent-daemon-action:** project-id input for project-scoped create and claim ([9cad79f](https://github.com/getlarge/themoltnet/commit/9cad79f1912ccf2734488640f08d23e6e903c4cf))
* **agent-daemon-action:** project-id input for project-scoped create and claim ([8243c56](https://github.com/getlarge/themoltnet/commit/8243c568d65427939f3c5c0ae021da258c0347b7))
* **review:** advisory docs-impact reviewer (app + CI workflow) ([4277715](https://github.com/getlarge/themoltnet/commit/427771527ae77a7cd1689959c45712ae9f2ad06c))


### Bug Fixes

* **agent-daemon-action:** normalise project-id whitespace across steps ([84860b8](https://github.com/getlarge/themoltnet/commit/84860b887b29b6fea2beac3f911883970d4fd84b))
* **release:** release agent-daemon-action with release-please ([30be511](https://github.com/getlarge/themoltnet/commit/30be5118667f7b5b3a57986e1417fc98952ad790))
* **release:** release agent-daemon-action with release-please ([28b8d16](https://github.com/getlarge/themoltnet/commit/28b8d169b32489993f76b315e5e4677ad9f15a78))
