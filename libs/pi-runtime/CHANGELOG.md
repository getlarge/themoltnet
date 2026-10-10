# Changelog

## [0.23.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.22.0...pi-runtime-v0.23.0) (2026-10-10)


### Features

* **pi-runtime:** count rejected submit repairs and bound repair telemetry ([964e6b4](https://github.com/getlarge/themoltnet/commit/964e6b4edc24536b7c9e03834b336042c1b760c0))


### Bug Fixes

* **pi-runtime:** reject unusable submit contracts before VM boot ([9d0a213](https://github.com/getlarge/themoltnet/commit/9d0a2136210c71e7f9b20874a337314ec8c33707))
* **runtime:** finish submit-output follow-ups from [#2641](https://github.com/getlarge/themoltnet/issues/2641) ([269154b](https://github.com/getlarge/themoltnet/commit/269154b498b6cd8f8709f17684de80cbca4f1dc4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.13.0

## [0.22.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.21.2...pi-runtime-v0.22.0) (2026-10-06)


### Features

* **pi-runtime:** repair JSON strings in submit arguments ([df59568](https://github.com/getlarge/themoltnet/commit/df59568ed479ae78056f40fee0b1114d2932c13e))
* **runtime:** accept a JSON-only final message as the submit payload ([b2dd221](https://github.com/getlarge/themoltnet/commit/b2dd221f22aa1f2dfa9670eb8242708f8cb7cb93))
* **runtime:** accept a JSON-only final message as the submit payload ([53bc181](https://github.com/getlarge/themoltnet/commit/53bc181f787fb1a730ed12aaea2f29f0c412240b))
* **runtime:** add private complete JSON repair library ([9e26705](https://github.com/getlarge/themoltnet/commit/9e26705d79694f117f3c89bfcef653753238feb1))
* **runtime:** align submit output against task schema ([f2db13e](https://github.com/getlarge/themoltnet/commit/f2db13e8bb28e1aac3530054d878aad95dac768f))
* **runtime:** align submit output and measure model structure ([9a3e848](https://github.com/getlarge/themoltnet/commit/9a3e848326e42aab459090d958c5af62be5c734f))


### Bug Fixes

* **eval:** enable strict Pi tools for Ollama Cloud ([c911b7c](https://github.com/getlarge/themoltnet/commit/c911b7c71d85006c8a87ed48f0ec1af0ac905a39))
* **runtime:** describe the checked submit candidate in validation feedback ([787a088](https://github.com/getlarge/themoltnet/commit/787a08854da808b411f064220c48a4d3b60e252c))
* **runtime:** keep text-only turns off the turn cap and grade final-message submits ([5191340](https://github.com/getlarge/themoltnet/commit/51913401d467e92d490ba0a06af61bd25964d3c1))
* **runtime:** omit TypeBox IDs from strict submit schema ([d2b13f9](https://github.com/getlarge/themoltnet/commit/d2b13f9b7c1c2978b681d1c444b4f3afc10d5507))
* **runtime:** preserve parser repair completion telemetry ([7b06d9f](https://github.com/getlarge/themoltnet/commit/7b06d9f58ed11c38ae9805416d1c2e52e857f818))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.12.0

## [0.21.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.21.1...pi-runtime-v0.21.2) (2026-10-02)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.11.0
    * @themoltnet/sdk bumped to 0.149.1

## [0.21.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.21.0...pi-runtime-v0.21.1) (2026-10-02)


### Bug Fixes

* **provider-catalog:** generate Ollama Cloud models and capabilities ([68d8b2b](https://github.com/getlarge/themoltnet/commit/68d8b2bcd586ca3d5f82b97719af5d42d6cc05e0))
* **review:** use typed results for docs and complexity stages ([f67533d](https://github.com/getlarge/themoltnet/commit/f67533d7b4e270d8335c7200b0360d1e7b17ada7))
* **review:** use typed results for docs and complexity stages ([0d82096](https://github.com/getlarge/themoltnet/commit/0d82096e4358c793a8a462dde34ea28161276e12))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.10.0
    * @themoltnet/sdk bumped to 0.149.0

## [0.21.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.20.1...pi-runtime-v0.21.0) (2026-10-01)


### Features

* **daemon:** enforce typed freeform results ([6ed36d1](https://github.com/getlarge/themoltnet/commit/6ed36d1faab102df4f830eac3dcfbf3fa8faedd8))
* **tasks:** enforce custom output contracts in daemon ([3710185](https://github.com/getlarge/themoltnet/commit/3710185427f565b404e6d8efef4b9a05c9f21409))
* **tasks:** support typed freeform results ([6ebe475](https://github.com/getlarge/themoltnet/commit/6ebe47563a70f1ce7f0bf3093e33c9fee8d25673))


### Bug Fixes

* address review round 1 on output contract recovery ([0a3ad90](https://github.com/getlarge/themoltnet/commit/0a3ad90b61e55b958f7e2357600026bcd74486ad))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.9.0
    * @themoltnet/sandbox-gondolin bumped to 0.6.0
    * @themoltnet/sdk bumped to 0.148.0

## [0.20.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.20.0...pi-runtime-v0.20.1) (2026-09-30)


### Bug Fixes

* **agent:** enforce structured task submissions ([326e432](https://github.com/getlarge/themoltnet/commit/326e4320965922a45ef86cab903b92560828bd41))
* **agent:** enforce structured task submissions ([baa80a1](https://github.com/getlarge/themoltnet/commit/baa80a160714a90c787530c6391089e040a341e5))
* **pi-runtime:** make submit tool the sole structured output contract ([8921a74](https://github.com/getlarge/themoltnet/commit/8921a74096077733cf39ee7b554473f9f06ee334))
* **pi-runtime:** preserve strict submit verification and duplicate capture ([99ff669](https://github.com/getlarge/themoltnet/commit/99ff6698e83f4d9499a401205cbfea8a3c5ca631))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.8.0

## [0.20.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.19.0...pi-runtime-v0.20.0) (2026-09-29)


### Features

* **review:** advisory docs-impact reviewer (app + CI workflow) ([4277715](https://github.com/getlarge/themoltnet/commit/427771527ae77a7cd1689959c45712ae9f2ad06c))


### Bug Fixes

* **pi-runtime:** decode submit fields sent as JSON strings ([c7ed097](https://github.com/getlarge/themoltnet/commit/c7ed097fc7f9c08782d5799e2be007bf58e36887))
* **pi-runtime:** keep logger receiver for thinking warnings ([11d4f98](https://github.com/getlarge/themoltnet/commit/11d4f98c71ff13df3e654c4f3efb65846234a7ed))
* **pi-runtime:** keep logger receiver for thinking warnings ([f91c18c](https://github.com/getlarge/themoltnet/commit/f91c18cd3194237700c0a9873444501073448000))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.9...pi-runtime-v0.19.0) (2026-09-28)


### Features

* **pi-runtime:** project model reasoning controls into sessions ([0b58d7d](https://github.com/getlarge/themoltnet/commit/0b58d7d1a66518be71fe29e14320469538323c00))


### Bug Fixes

* **agent-daemon:** infer Ollama thinking controls from model API ([30b8f59](https://github.com/getlarge/themoltnet/commit/30b8f59756b2c2d375f2048c629a2565eccd6c64))

## [0.18.9](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.8...pi-runtime-v0.18.9) (2026-09-28)


### Bug Fixes

* **pi-runtime:** let malformed submit fields reach recovery validator ([acf15b9](https://github.com/getlarge/themoltnet/commit/acf15b97bb79b0f255515eb135e849b9404955af))
* **pi-runtime:** preserve captured submit before drain signal ([ce88be0](https://github.com/getlarge/themoltnet/commit/ce88be0e7825b76e6d58fe56f1aa91cc8d0820ba))
* **pi-runtime:** preserve captured submit before drain signal ([2e41be7](https://github.com/getlarge/themoltnet/commit/2e41be76ed8c95b20ce168cee430df91fad13ef2))
* **pi-runtime:** terminate validated submit without abort ([a9d524c](https://github.com/getlarge/themoltnet/commit/a9d524c18eddc053ada3f055699dcb38ea0a8c9d))

## [0.18.8](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.7...pi-runtime-v0.18.8) (2026-09-26)


### Bug Fixes

* **pi-runtime:** keep valid output after submit abort ([e597051](https://github.com/getlarge/themoltnet/commit/e5970513792756d5193ec773f94ff3bdb15b9dde))
* **pi-runtime:** keep valid output after submit abort ([22d2cc7](https://github.com/getlarge/themoltnet/commit/22d2cc7ee4eefbdd429ce26b9834f4b4d5217126))
* **pi-runtime:** omit unsupported provider model options ([eb1df5a](https://github.com/getlarge/themoltnet/commit/eb1df5a7fc99d69c0666faef4b10396b31c933c7))
* **pi-runtime:** omit unsupported provider request options ([6b0a86b](https://github.com/getlarge/themoltnet/commit/6b0a86b101ad640dad829c5338ddce4d6908826e))
* **provider-catalog:** describe Ollama request options ([922d7d7](https://github.com/getlarge/themoltnet/commit/922d7d75d3e55a802405b890aa330fd96575dc44))
* **sandbox:** restore guest signing without startup wait ([670dbe7](https://github.com/getlarge/themoltnet/commit/670dbe7bbac4bffdc2f6f50dfecf0e05df9a8e4b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sandbox-gondolin bumped to 0.5.2

## [0.18.7](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.6...pi-runtime-v0.18.7) (2026-09-25)


### Bug Fixes

* **pi-runtime:** isolate task session resources ([47f1f46](https://github.com/getlarge/themoltnet/commit/47f1f46439822cca771a17b6b23e64423d0ff042))
* **pi-runtime:** isolate task session resources ([c3c8608](https://github.com/getlarge/themoltnet/commit/c3c86088f75876982995362736c21173a360c51a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.7.0
    * @themoltnet/sdk bumped to 0.147.0

## [0.18.6](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.5...pi-runtime-v0.18.6) (2026-09-25)


### Bug Fixes

* **agent-daemon:** fail fast on permanent provider errors ([bb7b724](https://github.com/getlarge/themoltnet/commit/bb7b7242549ff4e21cd7b962f40bce2a2584e960))
* **pi-runtime:** classify provider status envelopes before retrying ([26677f1](https://github.com/getlarge/themoltnet/commit/26677f107d35d3b2240b63f10e07ade8777e166a))
* **pi-runtime:** preserve explicit transient retry verdicts ([9d03e33](https://github.com/getlarge/themoltnet/commit/9d03e33994ae942cda7a02b8f8560b5267602bc6))
* **pi-runtime:** preserve terminal provider errors across retry boundaries ([fb0eabe](https://github.com/getlarge/themoltnet/commit/fb0eabe291e3b923ce382c1bd4d0751a05066bf8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.6.0
    * @themoltnet/sdk bumped to 0.146.1

## [0.18.5](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.4...pi-runtime-v0.18.5) (2026-09-24)


### Bug Fixes

* **pi-runtime:** support GPT-6 Sol in Agent Server ([5080b1f](https://github.com/getlarge/themoltnet/commit/5080b1fd168c6a2c176fd80d2aee0d00f77d4e3c))
* **pi-runtime:** support GPT-6 Sol in Agent Server ([6cc836d](https://github.com/getlarge/themoltnet/commit/6cc836d9a83a61e275f731bdc7a62dfd643c02bc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.5.0

## [0.18.4](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.3...pi-runtime-v0.18.4) (2026-09-22)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.4.0
    * @themoltnet/sdk bumped to 0.146.0

## [0.18.3](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.2...pi-runtime-v0.18.3) (2026-09-22)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.3.0
    * @themoltnet/os-keyring bumped to 0.4.0
    * @themoltnet/sdk bumped to 0.145.0

## [0.18.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.1...pi-runtime-v0.18.2) (2026-09-20)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.2.0
    * @themoltnet/sdk bumped to 0.144.0

## [0.18.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.18.0...pi-runtime-v0.18.1) (2026-09-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.1.0
    * @themoltnet/sdk bumped to 0.143.0

## [0.18.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.17.0...pi-runtime-v0.18.0) (2026-09-18)


### Features

* **shell-command-analyzer:** resolve subcommand-scoped git escape flags ([bc15533](https://github.com/getlarge/themoltnet/commit/bc155333d3a6a5102d96f01a2ff0433b9477e769)), closes [#2275](https://github.com/getlarge/themoltnet/issues/2275)
* **tool-policy:** record policy refusals as task messages, metrics and spans ([2ef8e1c](https://github.com/getlarge/themoltnet/commit/2ef8e1c31408e0f68f920209283c2e973431e8fe))
* **tool-policy:** record policy refusals as task messages, metrics and spans ([ad27676](https://github.com/getlarge/themoltnet/commit/ad27676df865dc2bbb57e3c0d5b20f79a01d937e)), closes [#2275](https://github.com/getlarge/themoltnet/issues/2275)


### Bug Fixes

* **tool-policy:** bound model-controlled names and stop dropping late refusals ([c870f4d](https://github.com/getlarge/themoltnet/commit/c870f4d31884e1a0e610530f1a04ed12d9f71526)), closes [#2275](https://github.com/getlarge/themoltnet/issues/2275)
* **tool-policy:** refuse execution-redirecting env prefixes and quoted escapes ([431fb6b](https://github.com/getlarge/themoltnet/commit/431fb6b775f94aac1a4e5e1a23194a6ef4ba1087)), closes [#2275](https://github.com/getlarge/themoltnet/issues/2275)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/shell-command-analyzer bumped to 0.4.0

## [0.17.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.16.0...pi-runtime-v0.17.0) (2026-09-16)


### Features

* **pi-runtime:** declare model input modalities in generated Pi config ([fc2de20](https://github.com/getlarge/themoltnet/commit/fc2de207ae6daf41f422c45b0580353fa89d78e9))
* **pi-runtime:** declare model input modalities so vision models receive images ([d9a44f3](https://github.com/getlarge/themoltnet/commit/d9a44f3a3b92d199293a98ba750457cc77e10fab))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.15.3...pi-runtime-v0.16.0) (2026-09-15)


### ⚠ BREAKING CHANGES

* **pi-runtime:** shell programs listed in tools no longer authorize shell invocations; add shellCommands rules instead. Output redirection is refused for every shell rule. The reason code shell_output_redirection_requires_broad_permission is renamed shell_output_redirection_not_permitted.

### Features

* **pi-runtime:** shell access only through shellCommands ([154be47](https://github.com/getlarge/themoltnet/commit/154be47cb3266ac2d827e0055188efaae357a8da))


### Bug Fixes

* **console:** match policy editor to structured tool grants ([d054f1e](https://github.com/getlarge/themoltnet/commit/d054f1efe37e166af2bbe51022abc32ff97b367f))
* **console:** state tool grant rule without a structured tool list ([26dab1e](https://github.com/getlarge/themoltnet/commit/26dab1e32ec0d872ba1daaed6266bd491233951d))
* **pi-runtime:** accept one-token shell rules in session policy resolution ([e232747](https://github.com/getlarge/themoltnet/commit/e23274725d1899ddfa221db4da101bf6619ecfba))

## [0.15.3](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.15.2...pi-runtime-v0.15.3) (2026-09-15)


### Bug Fixes

* **pi-runtime:** separate structured tools from shell grants ([164b7eb](https://github.com/getlarge/themoltnet/commit/164b7ebbf63232cc518ded815ddd9297062b4d80))
* **pi-runtime:** separate structured tools from shell grants ([7570499](https://github.com/getlarge/themoltnet/commit/757049988364893d31b4c18f70cfece15650dfff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.0.3
    * @themoltnet/sdk bumped to 0.142.0

## [0.15.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.15.1...pi-runtime-v0.15.2) (2026-09-13)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.0.2

## [0.15.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.15.0...pi-runtime-v0.15.1) (2026-09-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.0.1
    * @themoltnet/sdk bumped to 0.141.1

## [0.15.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.14.3...pi-runtime-v0.15.0) (2026-09-09)


### Features

* **cli:** anchor credentials to durable agent subjects ([29f062e](https://github.com/getlarge/themoltnet/commit/29f062ed50c6099fedb8d1d2be0345b9505bd4d5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 1.0.0
    * @themoltnet/sdk bumped to 0.141.0

## [0.14.3](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.14.2...pi-runtime-v0.14.3) (2026-09-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.46.0
    * @themoltnet/sdk bumped to 0.140.2

## [0.14.2](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.14.1...pi-runtime-v0.14.2) (2026-09-05)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.45.3
    * @themoltnet/sdk bumped to 0.140.1

## [0.14.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.14.0...pi-runtime-v0.14.1) (2026-09-03)


### Bug Fixes

* **agent-daemon:** declare pi-ai runtime dependency ([443fecb](https://github.com/getlarge/themoltnet/commit/443fecb9989864846417e66ead56128128aaf920))
* **ci:** account for Pi dependency boundaries ([da0be80](https://github.com/getlarge/themoltnet/commit/da0be80484277ac55c73dca68d2a1f2707014b5f))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.13.1...pi-runtime-v0.14.0) (2026-09-02)


### Features

* **agent-daemon:** serve loopback supervisor for console-managed runs ([f2c69d4](https://github.com/getlarge/themoltnet/commit/f2c69d45a3e2aa85c442df5915d50d25dcad4913))
* **pi-runtime:** upgrade Pi to 0.84.4 ([08f1f20](https://github.com/getlarge/themoltnet/commit/08f1f20fb3a0c0782e9544cc8cbb67b85dd40c63))
* **pi-runtime:** upgrade Pi to 0.84.4 ([076bd06](https://github.com/getlarge/themoltnet/commit/076bd06466e038b08d88d0f3a9c558ccd962e295))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/agent-runtime bumped to 0.45.2
    * @themoltnet/sdk bumped to 0.140.0

## [0.13.1](https://github.com/getlarge/themoltnet/compare/pi-runtime-v0.13.0...pi-runtime-v0.13.1) (2026-09-02)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @themoltnet/sandbox-gondolin bumped to 0.5.1

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
