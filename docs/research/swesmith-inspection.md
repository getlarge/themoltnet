# SWE-smith Inspection

Length per dataset: 20
Offsets: 0, 100, 500, 1000, 2000, 4000

Datasets inspected:

- `SWE-bench/SWE-smith-ts`
- `SWE-bench/SWE-smith-js`

## SWE-bench/SWE-smith-ts

Rows inspected: 120
Offsets sampled: 0, 100, 500, 1000, 2000, 4000

Top repos in sample:

- `swesmith/FuelLabs__fuels-ts.b3f37c91`: 56
- `swesmith/Redocly__redoc.d41fd46f`: 20
- `swesmith/fabricjs__fabric.js.6742471c`: 20
- `swesmith/trpc__trpc.2f40ba93`: 20
- `swesmith/Effect-TS__effect.5df4da10`: 4

Sample tasks:

### `Effect-TS__effect.5df4da10.func_pm_op_break_chains__q2q15uwz`

- offset: 0
- repo: `swesmith/Effect-TS__effect.5df4da10`
- fail_to_pass: 2
- pass_to_pass: 118
- problem: Iterator traversal in redBlackTree.iterator.ts short-circuited — traversal/memory regression Description After the recent change to packages/effect/src/internal/redBlackTree/iterator.ts the in-order traversal no longe...

### `Effect-TS__effect.5df4da10.func_pm_op_change__62k2v32e`

- offset: 0
- repo: `swesmith/Effect-TS__effect.5df4da10`
- fail_to_pass: 7
- pass_to_pass: 646
- problem: RedBlackTree iterator throws TypeError: Cannot read properties of undefined (reading 'right') when iterating I started seeing a runtime error coming from the red-black tree iterator while doing simple SortedSet iterat...

### `FuelLabs__fuels-ts.b3f37c91.func_pm_ctrl_invert_if__ub8rhawu`

- offset: 100
- repo: `swesmith/FuelLabs__fuels-ts.b3f37c91`
- fail_to_pass: 3
- pass_to_pass: 249
- problem: transaction-request: Cannot set properties of undefined when funding with asset inputs After the recent change in packages/account/src/providers/transaction-request/transaction-request.ts, attempting to fund a transac...

### `FuelLabs__fuels-ts.b3f37c91.func_pm_ctrl_invert_if__x0c5dags`

- offset: 100
- repo: `swesmith/FuelLabs__fuels-ts.b3f37c91`
- fail_to_pass: 1
- pass_to_pass: 254
- problem: Title: provider.ts treats B256 block IDs as block heights — fetching by id breaks Description Hi! After the recent changes in packages/account/src/providers/provider.ts, calling the provider with a B256 block id (64‑h...

### `FuelLabs__fuels-ts.b3f37c91.func_pm_remove_assign__v2jy06sa`

- offset: 500
- repo: `swesmith/FuelLabs__fuels-ts.b3f37c91`
- fail_to_pass: 1
- pass_to_pass: 255
- problem: Title Transform/build error: "Expected identifier but found '>>'" in packages/program/src/functions/base-invocation-scope.ts Description After the recent changes to packages/program/src/functions/base-invocation-scope...

### `FuelLabs__fuels-ts.b3f37c91.func_pm_remove_assign__vr08jgtn`

- offset: 500
- repo: `swesmith/FuelLabs__fuels-ts.b3f37c91`
- fail_to_pass: 26
- pass_to_pass: 218
- problem: Syntax error in packages/account/src/providers/transaction-response/transaction-response.ts after refactor There appears to be a syntax error introduced in packages/account/src/providers/transaction-response/transacti...

### `Redocly__redoc.d41fd46f.func_pm_op_swap__2ffr21uz`

- offset: 1000
- repo: `swesmith/Redocly__redoc.d41fd46f`
- fail_to_pass: 2
- pass_to_pass: 3
- problem: OpenAPIParser.deref signature is broken — TypeScript compilation errors after latest change Description After pulling the recent changes, TypeScript compilation fails in a number of modules that call OpenAPIParser.der...

### `Redocly__redoc.d41fd46f.func_pm_op_swap__4bex8xzb`

- offset: 1000
- repo: `swesmith/Redocly__redoc.d41fd46f`
- fail_to_pass: 2
- pass_to_pass: 3
- problem: humanizeMultipleOfConstraint signature corrupted in src/utils/openapi.ts Description After the recent patch, the implementation of humanizeMultipleOfConstraint in src/utils/openapi.ts has been corrupted — the function...

### `fabricjs__fabric.js.6742471c.func_pm_op_break_chains__ba0m43x8`

- offset: 2000
- repo: `swesmith/fabricjs__fabric.js.6742471c`
- fail_to_pass: 24
- pass_to_pass: 129
- problem: Convolute filter indexes pixels incorrectly after recent change I noticed a regression in the Convolute image filter: the filter is no longer indexing into the source image pixels correctly. With an identity kernel (a...

### `fabricjs__fabric.js.6742471c.func_pm_op_break_chains__birkibq8`

- offset: 2000
- repo: `swesmith/fabricjs__fabric.js.6742471c`
- fail_to_pass: 40
- pass_to_pass: 57
- problem: \_checkTarget throws / treats invisible objects as hittable after recent change Description \_after a recent change to SelectableCanvas, calling the internal hit-test function can throw when given a null/undefined objec...

### `trpc__trpc.2f40ba93.func_pm_remove_assign__xrwechqx`

- offset: 4000
- repo: `swesmith/trpc__trpc.2f40ba93`
- fail_to_pass: 11
- pass_to_pass: 156
- problem: Unpromise.subscribe sometimes throws "Cannot convert undefined or null to object" Description After the changes in packages/server/src/vendor/unpromise/unpromise.ts, calling subscribe on an Unpromise can throw a TypeE...

### `trpc__trpc.2f40ba93.func_pm_remove_assign__y8othomu`

- offset: 4000
- repo: `swesmith/trpc__trpc.2f40ba93`
- fail_to_pass: 6
- pass_to_pass: 157
- problem: observable -> ReadableStream / async-iterable no longer subscribes (streaming hangs) Description After the recent change, converting an observable to a ReadableStream / async iterable no longer subscribes to the obser...

## SWE-bench/SWE-smith-js

Rows inspected: 120
Offsets sampled: 0, 100, 500, 1000, 2000, 4000

Top repos in sample:

- `swesmith/Automattic__mongoose.5f57a5bb`: 60
- `swesmith/axios__axios.ef36347f`: 20
- `swesmith/caolan__async.23dbf76a`: 20
- `swesmith/josdejong__mathjs.04e6e2d7`: 20

Sample tasks:

### `Automattic__mongoose.5f57a5bb.func_pm_arg_swap__4qvlr1m6`

- offset: 0
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 98
- pass_to_pass: 3355
- problem: createIndex arguments appear to be swapped, causing index creation to fail Description After updating to mongoose@8.15.1 (MongoDB 7.0.14 in my environment), creating indexes that use index options (eg. background, uni...

### `Automattic__mongoose.5f57a5bb.func_pm_arg_swap__4441ryyi`

- offset: 0
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 108
- pass_to_pass: 3345
- problem: Array push / save no longer produces atomic $push updates (Update document requires atomic operators) ### Bug summary After the recent changes to array handling, pushing to an array/map field on a document then callin...

### `Automattic__mongoose.5f57a5bb.func_pm_ctrl_invert_if__ctuahnv1`

- offset: 100
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 33
- pass_to_pass: 3420
- problem: Map of POJO subdocs no longer yields Subdocuments (missing set/toObject, plain objects returned) Creating a Map whose "of" is a plain object (POJO) now produces plain objects instead of subdocuments. Methods you expec...

### `Automattic__mongoose.5f57a5bb.func_pm_ctrl_invert_if__e9vhvvpx`

- offset: 100
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 2
- pass_to_pass: 3451
- problem: populated() with getters on embedded schema throws "localFieldValue.map is not a function" Description After the recent change to populate helpers, attempting to populate a path where the localField lives inside an em...

### `Automattic__mongoose.5f57a5bb.func_pm_remove_cond__5m1mm1hr`

- offset: 500
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 12
- pass_to_pass: 3440
- problem: populate virtuals: function-valued localField/match not being evaluated, missing options no longer errors Description After the recent changes to virtual populate handling, a few behaviors regressed: - If localField i...

### `Automattic__mongoose.5f57a5bb.func_pm_remove_cond__1z4nqh5b`

- offset: 500
- repo: `swesmith/Automattic__mongoose.5f57a5bb`
- fail_to_pass: 15
- pass_to_pass: 3438
- problem: populate of virtuals (especially with discriminators / nested) now throws StrictPopulateError / TypeError After updating, attempting to populate virtuals that live under nested paths or under discriminators results in...

### `axios__axios.ef36347f.func_pm_op_change_const__en5up484`

- offset: 1000
- repo: `swesmith/axios__axios.ef36347f`
- fail_to_pass: 4
- pass_to_pass: 165
- problem: toFormData throws TypeError: Cannot read properties of undefined (reading 'join') Describe the bug After the recent change to lib/helpers/toFormData.js, calling the toFormData helper (or any code path that relies on i...

### `axios__axios.ef36347f.func_pm_op_change_const__rnu0o98c`

- offset: 1000
- repo: `swesmith/axios__axios.ef36347f`
- fail_to_pass: 22
- pass_to_pass: 147
- problem: findKey / case-insensitive key lookup in utils appears to skip the first key causing header lookups to fail ### Description After the recent changes to the utils area, a bunch of header-related operations (getting/set...

### `caolan__async.23dbf76a.func_pm_arg_swap__e9x29l6x`

- offset: 2000
- repo: `swesmith/caolan__async.23dbf76a`
- fail_to_pass: 19
- pass_to_pass: 555
- problem: asyncify rejects cause uncaught TypeError: "callback is not a function" Description After the recent change in lib/asyncify.js, rejected promises passed through asyncify don't get delivered to the provided callback. I...

### `caolan__async.23dbf76a.func_pm_arg_swap__bkapb3lt`

- offset: 2000
- repo: `swesmith/caolan__async.23dbf76a`
- fail_to_pass: 2
- pass_to_pass: 553
- problem: pushAsync regressions: pushing arrays / single items mis-handled (TypeError / unexpected callback) Description After the recent change to the queue internals, pushAsync is behaving incorrectly in two scenarios: - Push...

### `josdejong__mathjs.04e6e2d7.func_pm_ternary_swap__k25gpss9`

- offset: 4000
- repo: `swesmith/josdejong__mathjs.04e6e2d7`
- fail_to_pass: 4
- pass_to_pass: 5428
- problem: xgcd / invmod regressions: wrong coefficient (becomes 0) and matrix/array return-type inverted Description After a recent change, arithmetic functions that rely on xgcd (notably xgcd itself and invmod for BigNumbers /...

### `josdejong__mathjs.04e6e2d7.func_pm_ternary_swap__idynbk0q`

- offset: 4000
- repo: `swesmith/josdejong__mathjs.04e6e2d7`
- fail_to_pass: 4
- pass_to_pass: 5428
- problem: complexEigs: TypeError when running eigs with BigNumber/Complex configuration Describe the bug When computing eigenvalues/vectors with eigs while using BigNumber precision (and/or Complex entries), math.eigs throws a ...
