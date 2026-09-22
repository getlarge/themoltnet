# Changelog

## [0.6.1](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.6.0...agent-desktop-v0.6.1) (2026-09-22)


### Bug Fixes

* **agent-desktop:** require only a minimum daemon version ([7041249](https://github.com/getlarge/themoltnet/commit/70412494071814cd15096529753903f2a19bed7d))
* **agent-desktop:** require only a minimum daemon version ([a0641bb](https://github.com/getlarge/themoltnet/commit/a0641bb41da7e616055aca5cbd7d83fb6650a3f9))
* **desktop:** reuse cached builds for release verification ([27cc6a8](https://github.com/getlarge/themoltnet/commit/27cc6a8a1f450cfb7c1b2e8bf3bf8ad7732ea034))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.5.1...agent-desktop-v0.6.0) (2026-09-22)


### Features

* **config:** shared store root and isolated keyring namespaces ([044f2f2](https://github.com/getlarge/themoltnet/commit/044f2f2aba32a310043210df40d498b926289065))
* **desktop:** scope native lifecycle and presets to the selected store ([f3678ae](https://github.com/getlarge/themoltnet/commit/f3678ae3376c1b49929bf0c859da4402ba079b46))
* **local-runtime:** isolate daemon and Desktop store consumers ([833930a](https://github.com/getlarge/themoltnet/commit/833930ad384a7f9ed2ea837aff566dbb54858a09))


### Bug Fixes

* **agent-desktop:** verify native server readiness ([27f2035](https://github.com/getlarge/themoltnet/commit/27f20355d9c51397dfc079593ce6a08459fd0f8a))
* **agent-desktop:** verify native server readiness ([8e09e34](https://github.com/getlarge/themoltnet/commit/8e09e3468542587198535a359966972c26d763d8))
* **agent:** decouple isolated startup from default directory health ([d059922](https://github.com/getlarge/themoltnet/commit/d05992256d0a99012350e9c459807ca6e5922678))
* **agent:** preserve store boundaries during recovery and startup ([47556bd](https://github.com/getlarge/themoltnet/commit/47556bd509f7548f4d4796d022277b7362d0be56))
* **desktop:** adapt store isolation to native socket control ([c1d6448](https://github.com/getlarge/themoltnet/commit/c1d6448f2e12902dc50c0fb86f998fe3307fee40))
* **desktop:** stabilize native package checks ([bdf9bf8](https://github.com/getlarge/themoltnet/commit/bdf9bf894d1538bfe1435ad89aa85bc674bfa216))
* **desktop:** validate discovery and gate isolated daemon support ([1786ddf](https://github.com/getlarge/themoltnet/commit/1786ddfe8b9a4325d92f1850155677d6a81b1ce8))
* **store:** address consumer isolation review findings ([c0b02be](https://github.com/getlarge/themoltnet/commit/c0b02bed8520d3ccdf2307c22f7c0e885f53f053))
* **store:** preserve default keyring identity across worker homes ([84c7736](https://github.com/getlarge/themoltnet/commit/84c773639fd6351bcd4125e8235822d56b9a7ce4))
* **store:** preserve worker namespaces and retire obsolete local control ([ba747cb](https://github.com/getlarge/themoltnet/commit/ba747cbd08ee821b31c10ec22ab15a1dfeccbed0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.4.0

## [0.5.1](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.5.0...agent-desktop-v0.5.1) (2026-09-21)


### Bug Fixes

* **agent-desktop:** repair staged CLI release pins ([7b9b5c6](https://github.com/getlarge/themoltnet/commit/7b9b5c6b0d371ce893d4d653b58c669bc1c8ad25))
* **agent-desktop:** repair staged CLI release pins ([5c296f7](https://github.com/getlarge/themoltnet/commit/5c296f7b6539c18c3aa48c6d0c632500c0d06022))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.4.0...agent-desktop-v0.5.0) (2026-09-21)


### Features

* **agent-desktop:** add Ubuntu setup and package distribution ([1b65eea](https://github.com/getlarge/themoltnet/commit/1b65eea588a4331746483bc70170e479fd3ee9a2))
* **agent-desktop:** use authenticated native Unix sockets ([a4048a6](https://github.com/getlarge/themoltnet/commit/a4048a6a74b203aa963039b3846ec5ceb7f5c89f))
* **console:** move local runtime control to Desktop ([1f934aa](https://github.com/getlarge/themoltnet/commit/1f934aae8b837c88b0d052e0cdfd7a2b84828000))
* **console:** move local runtime control to Desktop ([9f3c644](https://github.com/getlarge/themoltnet/commit/9f3c644391a1e9b40d6f36c2943a26b5eccd162b))


### Bug Fixes

* **agent-desktop:** clarify Linux setup state ([5111671](https://github.com/getlarge/themoltnet/commit/51116713696e7eb2a74450a0ae017a19ee173586))
* **agent-desktop:** close native socket review gaps ([d77c695](https://github.com/getlarge/themoltnet/commit/d77c695882beb9c5fbb15b491b44c3cc64879ddb))
* **agent-desktop:** close Ubuntu release review gaps ([46cc9a6](https://github.com/getlarge/themoltnet/commit/46cc9a6589696c916f68624821442b2cf440dbba))
* **agent-desktop:** harden draft release publication ([a3c653c](https://github.com/getlarge/themoltnet/commit/a3c653c1986e94621ae68db314e061a0315c55cb))
* **agent-desktop:** harden native socket lifecycle ([4c892e5](https://github.com/getlarge/themoltnet/commit/4c892e5b635a40a768825232bc1c1cc46716dac6))
* **agent-desktop:** harden Ubuntu setup and release ([69b8ca0](https://github.com/getlarge/themoltnet/commit/69b8ca0ce2fef3b45c9b9d320b666bc12d92d26b))
* **agent-desktop:** remove local CA trust ([32c5dcf](https://github.com/getlarge/themoltnet/commit/32c5dcfd348e8d52e8fc866205cf7919bc4c0a1e))
* **agent-desktop:** remove obsolete local-control paths ([2759833](https://github.com/getlarge/themoltnet/commit/2759833ead39bfd65d911fad23bc32946033890a))
* **landing:** publish stable download pins ([aa24f14](https://github.com/getlarge/themoltnet/commit/aa24f1487b04b6c91e2168395aeec92c179ef065))
* **landing:** publish stable download pins ([7a23abf](https://github.com/getlarge/themoltnet/commit/7a23abfa648c5d62c0a0cee0b48a6c3336d1a76c))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.3.0...agent-desktop-v0.4.0) (2026-09-20)


### Features

* **agent-daemon:** let a failed run name its own cause ([51f6917](https://github.com/getlarge/themoltnet/commit/51f6917ea87972ff644ee8a0c8c37efbf2b05c31))
* **agent-desktop:** add fixture-backed Run Center prototype ([29f58c2](https://github.com/getlarge/themoltnet/commit/29f58c281ed131704c7990a3948c2a2ea52b803e))
* **agent-desktop:** advanced connection settings and Server view refinement ([e0625e8](https://github.com/getlarge/themoltnet/commit/e0625e83e9f7c48d7216a134b1e607ef295d928f))
* **agent-desktop:** configure advanced connections and refine Server view ([79fd2ea](https://github.com/getlarge/themoltnet/commit/79fd2ea52a6ce250fa8dc89f360c26337ab44099))
* **agent-desktop:** configure local and cloud model providers ([2355fc7](https://github.com/getlarge/themoltnet/commit/2355fc7de8df49e3a34e05aafe87bf172934b4a6))
* **agent-desktop:** configure provider keys without leaving the app ([7bdf444](https://github.com/getlarge/themoltnet/commit/7bdf444444e35558e0fdae369d18e53081d91c02))
* **agent-desktop:** configure providers, models and subscriptions ([2777ed6](https://github.com/getlarge/themoltnet/commit/2777ed655225bbbcc1fcab64e9294099f47b56bc))
* **agent-desktop:** keep the control token out of the WebView ([f61bcf2](https://github.com/getlarge/themoltnet/commit/f61bcf2daf2df53007eea4066fb2edaf9d28dbdf))
* **agent-desktop:** native tray overview and server control ([2f976e1](https://github.com/getlarge/themoltnet/commit/2f976e15adb9ff7f81199cf5da237fd8d0980576))
* **agent-desktop:** Run Centre on the native control client ([bf3c149](https://github.com/getlarge/themoltnet/commit/bf3c149c518f810d6d8726374120163276653cdc))
* **agent-desktop:** show machine overview in native tray ([10c40e0](https://github.com/getlarge/themoltnet/commit/10c40e097d1571960ca9e04d0e2c3f9180a392f0))
* **agent-desktop:** sign in to an LLM subscription from the app ([898b1c8](https://github.com/getlarge/themoltnet/commit/898b1c8718467fe7f171ef72aab5a1c7cb853102))
* **agent-desktop:** wire the Run Center to the control API ([886e37c](https://github.com/getlarge/themoltnet/commit/886e37c1b6f358b2a3ee390f97d6b7e4d9190cbc))
* **agent-server:** PKCE enrollment, renewal and Console local control ([38c8e2e](https://github.com/getlarge/themoltnet/commit/38c8e2e0e5cbb84c33f9296cf07019dd2a051f6f))
* **agent-server:** use PKCE for provisioning and local control ([675059b](https://github.com/getlarge/themoltnet/commit/675059b5e2007ce7a7c188497cdd52bd6bb97a51))
* **desktop:** add invitation enrollment renewal and credential health ([36c835d](https://github.com/getlarge/themoltnet/commit/36c835d0f861c7160ec0628c79b5dea9564c3419))
* **desktop:** connect team health and captured run credentials ([5e19b65](https://github.com/getlarge/themoltnet/commit/5e19b65cc7e279175279c1e5281ec039466695cb))
* **desktop:** expose native team enrollment and metadata bridge ([cac5e1d](https://github.com/getlarge/themoltnet/commit/cac5e1d42b609827252b9a75ee32972d93c934e1))
* **desktop:** offer existing team key indexing from empty state ([5510aa1](https://github.com/getlarge/themoltnet/commit/5510aa121431bb7722e6933d2fb04132410d9103))


### Bug Fixes

* **agent-desktop:** announce lifecycle transitions to the tray ([5013862](https://github.com/getlarge/themoltnet/commit/501386215d8d61be88213a7362252639d34ade4f))
* **agent-desktop:** clarify provider setup and add bulk model selection ([e5acdc7](https://github.com/getlarge/themoltnet/commit/e5acdc7708abb0c7463e0ea332785bf50ac10bb1))
* **agent-desktop:** put provider accessibility roles on HTML wrappers ([19f28d7](https://github.com/getlarge/themoltnet/commit/19f28d7aecaa7a02a6016e047d01523475d648a1))
* **agent-desktop:** supply provider environment name ([5028cbf](https://github.com/getlarge/themoltnet/commit/5028cbfab9ac816d7ececc5cdccc7bada9f25df5))
* **agent-desktop:** surface a failed run stop in the runs list ([8ae3512](https://github.com/getlarge/themoltnet/commit/8ae35124c4c25daeec5d5db3bfebb2cf657fa302))
* **agent-desktop:** surface a failed run stop in the runs list ([094f87d](https://github.com/getlarge/themoltnet/commit/094f87d1c6d978ac510d2900ce4fc6f63c6264ae))
* **agent-desktop:** unblock the tray build and free the main thread ([320f9ec](https://github.com/getlarge/themoltnet/commit/320f9ec3f2bdc89aa6a10234c51070d38f87b24c))
* **agent-server:** partition OAuth browser rate limits ([7a53982](https://github.com/getlarge/themoltnet/commit/7a539821d7ee222f91bb89aa24db337260b9f1cd))
* **desktop:** align Ollama presets with provider storage contract ([80c7b2e](https://github.com/getlarge/themoltnet/commit/80c7b2e1a0b11cb68ab46efb8924f453fb75acce))
* **desktop:** align status markup and callback contracts ([b2d9453](https://github.com/getlarge/themoltnet/commit/b2d9453b86e18f3d3380914cd690fe6c2a4fb6cb))
* **desktop:** bound background work and expose run logs ([6f3a60b](https://github.com/getlarge/themoltnet/commit/6f3a60bd04e912fdb96aae9a4bce6397afd7322a))
* **desktop:** cancel abandoned native approvals ([dfebd27](https://github.com/getlarge/themoltnet/commit/dfebd27558b5e648019f1ad64d7365d734f9c155))
* **desktop:** clear stale team access refresh errors ([97e2a04](https://github.com/getlarge/themoltnet/commit/97e2a0467c6bb8935af70bca37338f9db5c15a36))
* **desktop:** correct trust root and settings CI errors ([7a572f6](https://github.com/getlarge/themoltnet/commit/7a572f676774755135c6d903a2f396ac06713157))
* **desktop:** dispatch provider controls off the UI thread ([75d6d69](https://github.com/getlarge/themoltnet/commit/75d6d69f65b7e9a8b76d92b7c87627be7dff4610))
* **desktop:** focus renewal invitation and compact team header ([49ddd50](https://github.com/getlarge/themoltnet/commit/49ddd509c7adc351c5bff0b1a070520c07589350))
* **desktop:** keep lifecycle and run refresh responsive ([02fd6cd](https://github.com/getlarge/themoltnet/commit/02fd6cd9f6fd2b0c4ad8e7e5795e945408b3ee91))
* **desktop:** keep lifecycle errors typed as messages ([dfdd808](https://github.com/getlarge/themoltnet/commit/dfdd808e2cf2b51933688ca4f16c45b378036c9c))
* **desktop:** keep tray refresh independent of UI dispatch ([05cbe9d](https://github.com/getlarge/themoltnet/commit/05cbe9d06174cf09083ef1ff78b431476ebb44df))
* **desktop:** persist operator status and toast approval results ([1154313](https://github.com/getlarge/themoltnet/commit/11543139c376bbcb7e5ef4faff7c28bfe66411a9))
* **desktop:** reuse run centre refresh after provider changes ([02000db](https://github.com/getlarge/themoltnet/commit/02000db29850ad6ab025d9e926d928834ff0f9d6))
* **desktop:** show tray catalogue for an available identity ([f89a449](https://github.com/getlarge/themoltnet/commit/f89a44964fc3903036dd01c6449bca6b5ca62696))
* **desktop:** use platform TLS trust for local control ([5421342](https://github.com/getlarge/themoltnet/commit/5421342a2e5f9613dfdac886ae530295673a60e0))
* **landing:** publish stable download pins ([f5f8fec](https://github.com/getlarge/themoltnet/commit/f5f8fec03d018726d8fe1f397a88611d37e8258b))
* **landing:** publish stable download pins ([c4f43a1](https://github.com/getlarge/themoltnet/commit/c4f43a114c32d66fa2265c24e673238d288b6c54))
* **oauth:** bind enrollment approvals to native identity proof ([912964f](https://github.com/getlarge/themoltnet/commit/912964ff8e6ec8df93cb30f2cc1e5a19378fbe75))
* **oauth:** simplify grant validation and complete review coverage ([aa0a5db](https://github.com/getlarge/themoltnet/commit/aa0a5db176e66961bd2e2ec20e5f899a72bc15b4))
* **pkce:** align native fixtures and browser test boundaries ([40ff264](https://github.com/getlarge/themoltnet/commit/40ff2642085276443681c000e050c776c10c5bb7))
* **providers:** preserve shared form actions and controller contracts ([02baae6](https://github.com/getlarge/themoltnet/commit/02baae6e7632bcf6142674f6936762d38a64cfb6))


### Performance Improvements

* **desktop:** share immutable lifecycle log snapshots ([d8c938f](https://github.com/getlarge/themoltnet/commit/d8c938feac48ca53b4894366c8749094f2154fd1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.3.0

## [0.3.0](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.2.0...agent-desktop-v0.3.0) (2026-09-18)


### Features

* **agent-desktop:** add macOS menu bar application ([19ba66f](https://github.com/getlarge/themoltnet/commit/19ba66fd8dc4ee97b49f5f1601849b6889424f78))
* **agent-desktop:** add macOS menu bar application ([fcd8a0d](https://github.com/getlarge/themoltnet/commit/fcd8a0dce47d48cc6a3564b0ad75703afcb95cb8))
* **release:** publish MoltNet Agent desktop downloads ([7668228](https://github.com/getlarge/themoltnet/commit/7668228c4507ab72c8149879c707135fb326bfaa))


### Bug Fixes

* **agent-desktop:** bind release to Agent CLI contract ([2bddb39](https://github.com/getlarge/themoltnet/commit/2bddb39306001853c648b02739fa9470dca989e5))
* **agent-desktop:** close lifecycle review gaps ([e3b6ca5](https://github.com/getlarge/themoltnet/commit/e3b6ca57f694444282f8fd094d4495e32ae0a46e))
* **agent-desktop:** close lifecycle security gaps ([37204db](https://github.com/getlarge/themoltnet/commit/37204dbbae498b1f73ec5e9f728ce9c81a2e1966))
* **agent-desktop:** enforce managed runtime contracts ([a92661b](https://github.com/getlarge/themoltnet/commit/a92661b13161e3d00525c2d7c3e4b8b4c6753290))
* **agent-desktop:** enforce managed runtime contracts ([922785b](https://github.com/getlarge/themoltnet/commit/922785b2aff2aa00cc405f5bd70901b79b161157))
* **agent-desktop:** harden lifecycle recovery ([79fdd87](https://github.com/getlarge/themoltnet/commit/79fdd875ceef21486a61c081677ad42af9b3dd29))
* **agent-desktop:** harden lifecycle recovery ([cffa252](https://github.com/getlarge/themoltnet/commit/cffa252e161109cb6fb8526c42f551ab6698cff0))
* **agent-desktop:** pass updater config through Nx ([daf539a](https://github.com/getlarge/themoltnet/commit/daf539a537c6b0b31cee9887e0a0092d2f311d5b))
* **agent-desktop:** pass updater config through Nx ([d09156a](https://github.com/getlarge/themoltnet/commit/d09156a05ef67d88aa4c1e1b1a4906ee9b5703ac))
* **agent-desktop:** reject noncanonical versions ([5ee7123](https://github.com/getlarge/themoltnet/commit/5ee7123eb16497382c5ae931615b3fd8e78bf2e8))
* **desktop:** make Nx targets tool-manager agnostic ([030a84d](https://github.com/getlarge/themoltnet/commit/030a84d0bcc9e43c2dd212497a6ff80e715431ab))
* **desktop:** narrow native cache outputs ([0797b5d](https://github.com/getlarge/themoltnet/commit/0797b5ddcb65df797e6908d9331a65bc50a8a706))
* **release:** align Tauri manifest formatting ([63ea0ee](https://github.com/getlarge/themoltnet/commit/63ea0ee6cd5c027126ad4f6ff3bf645638f9734c))
* **release:** align Tauri manifest formatting ([2b81f2e](https://github.com/getlarge/themoltnet/commit/2b81f2ec7a52e008eaefa54e87ce7b271bd10482))
* **release:** enforce desktop publication contracts ([f3f61ce](https://github.com/getlarge/themoltnet/commit/f3f61ce359679e610de47757ebf2aec136b6db8d))
* **release:** pass updater config to Tauri ([cb700c5](https://github.com/getlarge/themoltnet/commit/cb700c55e044a065e5077e3315fe0db69017f844))
* **release:** pass updater config to Tauri ([74081f7](https://github.com/getlarge/themoltnet/commit/74081f78079afd017850a17f1736c27e2c6d84a5))
* **release:** preserve canonical desktop version checks ([398dc34](https://github.com/getlarge/themoltnet/commit/398dc34bf91381a0d0201963763b4a5d1ca2b264))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/agent-desktop-v0.1.0...agent-desktop-v0.2.0) (2026-09-16)


### Features

* **agent-desktop:** add macOS menu bar application ([19ba66f](https://github.com/getlarge/themoltnet/commit/19ba66fd8dc4ee97b49f5f1601849b6889424f78))
* **agent-desktop:** add macOS menu bar application ([fcd8a0d](https://github.com/getlarge/themoltnet/commit/fcd8a0dce47d48cc6a3564b0ad75703afcb95cb8))
* **release:** publish MoltNet Agent desktop downloads ([7668228](https://github.com/getlarge/themoltnet/commit/7668228c4507ab72c8149879c707135fb326bfaa))


### Bug Fixes

* **agent-desktop:** bind release to Agent CLI contract ([2bddb39](https://github.com/getlarge/themoltnet/commit/2bddb39306001853c648b02739fa9470dca989e5))
* **agent-desktop:** close lifecycle review gaps ([e3b6ca5](https://github.com/getlarge/themoltnet/commit/e3b6ca57f694444282f8fd094d4495e32ae0a46e))
* **agent-desktop:** close lifecycle security gaps ([37204db](https://github.com/getlarge/themoltnet/commit/37204dbbae498b1f73ec5e9f728ce9c81a2e1966))
* **agent-desktop:** harden lifecycle recovery ([79fdd87](https://github.com/getlarge/themoltnet/commit/79fdd875ceef21486a61c081677ad42af9b3dd29))
* **agent-desktop:** harden lifecycle recovery ([cffa252](https://github.com/getlarge/themoltnet/commit/cffa252e161109cb6fb8526c42f551ab6698cff0))
* **agent-desktop:** reject noncanonical versions ([5ee7123](https://github.com/getlarge/themoltnet/commit/5ee7123eb16497382c5ae931615b3fd8e78bf2e8))
* **desktop:** make Nx targets tool-manager agnostic ([030a84d](https://github.com/getlarge/themoltnet/commit/030a84d0bcc9e43c2dd212497a6ff80e715431ab))
* **desktop:** narrow native cache outputs ([0797b5d](https://github.com/getlarge/themoltnet/commit/0797b5ddcb65df797e6908d9331a65bc50a8a706))
* **release:** align Tauri manifest formatting ([63ea0ee](https://github.com/getlarge/themoltnet/commit/63ea0ee6cd5c027126ad4f6ff3bf645638f9734c))
* **release:** align Tauri manifest formatting ([2b81f2e](https://github.com/getlarge/themoltnet/commit/2b81f2ec7a52e008eaefa54e87ce7b271bd10482))
* **release:** enforce desktop publication contracts ([f3f61ce](https://github.com/getlarge/themoltnet/commit/f3f61ce359679e610de47757ebf2aec136b6db8d))
* **release:** preserve canonical desktop version checks ([398dc34](https://github.com/getlarge/themoltnet/commit/398dc34bf91381a0d0201963763b4a5d1ca2b264))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/design-system bumped to 1.2.0
