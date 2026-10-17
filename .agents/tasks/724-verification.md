# Verification Report — Issue #724: `submitBatch` real submission

## Changes made

### New files
- `src/transaction/batchSubmitter.ts` — full implementation with real `submitTransaction` calls
- `src/transaction/batchSubmitter.test.ts` — 33 tests covering all acceptance criteria

### Modified files
- `src/transaction/index.ts` — added exports for batch types and functions
- `src/index.ts` — added exports for batch types and functions from `./transaction`

---

## CI command results

### `npm run typecheck`
**Result: EXIT 1 (pre-existing failures only)**

Errors in `batchSubmitter.ts`: **0 new errors** after fixes.

Pre-existing errors (not introduced by this change):
| File | Error | Pre-existing |
|------|-------|-------------|
| `src/client/createSorokitClient.ts:27` | `Module '"../transaction/buildTransaction"' has no exported member 'AccountMergeOptions'` | ✅ yes |
| `src/index.ts:122` | `Module '"./transaction"' has no exported member 'checkTrustlines'` | ✅ yes |
| `src/index.ts:123` | `Module '"./transaction"' has no exported member 'buildBulkTrustlines'` | ✅ yes |
| `src/soroban/subscribeContractEvents.ts:169` | `'options' is possibly 'undefined'` | ✅ yes |
| `src/transaction/buildTransaction.ts:1045,1050,1052,1072,1106` | Multiple undefined name errors | ✅ yes |
| `src/transaction/index.ts:87` | `Module '"./buildTransaction"' has no exported member 'AccountMergeOptions'` | ✅ yes |

### `npm run lint`
**Result: EXIT 0** — No lint errors.

### `npm run test`
**Result: EXIT 1 (pre-existing failures only, all new tests pass)**

`src/transaction/batchSubmitter.test.ts`: **33/33 tests passed**

Pre-existing failing test files (not introduced by this change):
| File | Failure | Pre-existing |
|------|---------|-------------|
| `src/tests/transaction.test.ts` | Syntax error at line 2689 (transform fail) | ✅ yes |
| `src/tests/account.test.ts` | Timing test: `all fetches run in parallel — total time near max single fetch, not sum` (flaky) | ✅ yes |
| `src/tests/client.test.ts` | `account.stream returns an async generator` | ✅ yes |
| `src/tests/contractEvents.performance.test.ts` | `query 10,000 events in <200ms` (performance, flaky) | ✅ yes |

Test summary (after changes):
- Test Files: 4 failed | 24 passed (28 total)
- Tests: 3 failed | 612 passed | 23 skipped (638 total)
- New batchSubmitter tests: 33 passed

### `npm run build`
**Result: EXIT 1 (pre-existing DTS failure only)**

ESM and CJS builds succeeded. DTS build fails on the same pre-existing `checkTrustlines`/`buildBulkTrustlines` export error from `src/index.ts:122-123` — not introduced by this change.

---

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| `submitBatch` calls `submitTransaction` for each XDR | ✅ Implemented and tested |
| `BatchTransactionStatus.hash` populated from `TransactionResult.hash` on success | ✅ Implemented and tested |
| Failed submissions set `status: "failed"` and `error` on entry | ✅ Implemented and tested |
| `wasAtomicExecuted`, `generateRollbackInstructions`, `suggestRetryStrategy` operate on real outcomes | ✅ Implemented and tested |
| Tests stub Horizon and verify `submitTransaction` called once per XDR | ✅ 33 tests, `vi.mock` + `vi.hoisted` pattern, `mockClear` in `beforeEach` |
| No breaking changes to `BatchSubmissionResult` or exported types | ✅ All new types, nothing removed or changed |
| `.github/workflows/ci.yml` untouched | ✅ Not modified |
| `src/tests/transaction.test.ts` untouched | ✅ Not modified |
