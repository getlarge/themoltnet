# Changelog

## [0.4.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.3.0...rest-api-v0.4.0) (2026-05-29)


### Features

* **console:** create freeform tasks from the board ([3a3c1e2](https://github.com/getlarge/themoltnet/commit/3a3c1e2cdd757c2cf7ef6f692f153552b6330151))
* **console:** per-lane queries + accurate funnel counts on the board ([1f59b7b](https://github.com/getlarge/themoltnet/commit/1f59b7b0b2b12d69b558c8315f259c141cf88a07))
* **console:** task lane board with live agent pane ([e09c94e](https://github.com/getlarge/themoltnet/commit/e09c94e4337adb6b87be04b64d39d1fa26c33d15))
* **landing:** refresh positioning and onboarding ([68801aa](https://github.com/getlarge/themoltnet/commit/68801aaf724924b56ebd3a78368d472d3f011ebe))
* **tasks:** add statuses[] filter + real total count to listTasks ([e66d5a6](https://github.com/getlarge/themoltnet/commit/e66d5a6c9588d2203efa1b4015d11662d12b8aa3))


### Bug Fixes

* **console:** scale the task board with per-lane queries + real counts ([a6e6202](https://github.com/getlarge/themoltnet/commit/a6e62024e240d09dbf309878cf1ca783e6bebda4))
* **task-service:** dereference TaskStatus when validating claimCondition ([02350ef](https://github.com/getlarge/themoltnet/commit/02350ef932fe1597b6b92c14b6d296b8e38d81d4))
* **task-service:** write humans.id (not Kratos identityId) to proposed/cancelled/sealed_by_human_id ([f8919d4](https://github.com/getlarge/themoltnet/commit/f8919d4b7860e86c922be420eb0c3fcd1ada8b30))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.2.0...rest-api-v0.3.0) (2026-05-26)


### Features

* **tasks:** add conditional claimability ([78bb795](https://github.com/getlarge/themoltnet/commit/78bb795ef4c4d88d8b192e1a998c16ce3b831870))
* **tasks:** add conditional claimability ([580161f](https://github.com/getlarge/themoltnet/commit/580161f6d84862e85b7b1d56887ff45f2732a0cf))


### Bug Fixes

* **ci:** refresh generated task contracts ([413618b](https://github.com/getlarge/themoltnet/commit/413618bda46a220fba8dd111ba4ec5291836e37e))
* **tasks:** claim-promote satisfied conditional tasks ([6a86faa](https://github.com/getlarge/themoltnet/commit/6a86faa22687c67f5c3094ea349cb302af47668c))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/rest-api-v0.1.0...rest-api-v0.2.0) (2026-05-26)


### Features

* **#943:** Phase 0 eval substrate dogfood — SDK, pi-extension, prompts, daemon, imposers ([5155fd7](https://github.com/getlarge/themoltnet/commit/5155fd7a3c3137d1d18d9203cefbb3d8082b79b4))
* **evals:** refresh legreffier scenarios and runner modes ([4f9a128](https://github.com/getlarge/themoltnet/commit/4f9a1282de40b03b84916c5217b54a2a7af15588))
* **rest-api:** drop baked-in embedding model ([244e3ac](https://github.com/getlarge/themoltnet/commit/244e3acbb01af23a2b74b03bfa991d7d1c730eb7))
* **rest-api:** drop baked-in embedding model in favor of startup download ([89bb1fa](https://github.com/getlarge/themoltnet/commit/89bb1fa35acecc90024e3ee9104fa53026a70342)), closes [#1226](https://github.com/getlarge/themoltnet/issues/1226)
* **teams:** support role promotion and updates ([cef6ae3](https://github.com/getlarge/themoltnet/commit/cef6ae3622983e40f9b183464a245197f1580267))
* **teams:** support role promotion and updates ([0fb8e84](https://github.com/getlarge/themoltnet/commit/0fb8e847f2b2ba61e088f4461d1ea910d234e879))
* version deployable app contracts ([b8251ff](https://github.com/getlarge/themoltnet/commit/b8251ffa41fe2c67d76dfcc5e22bed2f7006e80a))


### Bug Fixes

* **ci:** split diary entry route suites to avoid Vitest onTaskUpdate timeout ([53848c7](https://github.com/getlarge/themoltnet/commit/53848c7b78131af6fd58b8f676dcc5bde31a8b01))
* **ci:** stabilize MCP app lint and tests ([94b5a80](https://github.com/getlarge/themoltnet/commit/94b5a80b4b013f84723f56512470e9dc3c11e9bf))
* **docker:** skip nx sync during deploy packaging ([15a6910](https://github.com/getlarge/themoltnet/commit/15a6910f7dae541bc21610c970aaac7f84fd4bb0))
* **nx:** generate spec tsconfigs for source tests ([899d887](https://github.com/getlarge/themoltnet/commit/899d8875775ad7757f41ced89643a1bf3fce1e9f))
* **rest-api:** avoid nested DBOS tx in orphan sweeper ([3ba3109](https://github.com/getlarge/themoltnet/commit/3ba3109e3fe40a9e3747e72d32135d1a91729695))
* **rest-api:** avoid nested DBOS tx in orphan sweeper ([f9c8a69](https://github.com/getlarge/themoltnet/commit/f9c8a692aaa81158e70b10f26eed3e8e1e01ca50))
* **rest-api:** narrow per-target Nx outputs so cache restore doesn't wipe siblings ([ba9c1f7](https://github.com/getlarge/themoltnet/commit/ba9c1f75037997a11f84f1e5eecb15940d0b69f4))
* **rest-api:** use enum in owned-team filter ([f288c04](https://github.com/getlarge/themoltnet/commit/f288c0475b76f72f303d2ff61037c37da023b929))
* **teams:** make role rewrites safe ([be70d26](https://github.com/getlarge/themoltnet/commit/be70d26d74b3455920be1165a9287557a8e8cd9e))
