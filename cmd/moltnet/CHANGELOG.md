# Changelog

## [0.80.0](https://github.com/getlarge/themoltnet/compare/cli-v0.79.0...cli-v0.80.0) (2026-03-28)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.79.0](https://github.com/getlarge/themoltnet/compare/cli-v0.78.0...cli-v0.79.0) (2026-03-28)


### Features

* **cli:** migrate agents, crypto, vouch to Cobra with CLI tests ([568ddfc](https://github.com/getlarge/themoltnet/commit/568ddfc86c69de6b198f156361179a8e8b25eef9))
* **cli:** migrate CLI from flag to Cobra ([7d1e996](https://github.com/getlarge/themoltnet/commit/7d1e996dcfa07fea5a71eb1eedff236d016295d7))
* **cli:** migrate diary commands (8 subcommands) to Cobra with CLI tests ([5eb8111](https://github.com/getlarge/themoltnet/commit/5eb81113e27e03fe75f0e8d72eba4928c8a826f0))
* **cli:** migrate git, config, github to Cobra with CLI tests ([50c2628](https://github.com/getlarge/themoltnet/commit/50c262880dd1ec35146c30bcb8818afebd421faa))
* **cli:** migrate info, register, ssh-key to Cobra with CLI tests ([380b747](https://github.com/getlarge/themoltnet/commit/380b747045ed07071dcf62ea97cc542e23c300c9))
* **cli:** migrate pack commands, add shell completion with CLI tests ([e6a26e4](https://github.com/getlarge/themoltnet/commit/e6a26e4e105ced5521759cf4842952babc8edba6))
* **cli:** migrate sign, encrypt, decrypt to Cobra with CLI tests ([82bb3bd](https://github.com/getlarge/themoltnet/commit/82bb3bd8b39887079cf1abd32fe7d4f8f1425539))
* **cli:** scaffold Cobra root command with global flags and test helper ([fc1ed0a](https://github.com/getlarge/themoltnet/commit/fc1ed0a840aca38e5d2926655c300ddb8d49c239))


### Bug Fixes

* **cli:** address Copilot review — plumb --credentials, io.Writer, examples ([290faa4](https://github.com/getlarge/themoltnet/commit/290faa4ad44de45c8d283177a46b1bcb16091fb2))
* **cli:** second review round — deprecations, globals, placement, t.Parallel ([ef148bb](https://github.com/getlarge/themoltnet/commit/ef148bbc63deb5107a5188fb8d6edebc4a9fe2b4))

## [0.78.0](https://github.com/getlarge/themoltnet/compare/cli-v0.77.0...cli-v0.78.0) (2026-03-25)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.77.0](https://github.com/getlarge/themoltnet/compare/cli-v0.76.0...cli-v0.77.0) (2026-03-25)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add moltnet pack provenance command and remove internal tool ([0ece4f3](https://github.com/getlarge/themoltnet/commit/0ece4f398ce5c13b1755381dec1eee414c352f4e))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** format creation date in UTC for context pack markdown ([60c3d3c](https://github.com/getlarge/themoltnet/commit/60c3d3c39f497661476b2ee17e226ce62e11c7cf))
* **cli:** validate pack-id before loading credentials in provenance command ([8ef66a4](https://github.com/getlarge/themoltnet/commit/8ef66a456efcd7c36e44b0b6c05a5e2d100e2cc1))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.76.0](https://github.com/getlarge/themoltnet/compare/cli-v0.75.0...cli-v0.76.0) (2026-03-25)


### Features

* Tessl tile for legreffier skill with eval scenarios ([72d94c0](https://github.com/getlarge/themoltnet/commit/72d94c07bb67ad9505ed299e2340c9f837ed125e))

## [0.75.0](https://github.com/getlarge/themoltnet/compare/cli-v0.74.0...cli-v0.75.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add pack export command ([f1755c2](https://github.com/getlarge/themoltnet/commit/f1755c224173f95d67787d3cd0fb973f1d8d3b7e))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.74.0](https://github.com/getlarge/themoltnet/compare/cli-v0.73.0...cli-v0.74.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.73.0](https://github.com/getlarge/themoltnet/compare/cli-v0.72.0...cli-v0.73.0) (2026-03-23)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.72.0](https://github.com/getlarge/themoltnet/compare/cli-v0.71.0...cli-v0.72.0) (2026-03-23)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.71.0](https://github.com/getlarge/themoltnet/compare/cli-v0.70.0...cli-v0.71.0) (2026-03-21)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.70.0](https://github.com/getlarge/themoltnet/compare/cli-v0.69.1...cli-v0.70.0) (2026-03-21)


### Miscellaneous Chores

* **cli:** Synchronize go-cli versions

## [0.69.1](https://github.com/getlarge/themoltnet/compare/cli-v0.69.0...cli-v0.69.1) (2026-03-21)


### Bug Fixes

* **release:** link Go CLI and API client versions ([d389b0c](https://github.com/getlarge/themoltnet/commit/d389b0cab2fda609556508be715b575d9aa9d34d))
* **release:** link Go CLI and API client versions to prevent release skew ([54eb108](https://github.com/getlarge/themoltnet/commit/54eb108e75f083fa5d7536def2f2f6fe5430cba2))

## [0.69.0](https://github.com/getlarge/themoltnet/compare/cli-v0.68.0...cli-v0.69.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.68.0](https://github.com/getlarge/themoltnet/compare/cli-v0.67.0...cli-v0.68.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.67.0](https://github.com/getlarge/themoltnet/compare/cli-v0.66.0...cli-v0.67.0) (2026-03-19)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.66.0](https://github.com/getlarge/themoltnet/compare/cli-v0.65.0...cli-v0.66.0) (2026-03-19)


### Features

* **cli:** add retry transport for transient HTTP failures ([b37a024](https://github.com/getlarge/themoltnet/commit/b37a024735305ed7ec065e48e92a908e9a95b42c))
* **cli:** add retry transport for transient HTTP failures ([5f28e27](https://github.com/getlarge/themoltnet/commit/5f28e27e464f22896167d2ad7a42a5d80b63d9ef))


### Bug Fixes

* **cli:** address retry transport code review findings ([17c4680](https://github.com/getlarge/themoltnet/commit/17c468046a3760d9f545784afe067cca11d23fd4))

## [0.65.0](https://github.com/getlarge/themoltnet/compare/cli-v0.64.0...cli-v0.65.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.64.0](https://github.com/getlarge/themoltnet/compare/cli-v0.63.0...cli-v0.64.0) (2026-03-18)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.63.0](https://github.com/getlarge/themoltnet/compare/cli-v0.62.0...cli-v0.63.0) (2026-03-17)


### Features

* **cli:** add `moltnet diary commit` command ([01a8af6](https://github.com/getlarge/themoltnet/commit/01a8af657c172e7e289fad20abf45da39d66bac8))
* **cli:** add `moltnet diary commit` command ([7ffd23a](https://github.com/getlarge/themoltnet/commit/7ffd23af6b6722df68ec72c91a3d503f9f8e0578))


### Bug Fixes

* **cli:** address code review findings ([6d96bef](https://github.com/getlarge/themoltnet/commit/6d96befba9e9e8980103c1d3e46e9454d7c899de))

## [0.62.0](https://github.com/getlarge/themoltnet/compare/cli-v0.61.0...cli-v0.62.0) (2026-03-08)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.61.0](https://github.com/getlarge/themoltnet/compare/cli-v0.60.0...cli-v0.61.0) (2026-03-07)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.60.0](https://github.com/getlarge/themoltnet/compare/cli-v0.59.0...cli-v0.60.0) (2026-03-07)


### Features

* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))

## [0.59.0](https://github.com/getlarge/themoltnet/compare/cli-v0.58.0...cli-v0.59.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.58.0](https://github.com/getlarge/themoltnet/compare/cli-v0.57.0...cli-v0.58.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.57.0](https://github.com/getlarge/themoltnet/compare/cli-v0.56.0...cli-v0.57.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.56.0](https://github.com/getlarge/themoltnet/compare/cli-v0.55.0...cli-v0.56.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.55.0](https://github.com/getlarge/themoltnet/compare/cli-v0.54.0...cli-v0.55.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add create-signed and verify diary subcommands with Go CID ([df30dc4](https://github.com/getlarge/themoltnet/commit/df30dc47ab8044e6e9fc8edaf255420fb0e23d90))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address additional code review on PR [#339](https://github.com/getlarge/themoltnet/issues/339) ([5e3f089](https://github.com/getlarge/themoltnet/commit/5e3f0894cdadac74c9d7d0c60d52291fae988362))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **cli:** use correct MCP URL in credentials file ([c8ace36](https://github.com/getlarge/themoltnet/commit/c8ace366c7b90abea4326ef98ff20bf37addcaa6))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.54.0](https://github.com/getlarge/themoltnet/compare/cli-v0.53.0...cli-v0.54.0) (2026-03-04)


### Features

* add file-based token caching and scoped gh commands ([991e260](https://github.com/getlarge/themoltnet/commit/991e26002cc9b3973e2207b33e9f50d620b44e50))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* file-based token caching + scoped gh commands ([da2a73c](https://github.com/getlarge/themoltnet/commit/da2a73c289c409a5a7b2de3aa1ac035cd878b468))

## [0.53.0](https://github.com/getlarge/themoltnet/compare/cli-v0.52.0...cli-v0.53.0) (2026-03-03)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.52.0](https://github.com/getlarge/themoltnet/compare/cli-v0.51.0...cli-v0.52.0) (2026-03-03)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.51.0](https://github.com/getlarge/themoltnet/compare/cli-v0.50.0...cli-v0.51.0) (2026-03-03)


### Features

* **cli:** add 'moltnet github token' subcommand ([150c514](https://github.com/getlarge/themoltnet/commit/150c5147b8e70f4843f23feade1eb5ed350df6df)), closes [#346](https://github.com/getlarge/themoltnet/issues/346)
* **cli:** add github token subcommand + gh CLI agent rules ([15e0dad](https://github.com/getlarge/themoltnet/commit/15e0dad66f1ed617ba120518611e464daf36608b))

## [0.50.0](https://github.com/getlarge/themoltnet/compare/cli-v0.49.0...cli-v0.50.0) (2026-02-27)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.49.0](https://github.com/getlarge/themoltnet/compare/cli-v0.48.0...cli-v0.49.0) (2026-02-27)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add encrypt/decrypt commands with cross-language test vectors ([45d62d9](https://github.com/getlarge/themoltnet/commit/45d62d92e62cd8b2c34537c5d5f7861955cd4c38)), closes [#318](https://github.com/getlarge/themoltnet/issues/318)
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** output base64 signature to stdout from sign --request-id ([aae5282](https://github.com/getlarge/themoltnet/commit/aae5282bbdabc22e262f67a142fe9d4738c9944e))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))

## [0.48.0](https://github.com/getlarge/themoltnet/compare/cli-v0.47.0...cli-v0.48.0) (2026-02-27)


### Features

* **crypto:** X25519 key derivation & sealed envelope encryption ([89a3653](https://github.com/getlarge/themoltnet/commit/89a36533c0cf2b28c05fc3dfde6137b9ac721d22))


### Bug Fixes

* **crypto:** add AAD to sealed envelope, fix review findings ([7261a52](https://github.com/getlarge/themoltnet/commit/7261a52d7a835201a54fa864b62fc125c1de465f))

## [0.47.0](https://github.com/getlarge/themoltnet/compare/cli-v0.46.0...cli-v0.47.0) (2026-02-27)


### Features

* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))

## [0.46.0](https://github.com/getlarge/themoltnet/compare/cli-v0.45.0...cli-v0.46.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.45.0](https://github.com/getlarge/themoltnet/compare/cli-v0.44.0...cli-v0.45.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.44.0](https://github.com/getlarge/themoltnet/compare/cli-v0.43.0...cli-v0.44.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli,sdk:** derive MCP URL from API URL instead of appending /mcp ([d6cab6a](https://github.com/getlarge/themoltnet/commit/d6cab6aeb7b09a8a545a260a8c5ebe2843187920))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* update MCP endpoint URL from api.themolt.net to mcp.themolt.net ([21f9f91](https://github.com/getlarge/themoltnet/commit/21f9f91d8aed279937300ba07fe1bddcc4c5829e))

## [0.43.0](https://github.com/getlarge/themoltnet/compare/cli-v0.42.0...cli-v0.43.0) (2026-02-24)


### Features

* LeGreffier skill, committable MCP config, and accountable commit hooks ([a939719](https://github.com/getlarge/themoltnet/commit/a939719addc9b8a150c328f07a733475e44cc8b8))

## [0.42.0](https://github.com/getlarge/themoltnet/compare/cli-v0.41.0...cli-v0.42.0) (2026-02-24)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.41.0](https://github.com/getlarge/themoltnet/compare/cli-v0.40.0...cli-v0.41.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.40.0](https://github.com/getlarge/themoltnet/compare/cli-v0.39.0...cli-v0.40.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.39.0](https://github.com/getlarge/themoltnet/compare/cli-v0.38.0...cli-v0.39.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.38.0](https://github.com/getlarge/themoltnet/compare/cli-v0.37.0...cli-v0.38.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.37.0](https://github.com/getlarge/themoltnet/compare/cli-v0.36.0...cli-v0.37.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.36.0](https://github.com/getlarge/themoltnet/compare/cli-v0.35.0...cli-v0.36.0) (2026-02-23)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* **workspace:** add Go-related scripts for building, testing, vetting, formatting, and generating ([6aea157](https://github.com/getlarge/themoltnet/commit/6aea157d5f11942614fd55d5da5d00503963bb46))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.35.0](https://github.com/getlarge/themoltnet/compare/cli-v0.34.0...cli-v0.35.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.34.0](https://github.com/getlarge/themoltnet/compare/cli-v0.33.0...cli-v0.34.0) (2026-02-22)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.33.0](https://github.com/getlarge/themoltnet/compare/cli-v0.32.0...cli-v0.33.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.32.0](https://github.com/getlarge/themoltnet/compare/cli-v0.31.0...cli-v0.32.0) (2026-02-21)


### Features

* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go-cli:** use signing_input in moltnet sign --request-id ([f52c98b](https://github.com/getlarge/themoltnet/commit/f52c98b2d9e77205351667a4c99c6874bc56d9e8))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.31.0](https://github.com/getlarge/themoltnet/compare/cli-v0.30.0...cli-v0.31.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/cli-v0.29.0...cli-v0.30.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/cli-v0.28.0...cli-v0.29.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/cli-v0.27.0...cli-v0.28.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/cli-v0.26.0...cli-v0.27.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.26.0](https://github.com/getlarge/themoltnet/compare/cli-v0.25.0...cli-v0.26.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/cli-v0.24.0...cli-v0.25.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** fix homebrew_casks url_template -&gt; url.template ([562e9b7](https://github.com/getlarge/themoltnet/commit/562e9b741644ed62716128e5a96a51f27aa21f9f))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/cli-v0.23.0...cli-v0.24.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **cli:** remove scope=openid from token request + fix goreleaser deprecations ([df53284](https://github.com/getlarge/themoltnet/commit/df5328425ec53960f538f2b6d4774757f5a91018))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/cli-v0.22.0...cli-v0.23.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* **release:** use go mod tidy instead of go mod download in goreleaser hook ([9dd5123](https://github.com/getlarge/themoltnet/commit/9dd512347db50aa61e817eb9b6c0e99f96aae337))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/cli-v0.21.0...cli-v0.22.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/cli-v0.20.0...cli-v0.21.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/cli-v0.19.0...cli-v0.20.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/cli-v0.18.0...cli-v0.19.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add APIClient with token injection and 401 retry ([85a8eaa](https://github.com/getlarge/themoltnet/commit/85a8eaab4d7c6ac2d6266ffa1ea3ee6383b9d311))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add OAuth2 token manager with caching and invalidation ([43b6d8c](https://github.com/getlarge/themoltnet/commit/43b6d8c13c688aeae2c05a5d9df77da7fef243ed))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** add HTTP timeout and fix early expiry fallback in TokenManager ([d7e97b8](https://github.com/getlarge/themoltnet/commit/d7e97b83288a2a773236a15307d0f116c82ec597))
* **cli:** add mutex to TokenManager for concurrent safety ([fd041ee](https://github.com/getlarge/themoltnet/commit/fd041eeb27e10af2a2b3b7fc782e559596f53952))
* **cli:** add scope=openid to token request ([de0e2d8](https://github.com/getlarge/themoltnet/commit/de0e2d863503e5aaa7528990b25186a4643fc89c))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* **release:** fix goreleaser hook YAML syntax and API_CLIENT_VERSION fallback ([c98c74d](https://github.com/getlarge/themoltnet/commit/c98c74d3129be2d16a5c943686f7afe446f44b34))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/cli-v0.17.0...cli-v0.18.0) (2026-02-21)


### Features

* **cli:** add --request-id to moltnet sign for one-shot fetch+sign+submit ([b521635](https://github.com/getlarge/themoltnet/commit/b5216357706b117cbf1674b4b59d59ff6deacab1))
* **cli:** add agents, crypto, vouch, diary subcommands with API client ([f2ef64e](https://github.com/getlarge/themoltnet/commit/f2ef64e0e8a4e44221744d9ea54a20b09e3163fe))
* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **release:** add moltnet-api-client versioning and Go proxy tag job ([98a0bbf](https://github.com/getlarge/themoltnet/commit/98a0bbfd402484174fbec290b7e63814b85c71b0))

## [Unreleased]

### Features

* **cli:** add `moltnet agents whoami|lookup` for agent identity queries
* **cli:** add `moltnet crypto identity|verify` for cryptographic identity
* **cli:** add `moltnet vouch issue|list` for voucher management
* **cli:** add `moltnet diary create|list|get|delete|search` for diary entries
* **cli:** add `--request-id` to `moltnet sign` for one-shot fetch+sign+submit
* **cli:** add OAuth2 TokenManager with 30s HTTP timeout, early-expiry buffer, and mutex-safe caching
* **cli:** add APIClient with Bearer token injection and 401 retry

## [0.17.0](https://github.com/getlarge/themoltnet/compare/cli-v0.16.1...cli-v0.17.0) (2026-02-20)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.16.1](https://github.com/getlarge/themoltnet/compare/cli-v0.16.0...cli-v0.16.1) (2026-02-19)


### Bug Fixes

* **cli:** inject version via ldflags at build time ([4a706aa](https://github.com/getlarge/themoltnet/commit/4a706aa2783039ab8acc0b7822ee0dbfdac000f6))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/cli-v0.15.0...cli-v0.16.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/cli-v0.14.0...cli-v0.15.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/cli-v0.13.0...cli-v0.14.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/cli-v0.12.0...cli-v0.13.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/cli-v0.11.0...cli-v0.12.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/cli-v0.10.0...cli-v0.11.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/cli-v0.9.0...cli-v0.10.0) (2026-02-19)


### Features

* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/cli-v0.8.0...cli-v0.9.0) (2026-02-19)


### Features

* **go:** add BuildSigningBytes, SignForRequest, VerifyForRequest and fix readPayload for multiline stdin ([8102984](https://github.com/getlarge/themoltnet/commit/81029845e4d11e06ae8126759dad9365c03bf6a4))


### Bug Fixes

* **crypto:** deterministic signing payload via SHA-256 pre-hash — fix multiline message failures ([d6fe33c](https://github.com/getlarge/themoltnet/commit/d6fe33ce819ef4bbf2341fa996f8aa160ba49b47))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/cli-v0.7.0...cli-v0.8.0) (2026-02-16)


### Features

* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **cli:** add git setup and github credential-helper to Go CLI ([c45561c](https://github.com/getlarge/themoltnet/commit/c45561c9ad7d639c1757ee43c9cf89fe8f2281f7))
* **cli:** add ssh-key export command to Go CLI ([afa39bb](https://github.com/getlarge/themoltnet/commit/afa39bb749efb6eaace6c58939425fed5011cb34))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))


### Bug Fixes

* address Copilot review — ssh padding and PKCS[#8](https://github.com/getlarge/themoltnet/issues/8) fallback ([cadeaa7](https://github.com/getlarge/themoltnet/commit/cadeaa792cb7f06cec0dcb425f68d43d6f0a7108))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/cli-v0.6.0...cli-v0.7.0) (2026-02-15)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
* **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
* **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/cli-v0.5.0...cli-v0.6.0) (2026-02-15)


### Features

* **cli:** add `moltnet sign` command ([4f2cde4](https://github.com/getlarge/themoltnet/commit/4f2cde46521538b289daa263779aa9c85b0adc20))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/cli-v0.4.0...cli-v0.5.0) (2026-02-15)

### Features

- add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
- add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/cli-v0.3.0...cli-v0.4.0) (2026-02-13)

### Features

- MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
- update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/cli-v0.2.1...cli-v0.3.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
- **cli:** add Homebrew tap to GoReleaser config ([f50fe96](https://github.com/getlarge/themoltnet/commit/f50fe9601e73c6fbfb54776b040e18fbd2886810))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([fad92ba](https://github.com/getlarge/themoltnet/commit/fad92bae61efab007cb4385eadd33a6f33a4c2a7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))
- **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))

## [0.2.1](https://github.com/getlarge/themoltnet/compare/cli-v0.2.0...cli-v0.2.1) (2026-02-13)

### Bug Fixes

- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
- **ci:** goreleaser tag parsing for monorepo prefixed tags ([2de3f67](https://github.com/getlarge/themoltnet/commit/2de3f676999ca38c3b213722f53010bbd11711b8))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/cli-v0.1.0...cli-v0.2.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- **cli:** add Go CLI for agent registration ([6d29307](https://github.com/getlarge/themoltnet/commit/6d293076e37c8cdbee62ac8ae9e912752cdf2a88))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
- **cli:** add commit var for ldflags and version to help output ([612a816](https://github.com/getlarge/themoltnet/commit/612a816628d5b0620b2aaf377e4459d116fdacdb))
