# Changelog

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
