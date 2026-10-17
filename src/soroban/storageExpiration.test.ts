/**
 * Tests for calculateStorageRent and renewContractStorage (issue #723).
 *
 * Both functions previously returned hardcoded mock data. These tests
 * assert that real RPC methods are called and that returned data reflects
 * the stubbed responses rather than constants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import type {
  StorageRentResult,
  RenewContractStorageResult,
} from "./types";

// ─── Hoisted mock factories ───────────────────────────────────────────────────

const { mockGetLedgerEntries, mockLoadAccount } = vi.hoisted(() => ({
  mockGetLedgerEntries: vi.fn(),
  mockLoadAccount: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getLedgerEntries: mockGetLedgerEntries,
      })),
    },
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
      })),
    },
  };
});

import {
  calculateStorageRent,
  renewContractStorage,
} from "./storageExpiration";
import type {
  CalculateStorageRentOptions,
  RenewContractStorageOptions,
} from "./storageExpiration";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A valid Soroban contract address (C... strkey)
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const VALID_PUBLIC_KEY = "GCFQYP2MMXX2G2PLAQP5ASKP3WBDX6IDXVBOEQOBE7HC3W3N5YX5IGOB";

const STORAGE_OPTS: CalculateStorageRentOptions = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const RENEW_OPTS: RenewContractStorageOptions = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  publicKey: VALID_PUBLIC_KEY,
};

const LATEST_LEDGER = 50_000;
const LIVE_UNTIL = 51_000;

/**
 * The XDR base64 string that the production code generates for CONTRACT_ID.
 * Pre-computed so the mock entry's key.toXDR("base64") returns the exact same
 * string, ensuring the map lookup in calculateStorageRent succeeds.
 *
 * Generated via:
 *   Address.fromString(CONTRACT_ID) → LedgerKey.contractData(...) → toXDR("base64")
 */
const CONTRACT_KEY_XDR_B64 =
  "AAAABgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAB";

/**
 * Build a getLedgerEntries response whose entry key XDR matches what the
 * production code generates for CONTRACT_ID.
 */
function makeLedgerEntriesResponse(liveUntilLedgerSeq: number) {
  return {
    latestLedger: LATEST_LEDGER,
    entries: [
      {
        liveUntilLedgerSeq,
        key: {
          // The implementation only calls entry.key.toXDR("base64")
          toXDR: (_encoding: string) => CONTRACT_KEY_XDR_B64,
        },
      },
    ],
  };
}

/**
 * Horizon AccountResponse mock with the shape TransactionBuilder expects.
 * TransactionBuilder calls sourceAccount.accountId() (a function), not .id.
 */
function makeMockAccount(sequence: string) {
  return {
    accountId: () => VALID_PUBLIC_KEY,
    sequence,
    sequenceNumber: () => sequence,
    incrementSequenceNumber: vi.fn(),
  };
}

beforeEach(() => {
  mockGetLedgerEntries.mockClear();
  mockLoadAccount.mockClear();
});

// ─── calculateStorageRent ─────────────────────────────────────────────────────

describe("calculateStorageRent", () => {
  it("calls getLedgerEntries and returns real ledger sequence", async () => {
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LIVE_UNTIL),
    );

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);

    expect(result.status).toBe("ok");
    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);

    const data = (result as { status: "ok"; data: StorageRentResult }).data;
    expect(data.ledgerSequence).toBe(LATEST_LEDGER);
  });

  it("populates liveUntilLedgerSeq from the RPC response", async () => {
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LIVE_UNTIL),
    );

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);

    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: StorageRentResult }).data;
    expect(data.entries[0].liveUntilLedgerSeq).toBe(LIVE_UNTIL);
  });

  it("computes remainingLedgers as liveUntilLedgerSeq − latestLedger", async () => {
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LIVE_UNTIL),
    );

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);

    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: StorageRentResult }).data;
    expect(data.entries[0].remainingLedgers).toBe(LIVE_UNTIL - LATEST_LEDGER);
  });

  it("stub is called — guards against the original no-RPC regression", async () => {
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LIVE_UNTIL),
    );

    await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);

    // If this assertion fails, the function returned mock data without calling RPC
    expect(mockGetLedgerEntries).toHaveBeenCalled();
  });

  it("returns error for empty contractIds array", async () => {
    const result = await calculateStorageRent([], STORAGE_OPTS);
    expect(result.status).toBe("error");
    expect(mockGetLedgerEntries).not.toHaveBeenCalled();
  });

  it("returns error when getLedgerEntries rejects", async () => {
    mockGetLedgerEntries.mockRejectedValue(new Error("network error"));

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);
    expect(result.status).toBe("error");
  });

  it("estimatedRenewalCostStroops is 0 for an already-expired entry", async () => {
    // liveUntilLedgerSeq < latestLedger → already expired
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LATEST_LEDGER - 100),
    );

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);
    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: StorageRentResult }).data;
    expect(data.entries[0].estimatedRenewalCostStroops).toBe(0);
  });

  it("estimatedRenewalCostStroops is positive for a live entry", async () => {
    mockGetLedgerEntries.mockResolvedValue(
      makeLedgerEntriesResponse(LIVE_UNTIL),
    );

    const result = await calculateStorageRent([CONTRACT_ID], STORAGE_OPTS);
    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: StorageRentResult }).data;
    expect(data.entries[0].estimatedRenewalCostStroops).toBeGreaterThan(0);
  });
});

// ─── renewContractStorage ─────────────────────────────────────────────────────

describe("renewContractStorage", () => {
  const EXTEND_BY = 50_000;

  beforeEach(() => {
    mockLoadAccount.mockResolvedValue(makeMockAccount("99999999"));
  });

  it("returns a non-empty base64 XDR string", async () => {
    const result = await renewContractStorage(
      CONTRACT_ID,
      EXTEND_BY,
      RENEW_OPTS,
    );

    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: RenewContractStorageResult })
      .data;
    expect(typeof data.operationXdr).toBe("string");
    expect(data.operationXdr.length).toBeGreaterThan(0);
  });

  it("returned XDR decodes without error (not a JSON blob)", async () => {
    const result = await renewContractStorage(
      CONTRACT_ID,
      EXTEND_BY,
      RENEW_OPTS,
    );

    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: RenewContractStorageResult })
      .data;

    // If operationXdr is a base64-encoded JSON string (the old mock behaviour),
    // TransactionBuilder.fromXDR will throw — this assertion guards against that.
    expect(() =>
      TransactionBuilder.fromXDR(
        data.operationXdr,
        "Test SDF Network ; September 2015",
      ),
    ).not.toThrow();
  });

  it("suggestedSequence is not the hardcoded mock value '1'", async () => {
    const result = await renewContractStorage(
      CONTRACT_ID,
      EXTEND_BY,
      RENEW_OPTS,
    );

    expect(result.status).toBe("ok");
    const data = (result as { status: "ok"; data: RenewContractStorageResult })
      .data;
    // The old mock always returned "1"; our real implementation fetches the
    // account and uses the real sequence number.
    expect(data.suggestedSequence).not.toBe("1");
  });

  it("calls Horizon loadAccount to fetch the real sequence", async () => {
    await renewContractStorage(CONTRACT_ID, EXTEND_BY, RENEW_OPTS);
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(mockLoadAccount).toHaveBeenCalledWith(VALID_PUBLIC_KEY);
  });

  it("returns error when loadAccount fails", async () => {
    mockLoadAccount.mockRejectedValueOnce(new Error("account not found"));
    const result = await renewContractStorage(
      CONTRACT_ID,
      EXTEND_BY,
      RENEW_OPTS,
    );
    expect(result.status).toBe("error");
  });
});
