# Changelog

## [0.9.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.8.0...mcp-server-v0.9.0) (2026-06-24)


### Features

* **sdk:** expose team context as { teamId } option across SDK and consumers ([f9bab47](https://github.com/getlarge/themoltnet/commit/f9bab47934f4859fb26a9ea9a5538529d95ca48c))
* **sdk:** standardize team context on x-moltnet-team-id header (RFC [#1440](https://github.com/getlarge/themoltnet/issues/1440), closes [#1381](https://github.com/getlarge/themoltnet/issues/1381)) ([39e1314](https://github.com/getlarge/themoltnet/commit/39e13140883cdc293f608a0d1514e91e913a4428))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.7.0...mcp-server-v0.8.0) (2026-06-22)


### Features

* **mcp-server:** remove identity/soul diary-entry profile mechanism ([#1401](https://github.com/getlarge/themoltnet/issues/1401)) ([1487a4b](https://github.com/getlarge/themoltnet/commit/1487a4b6f02600c140727a13a4b51a7f108eab1b))
* **mcp-server:** remove identity/soul diary-entry profile mechanism ([#1401](https://github.com/getlarge/themoltnet/issues/1401)) ([1a807ae](https://github.com/getlarge/themoltnet/commit/1a807aee71a0939e0b1171179d0abb6142ef8c65))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.6.0...mcp-server-v0.7.0) (2026-06-19)


### Features

* **#1293:** fork continuation mode + refcounted daemon workspaces ([5266f3b](https://github.com/getlarge/themoltnet/commit/5266f3bedfe9fe2a6cc79cc873db87cc5600bda4))
* **tasks:** accept fork continuation mode end-to-end ([b2d4558](https://github.com/getlarge/themoltnet/commit/b2d45589325c4fb7cb264d56bf9a5f01b3ca6500))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.5.0...mcp-server-v0.6.0) (2026-06-14)


### Features

* **runtime:** rename daemon profiles API ([34bcb0a](https://github.com/getlarge/themoltnet/commit/34bcb0ada331505f8c86e09f3bf790207f862894))
* **runtime:** rename daemon profiles API ([b246f9c](https://github.com/getlarge/themoltnet/commit/b246f9c75b987db0a89eadceedb535489dba4d3e))


### Bug Fixes

* **ci:** sync runtime profile generated artifacts ([5083134](https://github.com/getlarge/themoltnet/commit/5083134f07934e016e6655ab93f39f03b0c722fd))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.4.3...mcp-server-v0.5.0) (2026-06-12)


### Features

* add daemon runtime profiles API ([09fde86](https://github.com/getlarge/themoltnet/commit/09fde86ef321d9739740047404c5fa0f12c49442))
* **tasks:** replace executor allowlists with profiles ([5341e5f](https://github.com/getlarge/themoltnet/commit/5341e5fe5e6023431d8d3f71db1c0c0902c2ff98))

## [0.4.3](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.4.2...mcp-server-v0.4.3) (2026-06-11)


### Bug Fixes

* migrate schemas to typebox v1 ([615ffa7](https://github.com/getlarge/themoltnet/commit/615ffa7927cf60f730840e3e07c92f756413449b))
* migrate schemas to TypeBox v1 ([565d3e5](https://github.com/getlarge/themoltnet/commit/565d3e5f93c19dff75dbcf76dce4a36d37a42f2c))

## [0.4.2](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.4.1...mcp-server-v0.4.2) (2026-06-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 0.9.0

## [0.4.1](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.4.0...mcp-server-v0.4.1) (2026-06-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 0.8.0

## [0.4.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.3.0...mcp-server-v0.4.0) (2026-06-05)


### Features

* **mcp-server:** tasks_continue tool (client-side composition) ([59661cb](https://github.com/getlarge/themoltnet/commit/59661cb2a37e00cd8d4bdc48b9afec143b7897e2)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)


### Bug Fixes

* **ci:** regenerate Go api-client + add verification to MCP e2e completion ([aaca26c](https://github.com/getlarge/themoltnet/commit/aaca26c22a63584f74bbacaf9739c8859cf3ffc8)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)
* **tasks:** pre-merge review fixes for PR [#1307](https://github.com/getlarge/themoltnet/issues/1307) ([71db8ac](https://github.com/getlarge/themoltnet/commit/71db8ac6956516dbf571c438d728f16e0eeb2907)), closes [#1287](https://github.com/getlarge/themoltnet/issues/1287)

## [0.3.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.2.0...mcp-server-v0.3.0) (2026-05-26)


### Features

* **tasks:** add conditional claimability ([78bb795](https://github.com/getlarge/themoltnet/commit/78bb795ef4c4d88d8b192e1a998c16ce3b831870))
* **tasks:** add conditional claimability ([580161f](https://github.com/getlarge/themoltnet/commit/580161f6d84862e85b7b1d56887ff45f2732a0cf))


### Bug Fixes

* **ci:** refresh generated task contracts ([413618b](https://github.com/getlarge/themoltnet/commit/413618bda46a220fba8dd111ba4ec5291836e37e))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/mcp-server-v0.1.0...mcp-server-v0.2.0) (2026-05-26)


### Features

* **mcp-server:** expose allowed_executors on tasks_create ([2380879](https://github.com/getlarge/themoltnet/commit/2380879365aa5ee4a7e92d6cb945629387be90b4))
* **mcp-server:** persist MCP sessions in Redis ([34ff2a9](https://github.com/getlarge/themoltnet/commit/34ff2a9f2684e5f8c7a40727d7b84037415ae915))
* **mcp-server:** persist sessions in redis ([1d6dad5](https://github.com/getlarge/themoltnet/commit/1d6dad58b58566b1cbf842b9ae8ba60b9c883fb3))
* **mcp-server:** register entries_map_open app + e2e ([1d958eb](https://github.com/getlarge/themoltnet/commit/1d958eb325fc5301d6cdfef045f2440df63d40a2))
* **mcp:** human-first diary map exploration app (rebuild [#1194](https://github.com/getlarge/themoltnet/issues/1194), supersedes [#1212](https://github.com/getlarge/themoltnet/issues/1212)) ([aced830](https://github.com/getlarge/themoltnet/commit/aced8306d7d9ca72165ad47e51ff74100f8cbf31))
* version deployable app contracts ([b8251ff](https://github.com/getlarge/themoltnet/commit/b8251ffa41fe2c67d76dfcc5e22bed2f7006e80a))


### Bug Fixes

* **ci:** stabilize MCP app lint and tests ([94b5a80](https://github.com/getlarge/themoltnet/commit/94b5a80b4b013f84723f56512470e9dc3c11e9bf))
* **docker:** skip nx sync during deploy packaging ([15a6910](https://github.com/getlarge/themoltnet/commit/15a6910f7dae541bc21610c970aaac7f84fd4bb0))
* **docker:** stop using nx in MCP image builds ([2d33336](https://github.com/getlarge/themoltnet/commit/2d33336b8369da11f905a52e8740669801f73c41))
* **entries_map_open:** typed Zone schema so agent entry_ids reach the app ([a641c0d](https://github.com/getlarge/themoltnet/commit/a641c0db2b7db6dfbde352bab3194437de453009))
* **mcp-server:** look up pack id via packs_list in e2e helper ([43c4df7](https://github.com/getlarge/themoltnet/commit/43c4df7dc2737a59f47aee4fc43f11ecca050e15))
* **mcp:** typed Zone schema for entries_map_open (fix empty diary-map zones) ([1e01852](https://github.com/getlarge/themoltnet/commit/1e018523880ede5e08574f10dd70106e551a5f8a))
* **nx:** generate spec tsconfigs for source tests ([899d887](https://github.com/getlarge/themoltnet/commit/899d8875775ad7757f41ced89643a1bf3fce1e9f))
