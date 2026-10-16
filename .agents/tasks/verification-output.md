# Verification Output — Fix #723: calculateStorageRent / renewContractStorage

**Branch:** feat/dex-operations-550-551-553-555  
**Commits:** 254633a, 585aeb4  
**Verified at commit:** HEAD (585aeb4)

---

## npm run typecheck

```
> sorokit-core@0.1.0 typecheck
> tsc --noEmit

src/client/createSorokitClient.ts:27:15 - error TS2305: Module '"../transaction/buildTransaction"' has no exported member 'AccountMergeOptions'.
src/index.ts:122:3 - error TS2305: Module '"./transaction"' has no exported member 'checkTrustlines'.
src/index.ts:123:3 - error TS2305: Module '"./transaction"' has no exported member 'buildBulkTrustlines'.
src/soroban/subscribeContractEvents.ts:169:33 - error TS18048: 'options' is possibly 'undefined'.
src/transaction/buildTransaction.ts:1045:13 - error TS2304: Cannot find name 'AccountMergeOptions'.
src/transaction/buildTransaction.ts:1050:13 - error TS2304: Cannot find name 'retryWithBackoff'.
src/transaction/buildTransaction.ts:1052:11 - error TS2304: Cannot find name 'isNotFoundError'.
src/transaction/buildTransaction.ts:1072:22 - error TS2304: Cannot find name 'autoFetchSequence'.
src/transaction/buildTransaction.ts:1106:25 - error TS2552: Cannot find name 'assets'. Did you mean 'asset'?
src/transaction/index.ts:87:15 - error TS2305: Module '"./buildTransaction"' has no exported member 'AccountMergeOptions'.
Found 10 errors in 5 files.
```

**Status: PRE-EXISTING errors introduced by commit 3f2e0dd (feat: manage offer, liquidity pool, clawback, getOperations — before issue #723 work). None of these errors are in storageExpiration.ts, types.ts, or any file modified by this PR.**

Files touched by this PR (254633a + 585aeb4):
- src/soroban/storageExpiration.ts (created)
- src/soroban/types.ts (new types added)
- src/soroban/index.ts (new exports added)
- src/tests/storageExpiration.test.ts (created)

None of the typecheck errors appear in these files.

---

## npm run lint

```
> sorokit-core@0.1.0 lint
> node node_modules/eslint/bin/eslint.js src --ext .ts

(no output — clean)
```

**Status: PASSED (exit 0)**

---

## npm run test (storageExpiration only)

```
 RUN  v1.6.1

 ✓ src/tests/storageExpiration.test.ts (15)
   ✓ calculateStorageRent (6)
     ✓ calls getLedgerEntries with the correct key for each contractId
     ✓ returns ledgerSequence from the RPC response, not a hardcoded constant
     ✓ returns real TTL from RPC for each entry
     ✓ fails with NETWORK_ERROR when getLedgerEntries throws
     ✓ fails with TX_BUILD_FAILED when contractIds is empty — no RPC call made
     ✓ batches multiple contractIds in a single getLedgerEntries call
   ✓ renewContractStorage (5)
     ✓ calls Horizon.Server.loadAccount to obtain a real sequence number
     ✓ returned operationXdr decodes via TransactionBuilder.fromXDR without throwing
     ✓ suggestedSequence reflects the stubbed account sequence, not a hardcoded value
     ✓ fails with ACCOUNT_NOT_FOUND when loadAccount throws a 404-style error
     ✓ fails with ACCOUNT_FETCH_FAILED when loadAccount throws a non-404 error
   ✓ calculateStorageRent — estimatedRenewalCostStroops boundary cases (4)
     ✓ returns 0 cost when entry is already expired (0 remaining ledgers)
     ✓ returns 10000 stroops for 1 remaining ledger
     ✓ returns 10000 stroops for exactly 1000 remaining ledgers (boundary)
     ✓ returns 20000 stroops for 1001 remaining ledgers (crosses boundary)

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  14:50:11
   Duration  10.98s
```

**Status: PASSED — all 15 storageExpiration tests pass**

### Full test suite (npm run test)

```
 Test Files  1 failed | 26 passed (27)
      Tests  582 passed | 23 skipped (605)
```

The 1 failing file is `src/tests/transaction.test.ts` with a **syntax error at line 2689** (`Expected ")" but found ";"`). This file was last modified before commit 3f2e0dd and was not touched by this PR. The failure is pre-existing and unrelated to issue #723.

---

## npm run build

```
> sorokit-core@0.1.0 build
> tsup

CJS ⚡ Build success in 112792ms
ESM ⚡ Build success in 112838ms
DTS Build error

Error:
src/index.ts(122,3): error TS2305: Module '"./transaction"' has no exported member 'checkTrustlines'.
src/index.ts(123,3): error TS2305: Module '"./transaction"' has no exported member 'buildBulkTrustlines'.
```

**Status: CJS and ESM builds succeed. DTS (type declaration) build fails due to pre-existing errors from commit 3f2e0dd (same root cause as typecheck failures above). Not introduced by this PR.**

---

## Summary

| Step | Result | Notes |
|------|--------|-------|
| typecheck | Pre-existing failures only | 10 errors, all in files not touched by this PR |
| lint | ✅ PASSED | No warnings or errors |
| test (storageExpiration) | ✅ PASSED (15/15) | All new tests pass |
| test (full suite) | 582 passed, 1 file pre-existing failure | transaction.test.ts syntax error predates this PR |
| build (CJS + ESM) | ✅ PASSED | Distributable JS built successfully |
| build (DTS) | Pre-existing failure | Same type errors as typecheck |

All failures are traceable to commit 3f2e0dd and exist on this branch before the issue #723 changes were applied.
