# Changelog

## [0.3.4](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.3.3...n8n-nodes-moltnet-v0.3.4) (2026-09-02)


### Bug Fixes

* **n8n:** expose parseable credential source ([fe59643](https://github.com/getlarge/themoltnet/commit/fe596437a4c9364ccd4a4aaf3abd9808c7b60e96))
* **n8n:** expose parseable credential source ([c39bfde](https://github.com/getlarge/themoltnet/commit/c39bfde6c6f7215262f48c54545310f43886748d))

## [0.3.3](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.3.2...n8n-nodes-moltnet-v0.3.3) (2026-09-02)


### Bug Fixes

* **n8n:** expose credential at repository root ([695af1e](https://github.com/getlarge/themoltnet/commit/695af1ea05c4454d931f03b0f214ae3b5161c45f))
* **n8n:** expose credential at repository root ([4f1345c](https://github.com/getlarge/themoltnet/commit/4f1345c5cb7c04f6e7879576753e2b0f9a5becaf))

## [0.3.2](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.3.1...n8n-nodes-moltnet-v0.3.2) (2026-09-02)


### Bug Fixes

* **n8n:** satisfy Creator Portal prechecks ([43354cf](https://github.com/getlarge/themoltnet/commit/43354cf29781cd6a95dd991d52b3f60c22ec969f))
* **n8n:** use host-native generated API client ([c563d1f](https://github.com/getlarge/themoltnet/commit/c563d1f6ef697d4909f301254eee5546b478e726))

## [0.3.1](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.3.0...n8n-nodes-moltnet-v0.3.1) (2026-09-02)


### Bug Fixes

* **n8n:** publish Creator Portal author email ([101cf44](https://github.com/getlarge/themoltnet/commit/101cf440b9ecadf556652f5ecffc15578cb83cab))
* **n8n:** publish Creator Portal author email ([6e093f1](https://github.com/getlarge/themoltnet/commit/6e093f1019ecdf58f88f7614032bf77773185a00))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.2.0...n8n-nodes-moltnet-v0.3.0) (2026-09-02)


### Features

* **n8n:** add local development workflow ([c3c7efd](https://github.com/getlarge/themoltnet/commit/c3c7efd079bfa408906ed4e43626be982432e186))
* **n8n:** align community nodes with UX guidelines ([f958695](https://github.com/getlarge/themoltnet/commit/f958695819643f094a1d47fd82f4ff967a2cf05c))
* **n8n:** align task node with UX guidelines ([35c05c6](https://github.com/getlarge/themoltnet/commit/35c05c67660238c7d04dfed485d6d3ad62640f48))


### Bug Fixes

* **n8n:** replace stale development links ([a53fb1b](https://github.com/getlarge/themoltnet/commit/a53fb1be323e50dc333132f4f5c1cb9eac69f256))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/n8n-nodes-moltnet-v0.1.0...n8n-nodes-moltnet-v0.2.0) (2026-09-01)


### ⚠ BREAKING CHANGES

* **sdk:** @themoltnet/sdk connect now requires explicit credentials. Import connect from @themoltnet/sdk/node for ambient credential resolution.

### Features

* **n8n:** add MoltNet Create and Wait community nodes ([89a4964](https://github.com/getlarge/themoltnet/commit/89a496411cb7067c8e56e096dc6d534c3980b326))
* **n8n:** add MoltNet create and wait nodes ([969d4e6](https://github.com/getlarge/themoltnet/commit/969d4e6c7fb9156e3147ab8403da9635923b8637))


### Bug Fixes

* **n8n:** bound waits and cancellation ([8f0401f](https://github.com/getlarge/themoltnet/commit/8f0401faa251af94b203b136202dd279a3b04280))
* **n8n:** bust cached node icon assets ([7751804](https://github.com/getlarge/themoltnet/commit/7751804d06cda6dae2562f388464687d303578aa))
* **n8n:** format package validation script ([e7f6858](https://github.com/getlarge/themoltnet/commit/e7f6858ee2b8f2342c47afea572222a853647214))
* **n8n:** harden task execution ([a2bb1cf](https://github.com/getlarge/themoltnet/commit/a2bb1cf65cf62c7610ea6bac65fe03e9aa707d78))
* **n8n:** harden waits and npm release publication ([9fc2702](https://github.com/getlarge/themoltnet/commit/9fc270299284954bbf7dcfdc6abdbb87a13ec0c7))
* **n8n:** isolate credentials and harden task waits ([19c057f](https://github.com/getlarge/themoltnet/commit/19c057f49fc7f63285e135b4ce2f26bb82d63a0e))


### Code Refactoring

* **sdk:** make connect explicitly credentialed ([f8ddb6d](https://github.com/getlarge/themoltnet/commit/f8ddb6d5a521c528fc89c867bce989d17d58e806))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @themoltnet/sdk bumped to 0.139.0
