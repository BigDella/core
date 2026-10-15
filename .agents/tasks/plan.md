# Fix Plan: 13 Failing Tests in Sorokit Core

## Summary

Current status: **13 failing tests** across 4 test files.
- 4 failures in `src/tests/wallet.test.ts` (wallet discovery)
- 6 failures in `src/tests/didSupport.test.ts` (DID support functions)
- 2 failures in `src/network/federationResolver.test.ts` (federation resolver cache and verification)
- 1 failure in `src/lazy/lazy.test.ts` (lazy module re-exports)

---

## Failure Analysis

### Group 1: Wallet Discovery Failures (4 tests in `src/tests/wallet.test.ts`)

**Failing tests:**
1. `resolves a wallet address via federation` (line ~1830)
2. `falls back to stellar.toml when federation returns no account` (line ~1845)
3. `returns WALLET_NOT_FOUND when both federation and stellar.toml fail` (line ~1855)
4. `returns WALLET_NOT_FOUND when fetch throws a network error` (line ~1867)

**Root cause:** The `discoverWallet()` function in `src/wallet/discovery.ts` (line 95-140) has a fallback logic issue:
- When `resolveFederatedAddress()` fails (line 124), the code attempts a `stellar.toml` fallback (lines 127-138).
- If the `stellar.toml` fallback also fails, line 140 returns the original `resolved` error from federation.
- However, the federation resolution should only return `WALLET_NOT_FOUND` error when both methods fail, but currently it may be returning other error codes like `NETWORK_ERROR`.
- The tests are failing because:
  1. The federation spy check expects a federation URL but gets a stellar.toml URL
  2. When both fail, the wrong error code is being returned (e.g., `NETWORK_ERROR` instead of `WALLET_NOT_FOUND`)

**Files to change:**
- `src/wallet/discovery.ts` (lines 95-140)

**What to fix:**
- When both federation and stellar.toml fail, ensure the function always returns a `WALLET_NOT_FOUND` error, not the passthrough error from federation
- Ensure the federation URL resolution is attempted first, not skipped

---

### Group 2: DID Support Failures (6 tests in `src/tests/didSupport.test.ts`)

**Failing tests:**
1. `resolveDID > self-resolves a did:stellar DID when no resolver is provided` (line ~219)
2. `resolveDID > self-resolution produces a StellarVerificationKey2024 method` (line ~227)
3. `resolveDID > returns the document from a custom resolver when one is provided` (line ~234)
4. `resolveDID > returns INVALID_CONFIG for a non-stellar DID without a resolver` (line ~265)
5. `verifyDIDOwnership > returns verified=true for a valid proof structure with a key in the document` (line ~328)
6. `verifyDIDOwnership > returns an error when proof.signature is an empty string` (line ~350)

**Root cause:** The `resolveDID()` function in `src/integration/didSupport.ts` (lines 143-174) appears to return `undefined` or missing data on self-resolution.
- The self-resolution logic (line 170) uses a local storage map (`links.get(did)`) but the map may not be populated, or the fallback to `documentFor()` is not being called properly.
- The `verifyDIDOwnership()` function error messages don't match expectations (line 286: "Proof must include a signature" vs test expects "missing a signature")

**Files to change:**
- `src/integration/didSupport.ts` (lines 143-174 for resolveDID, lines 286-290 for verifyDIDOwnership)

**What to fix:**
- Ensure `resolveDID()` properly generates and returns a document for stellar DIDs when no resolver is provided
- Fix error message in `verifyDIDOwnership()` to match test expectations: "missing a signature" instead of current message

---

### Group 3: Federation Resolver Failures (2 tests in `src/network/federationResolver.test.ts`)

**Failing tests:**
1. `FederationResolver > should enforce max cache size` (line ~expected to pass, but expects 2, getting 5)
2. `verifyIdentity > should return verification result` (line ~expected "ok", getting "error")

**Root cause:** The `FederationResolver` class in `src/network/federationResolver.ts` has cache management issues:
- Test expects max cache size enforcement but the cache is not being cleaned up properly
- The `verifyIdentity()` method returns an error instead of `ok` result

**Files to change:**
- `src/network/federationResolver.ts` (cache enforcement logic around line 254, verifyIdentity method around line 274-306)

**What to fix:**
- Implement proper cache eviction when `maxCacheSize` is exceeded
- Fix `verifyIdentity()` to return `{ verified: false }` instead of error when verification fails

---

### Group 4: Lazy Module Re-export Failure (1 test in `src/lazy/lazy.test.ts`)

**Failing test:**
- `named loaders (pre-#682 API) > are re-exported from the root entry point` (line ~121)

**Root cause:** The test reads `src/index.ts` and checks for the presence of lazy module loader functions (`loadSoroban`, `loadModule`, `preloadModules`, `isModuleLoaded`, `getLoadedModules`, `LAZY_MODULES`, `loadGovernance`) in the exports block, but not all of them are present.

**Files to change:**
- `src/index.ts` (update exports from "./lazy")

**What to fix:**
- Add missing exports: `loadModule`, `preloadModules`, `isModuleLoaded`, `getLoadedModules`, `LAZY_MODULES` (and possibly `loadGovernance`) to the export block in `src/index.ts`

---

## Implementation Order

### Step 1: Fix wallet discovery (Group 1)
**Reason:** Foundation for user-facing feature; should be fixed first as other components may depend on reliable wallet discovery.

Files: `src/wallet/discovery.ts`
- Ensure federation is tried first
- When both federation and stellar.toml fail, return `WALLET_NOT_FOUND` error with proper error code

### Step 2: Fix DID support (Group 2)
**Reason:** Independent from wallet discovery; should be fixed second.

Files: `src/integration/didSupport.ts`
- Fix `resolveDID()` self-resolution to properly return document
- Fix error messages in `verifyDIDOwnership()` to match test expectations

### Step 3: Fix federation resolver cache (Group 3)
**Reason:** May be used by other modules; should be fixed before lazy loading.

Files: `src/network/federationResolver.ts`
- Implement cache size enforcement
- Fix `verifyIdentity()` return type

### Step 4: Fix lazy module exports (Group 4)
**Reason:** Last because it's a documentation/API issue that doesn't affect runtime functionality of the other modules.

Files: `src/index.ts`
- Add missing lazy module exports

---

## Verification Strategy

1. Run individual test files after each fix:
   - `npm run test src/tests/wallet.test.ts`
   - `npm run test src/tests/didSupport.test.ts`
   - `npm run test src/network/federationResolver.test.ts`
   - `npm run test src/lazy/lazy.test.ts`

2. Run full test suite:
   - `npm run test`

3. Verify no regressions:
   - Check that all 3,217 previously passing tests still pass
   - Verify the 13 failures are reduced to 0

---

## Risk Assessment

- **Low risk**: Fixes are localized to specific functions
- **Medium risk**: Wallet discovery changes could affect user workflows if error handling is not correct
- **Mitigation**: All changes will be tested against the full test suite before completion
