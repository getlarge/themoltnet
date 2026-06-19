# Changelog

## [0.3.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-state-v0.2.0...agent-daemon-state-v0.3.0) (2026-06-19)


### Features

* **#1293:** fork continuation mode + refcounted daemon workspaces ([5266f3b](https://github.com/getlarge/themoltnet/commit/5266f3bedfe9fe2a6cc79cc873db87cc5600bda4))
* **agent-daemon-state:** refcounted workspaces decoupled from slot ([1cd68ef](https://github.com/getlarge/themoltnet/commit/1cd68efc086057ea96b5a8101be3d94649d08da5))


### Bug Fixes

* **agent-daemon:** unique fork branch names + SQLite FK ON DELETE SET NULL ([86f0983](https://github.com/getlarge/themoltnet/commit/86f0983fe0f4f50e0f77615e28f8da0971eb79b1))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/agent-daemon-state-v0.1.0...agent-daemon-state-v0.2.0) (2026-06-06)


### Features

* **agent-daemon-state:** add durable state package ([1b5c5a9](https://github.com/getlarge/themoltnet/commit/1b5c5a9a40ce5f1685ed2602083856a77cc8a734))
* **agent-daemon:** extract durable daemon state ([3512bf1](https://github.com/getlarge/themoltnet/commit/3512bf1bde6ec2d05003e0cc60ff31352bb75f3d))
* **release:** publish agent daemon state ([66f5d25](https://github.com/getlarge/themoltnet/commit/66f5d2574040c4e112f737b00a30db95ed8aba1d))


### Bug Fixes

* **agent-daemon-state:** use bigint for pg timestamps ([927afd8](https://github.com/getlarge/themoltnet/commit/927afd8c9f36ba820ee67cd947ba87e6831bd00c))
