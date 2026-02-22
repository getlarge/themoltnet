# Changelog

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
