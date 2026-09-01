# Changelog

## [0.13.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.12.2...pi-runtime-v0.13.0) (2026-09-01)


### Features

* **n8n:** add MoltNet Create and Wait community nodes ([89a4964](https://github.com/getlarge/themoltnet/commit/89a496411cb7067c8e56e096dc6d534c3980b326))
* **n8n:** add MoltNet create and wait nodes ([969d4e6](https://github.com/getlarge/themoltnet/commit/969d4e6c7fb9156e3147ab8403da9635923b8637))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.45.1
    * @themoltnet/sdk bumped to 0.139.0

## [0.12.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.12.1...pi-runtime-v0.12.2) (2026-08-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.45.0
    * @themoltnet/os-keyring bumped to 0.3.0
    * @themoltnet/sandbox-gondolin bumped to 0.5.0
    * @themoltnet/sdk bumped to 0.138.0

## [0.12.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.12.0...pi-runtime-v0.12.1) (2026-08-26)


### Bug Fixes

* **pi-runtime:** fail closed after Gondolin retirement ([7a379a1](https://github.com/getlarge/themoltnet/commit/7a379a16cdc3a199e7232761ee26c80ae3f3b7c1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sandbox-gondolin bumped to 0.4.0

## [0.12.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.11.0...pi-runtime-v0.12.0) (2026-08-25)


### Features

* **agent-runtime:** host capabilities with brokered agent signing ([268a56e](https://github.com/getlarge/themoltnet/commit/268a56e24c0b919cd2010be999b543ae20c975e1))
* **pi-runtime:** host-capability integration, daemon injection, docs ([b759cb4](https://github.com/getlarge/themoltnet/commit/b759cb43ac49805b5638074ab32992d908cc1156))


### Bug Fixes

* **pi-runtime:** evidence-sink fallback, policy/credential-aware signing instruction, README guest.files shape ([e1532cf](https://github.com/getlarge/themoltnet/commit/e1532cf2d30830975824ede38789f4140e697bfe))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.44.0
    * @themoltnet/sandbox-gondolin bumped to 0.3.0
    * @themoltnet/sdk bumped to 0.137.0

## [0.11.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.10.1...pi-runtime-v0.11.0) (2026-08-22)


### Features

* **pi-runtime:** resolve brokered secrets per attempt ([32e415e](https://github.com/getlarge/themoltnet/commit/32e415e6ff9d8121e385a0f0365af01ff6411346)), closes [#1953](https://github.com/getlarge/themoltnet/issues/1953)
* **sandbox-gondolin:** broker destination-bound HTTP secrets ([95d155f](https://github.com/getlarge/themoltnet/commit/95d155fc8f413377a8f48c63a323cb1bb4061c68))


### Bug Fixes

* **build:** bundle @moltnet/runtime-profiles declarations into published packages ([871b21a](https://github.com/getlarge/themoltnet/commit/871b21ac59e5d7a99f2bf5de174985dcade05da6)), closes [#1890](https://github.com/getlarge/themoltnet/issues/1890)
* **deps:** keep @moltnet/runtime-profiles a bundled devDependency in published packages ([ed96856](https://github.com/getlarge/themoltnet/commit/ed968566e589faaab02a13d83066ba0966fca3e2)), closes [#1890](https://github.com/getlarge/themoltnet/issues/1890)
* **lint:** merge duplicate imports introduced by the sandbox extraction merge ([2c2c9ef](https://github.com/getlarge/themoltnet/commit/2c2c9ef9cbe458bd5cf18cc9e6cca8588e4a77e9)), closes [#1890](https://github.com/getlarge/themoltnet/issues/1890)
* **pi-runtime:** bound brokered credential resolution ([37fb101](https://github.com/getlarge/themoltnet/commit/37fb10165f94e1aab8a241966037e23bf5e3c579))
* **pi-runtime:** make host credential boundary unconditional ([d58cabb](https://github.com/getlarge/themoltnet/commit/d58cabbf528fbf3d68149cb3f2ae8fe2315e399b))
* **pi-runtime:** stop promising guest credentials ([e18a8be](https://github.com/getlarge/themoltnet/commit/e18a8be9e4f598fa2a3a443ec71c538791a0a1a6))
* **runtime:** enforce brokered credential origin ([509a312](https://github.com/getlarge/themoltnet/commit/509a31240ef2da3eca11bbd8dcc63b7dccbaa21d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.43.2
    * @themoltnet/sandbox-gondolin bumped to 0.2.0
    * @themoltnet/sdk bumped to 0.136.0

## [0.10.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.10.0...pi-runtime-v0.10.1) (2026-08-19)


### Bug Fixes

* **build:** isolate JSON CID bundle imports ([5814a33](https://github.com/getlarge/themoltnet/commit/5814a33430cf2b37ca348b0d4805a6551d40532f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.43.1
    * @themoltnet/sdk bumped to 0.135.0

## [0.10.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.9.0...pi-runtime-v0.10.0) (2026-08-17)


### Features

* **tasks:** add Keto-backed task ownership ([5a86e87](https://github.com/getlarge/themoltnet/commit/5a86e87db9cac486316ab1e0eebac93425d248c1))


### Bug Fixes

* **runtime:** keep provenance denial recoverable ([3f8520a](https://github.com/getlarge/themoltnet/commit/3f8520a432e1308de2be7c8edd58ef3780aff4f6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.43.0
    * @themoltnet/sdk bumped to 0.134.0

## [0.9.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.8.0...pi-runtime-v0.9.0) (2026-08-14)


### Features

* **pi-runtime:** log policy decision provenance ([328025c](https://github.com/getlarge/themoltnet/commit/328025cf8bdce48a4553dbaf7437162e6f35ae9a))
* **pi-runtime:** record tool-policy decision provenance ([3f44efe](https://github.com/getlarge/themoltnet/commit/3f44efe28324adb90f4cab713df27b3ba798a53e))


### Bug Fixes

* **pi-runtime:** allow fresh packages in pack smoke ([713bf73](https://github.com/getlarge/themoltnet/commit/713bf73d8644ee4f4a243aa5a6c1e90f21305c44))
* **pi-runtime:** allow fresh packages in pack smoke ([0be2122](https://github.com/getlarge/themoltnet/commit/0be2122f72c7abfd2aa70859e4c4407c02f88b16))
* **pi-runtime:** harden policy provenance ([b94e62f](https://github.com/getlarge/themoltnet/commit/b94e62ffba3329817c690737a585a38937462cff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.42.0
    * @themoltnet/sdk bumped to 0.133.0

## [0.8.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.7.3...pi-runtime-v0.8.0) (2026-08-13)


### ⚠ BREAKING CHANGES

* **pi-runtime:** enforce explicit guest credential boundary
* **pi-runtime:** replace agentConfigMode required|optional with guestCredentialMode guest-config|host-authenticated.

### Features

* **daemon:** run agent-key workers without config files ([b3e4948](https://github.com/getlarge/themoltnet/commit/b3e49480235d856c5963d48d8f57700f9518b9c1))
* **pi-runtime:** support host-authenticated agents ([2d80edd](https://github.com/getlarge/themoltnet/commit/2d80edde4eac626e8f0adfe86dc35f91c184832a))


### Bug Fixes

* **pi-runtime:** enforce explicit guest credential boundary ([db22faa](https://github.com/getlarge/themoltnet/commit/db22faaacddfdefc2dc3c7dc9238883c5e2d01a9))
* **pi-runtime:** seal host-authenticated guest boundary ([e8aa6b1](https://github.com/getlarge/themoltnet/commit/e8aa6b11921d94ae350979f9f6f7264b9eb3cab0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.41.3
    * @themoltnet/sdk bumped to 0.132.0

## [0.7.3](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.7.2...pi-runtime-v0.7.3) (2026-08-13)


### Bug Fixes

* npm 12 compatibility for check-pack and smoke scripts ([09bef90](https://github.com/getlarge/themoltnet/commit/09bef90db57c4df31aac7ff564fa7c76b3801fd2))
* npm 12 compatibility for check-pack and smoke scripts ([c85644a](https://github.com/getlarge/themoltnet/commit/c85644a3750950bc29e71fb65206f8c2d4a1fbd8))
* use Node SDK entry for OS keyring secret resolution ([b17a1af](https://github.com/getlarge/themoltnet/commit/b17a1af5d4533a602eb84f1570df42a98bece97d))
* use Node SDK entry for OS keyring secret resolution ([3a303c5](https://github.com/getlarge/themoltnet/commit/3a303c54d64eb0660c2323be30b0b9240bd67fc2))

## [0.7.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.7.1...pi-runtime-v0.7.2) (2026-08-09)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.41.2
    * @themoltnet/sdk bumped to 0.131.0

## [0.7.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.7.0...pi-runtime-v0.7.1) (2026-08-09)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.41.1
    * @themoltnet/sdk bumped to 0.130.0

## [0.7.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.6.2...pi-runtime-v0.7.0) (2026-08-07)


### Features

* add task readiness telemetry and benchmark ([e843bb3](https://github.com/getlarge/themoltnet/commit/e843bb3ceef8c1e01889df3c8ba1355527fc4d10))
* **runtime:** trace task readiness phases ([d9cf527](https://github.com/getlarge/themoltnet/commit/d9cf52790dd2487983a44f7accbcc641df1bdabe))


### Bug Fixes

* **pi-runtime:** enforce readiness span hierarchy ([3e73bf4](https://github.com/getlarge/themoltnet/commit/3e73bf40f64b6db2f693186bbf0bda9d9d82075d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.41.0

## [0.6.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.6.1...pi-runtime-v0.6.2) (2026-08-01)


### Bug Fixes

* **runtime:** advertise Gondolin guest executables ([97e412a](https://github.com/getlarge/themoltnet/commit/97e412a579b590da7576b016e80226b2b97ebfff))
* **runtime:** advertise Gondolin guest executables ([0ba16e7](https://github.com/getlarge/themoltnet/commit/0ba16e75e29e9c9859c65dcb28cd464f2691d436))

## [0.6.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.6.0...pi-runtime-v0.6.1) (2026-08-01)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.40.1
    * @themoltnet/sdk bumped to 0.129.0

## [0.6.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.5.0...pi-runtime-v0.6.0) (2026-07-31)


### Features

* **review:** refactor multi-lens review into bounded topic graph ([9c124da](https://github.com/getlarge/themoltnet/commit/9c124da20835ae31169636bfec8c2f8773adfdfd))


### Bug Fixes

* **packaging:** derive published externals ([b623477](https://github.com/getlarge/themoltnet/commit/b623477cdce586cc1e098a3dc017efde0228efa0)), closes [#1794](https://github.com/getlarge/themoltnet/issues/1794) [#1795](https://github.com/getlarge/themoltnet/issues/1795)
* **packaging:** externalize published dependencies ([cc49eec](https://github.com/getlarge/themoltnet/commit/cc49eecac53a7681467487ee11b372c0c277fddf))
* **packaging:** preserve published dependency boundaries ([19db165](https://github.com/getlarge/themoltnet/commit/19db1657362a4743282196f504336ea853b9342c))
* **pi-runtime:** preserve analyzer wasm asset boundary ([f444d39](https://github.com/getlarge/themoltnet/commit/f444d39b8246606de7c30ebec1727eccabb96594))
* **pi-runtime:** recover submit validation in session ([b26980e](https://github.com/getlarge/themoltnet/commit/b26980ef996379d0cacfd831a72a4e473bba2cd5))
* **pi-runtime:** recover submit validation in the active session ([eaa2dfa](https://github.com/getlarge/themoltnet/commit/eaa2dfaa22750cee8d67df6434cef81dad5d809f))
* **review:** enforce trusted verdict contracts ([c7d94c9](https://github.com/getlarge/themoltnet/commit/c7d94c9f7bd68406d096b8dbd1dea390ac21fdc1))
* **runtime:** expose effective capabilities to tasks ([6545191](https://github.com/getlarge/themoltnet/commit/654519171a6ee07512d65eb3b37f227517aa8fba))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.40.0

## [0.5.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.4.0...pi-runtime-v0.5.0) (2026-07-30)


### Features

* **runtime:** project effective task capabilities ([207558e](https://github.com/getlarge/themoltnet/commit/207558e91fad1d1a75032572cc867966bd677a1e))
* **runtime:** project effective task capabilities ([a7d1773](https://github.com/getlarge/themoltnet/commit/a7d1773e1212c0b7491e048d9643fe972d771f11))


### Bug Fixes

* **runtime:** address capability review findings ([4620e3e](https://github.com/getlarge/themoltnet/commit/4620e3e0424690ad30d94a3993a5c3a1f9262338))
* **runtime:** harden task artifact scratch writes ([6aa4372](https://github.com/getlarge/themoltnet/commit/6aa437262d1788e9b9b66480ec85decc49bc3d28))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.39.1

## [0.4.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.3.0...pi-runtime-v0.4.0) (2026-07-29)


### Features

* **credentials:** pin task attempt authority ([1a3d11d](https://github.com/getlarge/themoltnet/commit/1a3d11d9bb312e2892613da096095c5e6030769f))
* **credentials:** pin task attempt authority ([bd95c83](https://github.com/getlarge/themoltnet/commit/bd95c837b7e1c1bfd791456636329433d2bf2cd7))


### Bug Fixes

* **credentials:** bind authority to executor manifests ([aa5f297](https://github.com/getlarge/themoltnet/commit/aa5f297f8a61f78aa85d0ab570654766287c09af))
* **credentials:** pin scoped shell authority ([a06c705](https://github.com/getlarge/themoltnet/commit/a06c705a1edea62cb966ae97f0c0741ff0cda25c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.39.0

## [0.3.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.2.0...pi-runtime-v0.3.0) (2026-07-29)


### Features

* **pi-runtime:** enforce scoped shell commands ([29a8831](https://github.com/getlarge/themoltnet/commit/29a88319eb2e8cbd30f9f744eca81e4dda83bf30))
* **runtime-policy:** authorize scoped shell commands ([da43c3b](https://github.com/getlarge/themoltnet/commit/da43c3b684ae9803c377a38046b453dcb7c5093c))
* **shell-analyzer:** surface invocation argv tokens ([277cd65](https://github.com/getlarge/themoltnet/commit/277cd6505a2976a46503b15ef78405f0f1af1d88))


### Bug Fixes

* **pi-runtime:** redact matched shell command prefixes ([d5e0f7c](https://github.com/getlarge/themoltnet/commit/d5e0f7ce2c0e08f9f5328db601dbec0efd6a1b8a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/shell-command-analyzer bumped to 0.3.0

## [0.2.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.1.0...pi-runtime-v0.2.0) (2026-07-29)


### Features

* **runtime:** make Pi capabilities operator-owned ([4b0dd11](https://github.com/getlarge/themoltnet/commit/4b0dd11c18ab7ff287bbbfc5abf42ebc84bff3e4))
* **runtime:** make Pi capabilities operator-owned ([87f47fc](https://github.com/getlarge/themoltnet/commit/87f47fc0dc2e07f0c83d53d312d2a09b18ecd582))


### Bug Fixes

* **runtime:** fail closed across profile v2 rollout ([6498319](https://github.com/getlarge/themoltnet/commit/649831998590fc61be0fcd1a81a5ac899fa22183))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.38.0
    * @themoltnet/sdk bumped to 0.128.0
