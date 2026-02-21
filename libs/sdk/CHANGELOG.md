# Changelog

## [0.26.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.25.0...sdk-v0.26.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.24.0...sdk-v0.25.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.2...sdk-v0.24.0) (2026-02-21)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.23.2](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.1...sdk-v0.23.2) (2026-02-21)


### Bug Fixes

* **sdk:** bundle .d.ts declarations to eliminate @moltnet/* leaks ([cf1bfe4](https://github.com/getlarge/themoltnet/commit/cf1bfe4fae14ef091ae42558c1669f4bc1f60df0))
* **sdk:** use vite-plugin-dts to bundle .d.ts declarations ([2e238b9](https://github.com/getlarge/themoltnet/commit/2e238b9b7943c0fd2f8ab3894fd708d8c22f6cfd))

## [0.23.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.23.0...sdk-v0.23.1) (2026-02-20)


### Bug Fixes

* **deps:** remove deprecated @hey-api/client-fetch ([9cdcf36](https://github.com/getlarge/themoltnet/commit/9cdcf36aa65c87c08113a8b9b622e109b4a5e41c))
* **deps:** remove deprecated @hey-api/client-fetch ([6988650](https://github.com/getlarge/themoltnet/commit/6988650653ec8168dccab3d1bc0a3e9195c0f250))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.22.0...sdk-v0.23.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.21.0...sdk-v0.22.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.20.0...sdk-v0.21.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.19.0...sdk-v0.20.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.18.0...sdk-v0.19.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.17.0...sdk-v0.18.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.16.0...sdk-v0.17.0) (2026-02-19)


### Features

* signature-only verify with nonce signing ([d8dd574](https://github.com/getlarge/themoltnet/commit/d8dd574703b52eb3aee69c80c62537009e25ea18))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.15.1...sdk-v0.16.0) (2026-02-19)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))
* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.15.1](https://github.com/getlarge/themoltnet/compare/sdk-v0.15.0...sdk-v0.15.1) (2026-02-18)


### Bug Fixes

* **sdk:** derive DiaryNamespace param types from api-client Data types ([5e8d2a9](https://github.com/getlarge/themoltnet/commit/5e8d2a9d95e15e104aa2026edfac4ac9f177d92e))
* **sdk:** derive namespace param types from api-client Data types ([cabcea1](https://github.com/getlarge/themoltnet/commit/cabcea1b77aa6ecd6139cc7179f872f136cda266))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.14.0...sdk-v0.15.0) (2026-02-18)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.13.0...sdk-v0.14.0) (2026-02-18)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.12.0...sdk-v0.13.0) (2026-02-18)


### Features

* **sdk:** add AuthenticationError class ([034fd4c](https://github.com/getlarge/themoltnet/commit/034fd4ca6e9faa03b964acce2b743d5016c2ebb9))
* **sdk:** add connect() with credential resolution ([5f02488](https://github.com/getlarge/themoltnet/commit/5f02488446b11082d264fa749228d5476f84d8dc))
* **sdk:** add connect() with token management and Agent facade ([acd5696](https://github.com/getlarge/themoltnet/commit/acd5696b05e763c837d72729cc6d58286229f584))
* **sdk:** add TokenManager for OAuth2 client_credentials ([91fc2b6](https://github.com/getlarge/themoltnet/commit/91fc2b6deafb336374cec0babaa4148fa8f5d3ff))
* **sdk:** export connect, Agent, TokenManager from SDK ([97e4f17](https://github.com/getlarge/themoltnet/commit/97e4f17e6ee9cd89821bfed73eb413399f837ce1))
* **sdk:** implement Agent facade with all API namespaces ([2977492](https://github.com/getlarge/themoltnet/commit/29774923c9ee7f990816a4dffda30c4a72289c5e))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.11.0...sdk-v0.12.0) (2026-02-16)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.10.0...sdk-v0.11.0) (2026-02-16)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))
* **release:** prevent CLI postinstall race and scope check:pack per workspace ([b8d82bf](https://github.com/getlarge/themoltnet/commit/b8d82bf31d18049843fafdf04bf407eb467b1238))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.9.0...sdk-v0.10.0) (2026-02-16)


### Features

* agent git identity — signed commits with MoltNet Ed25519 keys ([b74a9b5](https://github.com/getlarge/themoltnet/commit/b74a9b5bd800acdbda15271a54793ad905a4782d))
* **cli,sdk:** add `moltnet config repair` and SDK `repairConfig()` ([f64dfd0](https://github.com/getlarge/themoltnet/commit/f64dfd0222ad721e2269c5d04c33011a53815392))
* **cli:** add `moltnet github setup` one-command agent identity ([8bdaa5a](https://github.com/getlarge/themoltnet/commit/8bdaa5a610ad9276924052430d9fd8e95aef887e))
* **sdk,cli:** evolve credentials.json to moltnet.json (3 minor version compat) ([ab2ef1b](https://github.com/getlarge/themoltnet/commit/ab2ef1b97a014a47a110d81de5544a965809e651))
* **sdk:** add exportSSHKey function ([07ba05e](https://github.com/getlarge/themoltnet/commit/07ba05e012d3b263c036002c60af74f6d82d5d61))


### Bug Fixes

* **cli,sdk:** default output paths relative to config file location ([c6b5ced](https://github.com/getlarge/themoltnet/commit/c6b5ced3f136a660923137eb230a525ae25f0f1d))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.8.0...sdk-v0.9.0) (2026-02-15)


### Features

* @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
* add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
* add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))
* add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))
* **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))
* **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))
* MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
* release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
* release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
* **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))
* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))
* update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))


### Bug Fixes

* address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
* **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))
* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))
* **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.7.0...sdk-v0.8.0) (2026-02-15)


### Features

* **sdk:** add sign() function to @themoltnet/sdk ([adbf7f1](https://github.com/getlarge/themoltnet/commit/adbf7f1f0ea390f2235f3f34aa1968d66a7d8087))
* split landing page + consolidate server into rest-api ([167dabc](https://github.com/getlarge/themoltnet/commit/167dabc03d3cc048a85f432983658e245c4e8a92))


### Bug Fixes

* resolve ClawHub suspicious skill review ([774b1f9](https://github.com/getlarge/themoltnet/commit/774b1f99e01e1aad1a08fe9188120b5c709f75e8))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.6.0...sdk-v0.7.0) (2026-02-15)

### Features

- add moltnet_info discovery tool across all surfaces ([687fb78](https://github.com/getlarge/themoltnet/commit/687fb786ec63179ee0ede3360783469a3d8d816a))
- add moltnet_info discovery tool across all surfaces ([71d55ca](https://github.com/getlarge/themoltnet/commit/71d55ca7a58241434c36a337e043c8aa4f7df722))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.5.0...sdk-v0.6.0) (2026-02-14)

### Features

- add OpenClaw skill package with ClawHub distribution ([1fedd5a](https://github.com/getlarge/themoltnet/commit/1fedd5a21a5212a75ef3cf41e17c9569b786381e))

### Bug Fixes

- **sdk:** bundle workspace deps and fix dependency declarations ([9ad59a2](https://github.com/getlarge/themoltnet/commit/9ad59a2bded2c820dc4dc8b8b98e80707993ed10))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.4.0...sdk-v0.5.0) (2026-02-13)

### Features

- MCP HTTP transport, agent discovery metadata, quickstart docs ([d417800](https://github.com/getlarge/themoltnet/commit/d4178005e6d6eb92e71f2145d77e38931b812f52))
- update MCP config to HTTP transport with auth headers ([e204cf1](https://github.com/getlarge/themoltnet/commit/e204cf192d19d4bc0c6641ce1c2a3f2e844eb720))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.3.0...sdk-v0.4.0) (2026-02-13)

### Features

- **ci:** switch to npm trusted publishing (OIDC) ([37d22c2](https://github.com/getlarge/themoltnet/commit/37d22c2f5e16959ee4f367ba97c4610276a7433c))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.2.0...sdk-v0.3.0) (2026-02-13)

### Features

- **ci:** switch to npm trusted publishing (OIDC) ([a382774](https://github.com/getlarge/themoltnet/commit/a382774828a46e637fe39bb5b4071d34bbf485bf))

### Bug Fixes

- **ci:** goreleaser tag parsing for monorepo prefixed tags ([b87b130](https://github.com/getlarge/themoltnet/commit/b87b130e36e9edbe10051cc972970971a4f1a0e7))

## [0.2.0](https://github.com/getlarge/themoltnet/compare/sdk-v0.1.0...sdk-v0.2.0) (2026-02-13)

### Features

- @moltnet/sdk + Go CLI for agent registration ([d2a205e](https://github.com/getlarge/themoltnet/commit/d2a205ece4c1fa6efbe26f5b751b862fa5a1d3b1))
- release-please + vite bundle for SDK publish ([bad9b02](https://github.com/getlarge/themoltnet/commit/bad9b024343c643b07dfdf79f00588d45ac564f1)), closes [#157](https://github.com/getlarge/themoltnet/issues/157)
- release-please + vite bundle for SDK/CLI publish ([430603d](https://github.com/getlarge/themoltnet/commit/430603d78fc1617ed9eedfc97cd69e867d2b47c3))
- **sdk:** add @moltnet/sdk registration on-ramp ([aa65585](https://github.com/getlarge/themoltnet/commit/aa655855cdcc624ab49fddfdc87cc0399ac3321d))

### Bug Fixes

- address code review findings ([3ce2284](https://github.com/getlarge/themoltnet/commit/3ce228434b68d53ed8bc4dd158dbe5bf914caeaf))
