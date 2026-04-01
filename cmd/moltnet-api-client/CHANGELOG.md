# Changelog

## [1.4.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.4.0...moltnet-api-client-v1.4.1) (2026-04-01)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.4.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.3.0...moltnet-api-client-v1.4.0) (2026-03-31)


### Features

* add Group entity — teams/groups chunk 1 ([8e79714](https://github.com/getlarge/themoltnet/commit/8e79714519eec8767b9f3ab77c40f4ff64dc4004))

## [1.3.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.2.0...moltnet-api-client-v1.3.0) (2026-03-31)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.2.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.1.1...moltnet-api-client-v1.2.0) (2026-03-31)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [1.1.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.1.0...moltnet-api-client-v1.1.1) (2026-03-30)


### Bug Fixes

* **ci:** repair rendered-pack validation and generated clients ([3d4a05d](https://github.com/getlarge/themoltnet/commit/3d4a05dadb96d878fc6431b8e3be8ff4039d85f5))
* **packs:** return rendered markdown from persisted renders ([5acec13](https://github.com/getlarge/themoltnet/commit/5acec1304b249186cb54557b9d16383dc28dbeaa))

## [1.1.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.1...moltnet-api-client-v1.1.0) (2026-03-30)


### Features

* teams foundation — schema, Keto OPL, auth layer ([753e8ac](https://github.com/getlarge/themoltnet/commit/753e8ac56a9af6feb63c37edfef81699870444a2))

## [1.0.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.0...moltnet-api-client-v1.0.1) (2026-03-29)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [2.0.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v1.0.0...moltnet-api-client-v2.0.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [1.0.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.83.1...moltnet-api-client-v1.0.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))
* standardize pagination total counts, multi-entryType, SDK pack fix ([d051515](https://github.com/getlarge/themoltnet/commit/d051515b27cc0ec3eef30d9966477c8320b3f189))

## [0.83.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.83.0...moltnet-api-client-v0.83.1) (2026-03-29)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.83.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.82.0...moltnet-api-client-v0.83.0) (2026-03-29)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.82.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.81.0...moltnet-api-client-v0.82.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.81.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.80.0...moltnet-api-client-v0.81.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.80.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.79.0...moltnet-api-client-v0.80.0) (2026-03-28)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.79.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.78.0...moltnet-api-client-v0.79.0) (2026-03-28)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.78.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.77.0...moltnet-api-client-v0.78.0) (2026-03-25)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.77.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.76.0...moltnet-api-client-v0.77.0) (2026-03-25)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* **codegen:** add nullable, discriminated union, and multi-type conversions to normalize-spec ([8becedd](https://github.com/getlarge/themoltnet/commit/8beceddce35f07d5b6e80ca3bc27e41961a9b167))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.76.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.75.0...moltnet-api-client-v0.76.0) (2026-03-25)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.75.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.74.0...moltnet-api-client-v0.75.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.74.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.73.0...moltnet-api-client-v0.74.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.73.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.72.0...moltnet-api-client-v0.73.0) (2026-03-23)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))
* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))
* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.72.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.71.0...moltnet-api-client-v0.72.0) (2026-03-23)


### Features

* pack GC — garbage collect expired non-pinned context packs ([268e31f](https://github.com/getlarge/themoltnet/commit/268e31fba44caca524901560eaecff07f01a73ca))


### Bug Fixes

* **pack-gc:** address code review — atomicity, logger, tests, Go client ([66309f6](https://github.com/getlarge/themoltnet/commit/66309f6b2f55fc2df313d375cc67eafac3e920ea))

## [0.71.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.70.0...moltnet-api-client-v0.71.0) (2026-03-21)


### Features

* add custom pack preview/create across REST, MCP, and generated clients ([25dee1e](https://github.com/getlarge/themoltnet/commit/25dee1e4d4fe82cf19a2244e509d6bd5d9678bb1))
* **mcp-server:** add custom pack tools and e2e coverage ([62f2e36](https://github.com/getlarge/themoltnet/commit/62f2e367265ddd5d4ad9f4a7447b50e11f04f5c7))


### Bug Fixes

* **packs:** stabilize deterministic pack identity flows ([ff21db5](https://github.com/getlarge/themoltnet/commit/ff21db5cd47d6b5c447565eeaba5de914a91c56b))

## [0.70.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.69.1...moltnet-api-client-v0.70.0) (2026-03-21)


### Features

* **api:** diary tag discovery endpoint ([acd532f](https://github.com/getlarge/themoltnet/commit/acd532fc44430254c2fff7cc69bfb3f6b191720f))


### Bug Fixes

* address PR review — escape LIKE wildcards, fix falsy checks, regen Go client ([6192659](https://github.com/getlarge/themoltnet/commit/6192659b831f2db6a578437cac9e8a24b18f2704))

## [0.69.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.45.0...moltnet-api-client-v0.69.1) (2026-03-21)


### Miscellaneous Chores

* **moltnet-api-client:** Synchronize go-cli versions

## [0.45.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.44.0...moltnet-api-client-v0.45.0) (2026-03-21)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.44.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.43.0...moltnet-api-client-v0.44.0) (2026-03-21)


### Features

* add temporal filters and entryTypes to diaries_compile ([a9587dd](https://github.com/getlarge/themoltnet/commit/a9587dd63463121f06cb88b38c4e0129f3a94c1b))
* entry relation REST routes + MCP relation & pack tools ([b0007be](https://github.com/getlarge/themoltnet/commit/b0007be931452215284c93a3c776f1e9714999f2))

## [0.43.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.42.0...moltnet-api-client-v0.43.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.42.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.41.0...moltnet-api-client-v0.42.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.41.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.40.0...moltnet-api-client-v0.41.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))
* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.40.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.39.0...moltnet-api-client-v0.40.0) (2026-03-20)


### Features

* add provenance viewer ergonomics and creator attribution ([863fe25](https://github.com/getlarge/themoltnet/commit/863fe250c14e6d60e21439362b8ede8ce7fd90a0))


### Bug Fixes

* **api:** close remaining provenance review gaps ([a7f5b72](https://github.com/getlarge/themoltnet/commit/a7f5b72c48a26daee5074c55661c3fabb2bb000b))
* **landing:** address provenance viewer review ([27d78ea](https://github.com/getlarge/themoltnet/commit/27d78eafc683b2af1c74e1e3ccda2fcaa679b1eb))

## [0.39.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.38.0...moltnet-api-client-v0.39.0) (2026-03-19)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.38.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.37.0...moltnet-api-client-v0.38.0) (2026-03-19)


### Features

* **api:** add persisted context pack read routes ([1343f49](https://github.com/getlarge/themoltnet/commit/1343f493d47d678d43b694f2f0d39eb58b84d237))

## [0.37.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.36.0...moltnet-api-client-v0.37.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.36.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.35.0...moltnet-api-client-v0.36.0) (2026-03-18)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.35.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.34.0...moltnet-api-client-v0.35.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* compile workflow persists context packs with DAG-CBOR provenance ([d935491](https://github.com/getlarge/themoltnet/commit/d9354919960b799c482ed78068e9f83d304a7bfd))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.34.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.33.0...moltnet-api-client-v0.34.0) (2026-03-17)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.33.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.32.0...moltnet-api-client-v0.33.0) (2026-03-16)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.32.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.31.0...moltnet-api-client-v0.32.0) (2026-03-15)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.31.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.30.0...moltnet-api-client-v0.31.0) (2026-03-14)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))
* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.30.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.29.0...moltnet-api-client-v0.30.0) (2026-03-14)


### Features

* retry fetch + simplify content-signed entries ([#144](https://github.com/getlarge/themoltnet/issues/144), [#407](https://github.com/getlarge/themoltnet/issues/407)) ([afb3139](https://github.com/getlarge/themoltnet/commit/afb3139650198a50bb1b7da337746ff7ec1fe485))


### Bug Fixes

* address Copilot review feedback ([202b875](https://github.com/getlarge/themoltnet/commit/202b8754f06f77c02340bcbdd17bc548d3425870))

## [0.29.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.28.0...moltnet-api-client-v0.29.0) (2026-03-08)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))
* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.28.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.27.0...moltnet-api-client-v0.28.0) (2026-03-08)


### Features

* **search:** add excludeTags filtering for distill and entries ([675f9c6](https://github.com/getlarge/themoltnet/commit/675f9c67944ae480cdf55a6061967812a9da4caf))

## [0.27.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.26.0...moltnet-api-client-v0.27.0) (2026-03-08)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.26.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.25.0...moltnet-api-client-v0.26.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.25.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.24.0...moltnet-api-client-v0.25.0) (2026-03-07)


### Features

* **api,sdk:** entry-centric routes + distill SDK methods ([d69b68e](https://github.com/getlarge/themoltnet/commit/d69b68e4f711778b89c97c71065ee8963dbc931b))
* **api:** add entry-centric entry routes and distill sdk facade ([2e93622](https://github.com/getlarge/themoltnet/commit/2e9362245fc9606321f0c19ced84c8b69b5d6c57))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* entry-centric MCP tools + remove legacy diary entry alias routes ([534826d](https://github.com/getlarge/themoltnet/commit/534826d3c88e9d7c4c8e72a8b3c1e572eca40f93))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))
* **rest-api:** remove legacy diary entry alias routes ([a724cd9](https://github.com/getlarge/themoltnet/commit/a724cd90a4a357d82a2c10099fb9c679041bea89))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.24.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.23.0...moltnet-api-client-v0.24.0) (2026-03-06)


### Features

* **rest-api:** context distill phase 2 — consolidate + compile endpoints ([549f69c](https://github.com/getlarge/themoltnet/commit/549f69c5a84263e9af698669115a7649e8f6433d))

## [0.23.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.22.0...moltnet-api-client-v0.23.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.22.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.21.0...moltnet-api-client-v0.22.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.21.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.20.0...moltnet-api-client-v0.21.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.20.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.19.0...moltnet-api-client-v0.20.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.19.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.18.0...moltnet-api-client-v0.19.0) (2026-03-04)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))
* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.18.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.17.0...moltnet-api-client-v0.18.0) (2026-03-04)


### Features

* content-signed immutable diary entries ([0c765bb](https://github.com/getlarge/themoltnet/commit/0c765bb8cf6fe8d57e5179c7cba1e468431c78c1))


### Bug Fixes

* regenerate Go API client and fix CodeQL shell injection ([9a23e70](https://github.com/getlarge/themoltnet/commit/9a23e703c77f7a23d584165e8d62e4e3c3bf8c26))

## [0.17.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.16.0...moltnet-api-client-v0.17.0) (2026-02-27)


### Features

* **legreffier-cli:** add setup subcommand and Codex adapter ([#324](https://github.com/getlarge/themoltnet/issues/324)) ([7e50e04](https://github.com/getlarge/themoltnet/commit/7e50e04458a6da8b2dcf61dcef51720f27aa8733))

## [0.16.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.15.0...moltnet-api-client-v0.16.0) (2026-02-27)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.15.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.14.0...moltnet-api-client-v0.15.0) (2026-02-27)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))
* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))
* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))
* **legreffier-cli:** fix CI test failures — update error message + vitest SDK alias ([7247f51](https://github.com/getlarge/themoltnet/commit/7247f511552c7ab76a413ba4bd5745eceb247f7c))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))
* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.14.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.2...moltnet-api-client-v0.14.0) (2026-02-27)


### Features

* **legreffier-cli:** LeGreffier init CLI — full onboarding flow ([57caf23](https://github.com/getlarge/themoltnet/commit/57caf23273fe37bd2363746803da2f5157707631))

## [0.13.2](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.1...moltnet-api-client-v0.13.2) (2026-02-26)


### Bug Fixes

* **go-api-client:** regenerate from updated OpenAPI spec (includeSuspicious param) ([3c7fe1a](https://github.com/getlarge/themoltnet/commit/3c7fe1a4bc0f1a57d5fdadb43cd2f70800daaffd))

## [0.13.1](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.13.0...moltnet-api-client-v0.13.1) (2026-02-25)


### Bug Fixes

* **api-client:** regenerate Go client with ogen v1.20.0 ([4ca9f34](https://github.com/getlarge/themoltnet/commit/4ca9f347928618f3440ed25bf26666185c0238b3))
* **observability:** BigInt crash fix + Axiom edge endpoint for EU ([4b8bb67](https://github.com/getlarge/themoltnet/commit/4b8bb6778bb7e3e56ada81f0d19f1ebf056b8b50))

## [0.13.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.12.0...moltnet-api-client-v0.13.0) (2026-02-24)


### Features

* **rest-api:** LeGreffier onboarding workflow — DBOS + 4 public endpoints ([#287](https://github.com/getlarge/themoltnet/issues/287) Phase 2) ([f8edb0a](https://github.com/getlarge/themoltnet/commit/f8edb0a4c509450bb6782e05bdcf5998f5ff0896))


### Bug Fixes

* **rest-api:** address Copilot PR [#305](https://github.com/getlarge/themoltnet/issues/305) review comments ([ff615a5](https://github.com/getlarge/themoltnet/commit/ff615a585c7ece56e1e840882640b811b1af6145))

## [0.12.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.11.0...moltnet-api-client-v0.12.0) (2026-02-24)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.11.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.10.0...moltnet-api-client-v0.11.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.10.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.9.0...moltnet-api-client-v0.10.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.9.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.8.0...moltnet-api-client-v0.9.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.8.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.7.0...moltnet-api-client-v0.8.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.7.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.6.0...moltnet-api-client-v0.7.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.6.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.5.0...moltnet-api-client-v0.6.0) (2026-02-23)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
* multi-diary catalogs, sharing, and Keto permission enforcement ([b7d0103](https://github.com/getlarge/themoltnet/commit/b7d0103f99eaac7afaa358227a1fd0acaba11013))


### Bug Fixes

* **ci:** regenerate Go client, seed diary FK, fix flaky voucher test ([0f6d86e](https://github.com/getlarge/themoltnet/commit/0f6d86e9a4f961ad73f26d0bb26cb576a54d3582))

## [0.5.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.4.0...moltnet-api-client-v0.5.0) (2026-02-22)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))

## [0.4.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.3.0...moltnet-api-client-v0.4.0) (2026-02-22)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))

## [0.3.0](https://github.com/getlarge/themoltnet/compare/moltnet-api-client-v0.2.0...moltnet-api-client-v0.3.0) (2026-02-21)


### Features

* **cli:** add authenticated API operations to Go CLI ([5b0a6b9](https://github.com/getlarge/themoltnet/commit/5b0a6b94a8a7262cbd022dd646b868596d29d076))
* **cli:** replace hand-written API client with ogen-generated client ([36302ae](https://github.com/getlarge/themoltnet/commit/36302aeb43f079ef6dab1a4009ca70e2a802a015))
