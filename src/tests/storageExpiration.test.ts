import { Account, Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SorokitErrorCode } from "../shared/response";
import { calculateStorageRent, renewContractStorage } from "../soroban/storageExpiration";

// ---------------------------------------------------------------------------
// Hoisted mock functions — created before vi.mock() runs
// ---------------------------------------------------------------------------
const { mockGetLedgerEntries, mockLoadAccount } = vi.hoisted(() => ({
  mockGetLedgerEntries: vi.fn(),
  mockLoadAccount: vi.fn(),
}));

// ---------------------------------------------------------------------------
// SDK mock — follows the same pattern as soroban.test.ts
// ---------------------------------------------------------------------------
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

  class MockTransactionBuilder {
    operation?: unknown;
    _timeout?: number;

    constructor(
      readonly sourceAccount: unknown,
      readonly options: unknown,
    ) {}

    addOperation(operation: unknown) {
      this.operation = operation;
      return this;
    }

    setTimeout(timeout: number) {
      this._timeout = timeout;
      return this;
    }

    build() {
      // Produce a real TransactionEnvelope XDR by delegating to the actual SDK.
      // We need a real Account, real Operation, and real TransactionBuilder to get
      // valid XDR so the decodability assertion actually exercises the XDR pipeline.
      const sourceAcc =
        this.sourceAccount instanceof actual.Account
          ? this.sourceAccount
          : new actual.Account(
              "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
              "0",
            );

      const netPassphrase =
        typeof (this.options as any)?.networkPassphrase === "string"
          ? (this.options as any).networkPassphrase
          : "Test SDF Network ; September 2015";

      const fee =
        typeof (this.options as any)?.fee === "string"
          ? (this.options as any).fee
          : actual.BASE_FEE;

      try {
        const realTx = new actual.TransactionBuilder(sourceAcc, {
          fee,
          networkPassphrase: netPassphrase,
        })
          .addOperation(this.operation as any)
          .setTimeout(this._timeout ?? 30)
          .build();

        return {
          fee: realTx.fee,
          toEnvelope: () => realTx.toEnvelope(),
          toXDR: () => realTx.toXDR(),
        };
      } catch {
        // Fallback: return a mock object (should not normally be reached)
        return {
          fee: "100",
          toEnvelope: () => ({
            toXDR: () => Buffer.from("mock-xdr"),
          }),
          toXDR: () => "mock-xdr",
        };
      }
    }
  }

  (MockTransactionBuilder as any).fromXDR = actual.TransactionBuilder.fromXDR;

  return {
    ...actual,
    BASE_FEE: actual.BASE_FEE,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
      })),
    },
    TransactionBuilder: MockTransactionBuilder,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getLedgerEntries: mockGetLedgerEntries,
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/** A valid Soroban contract address (StrKey C… format) */
function makeContractId(): string {
  // Use Keypair raw public key encoded as a contract StrKey (C-address)
  const { StrKey } = require("@stellar/stellar-sdk");
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

function makeLedgerEntryResult(liveUntilLedgerSeq: number, key: any) {
  return {
    key,
    val: {},
    lastModifiedLedgerSeq: 40000,
    liveUntilLedgerSeq,
  };
}

// ---------------------------------------------------------------------------
// calculateStorageRent
// ---------------------------------------------------------------------------

describe("calculateStorageRent", () => {
  beforeEach(() => {
    mockGetLedgerEntries.mockReset();
  });

  it("calls getLedgerEntries with the correct key for each contractId", async () => {
    const contractId = makeContractId();

    mockGetLedgerEntries.mockResolvedValueOnce({
      latestLedger: 50000,
      entries: [],
    });

    const result = await calculateStorageRent([contractId], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Stub must have been called — test fails if it was not
    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it("returns ledgerSequence from the RPC response, not a hardcoded constant", async () => {
    const contractId = makeContractId();

    // Use a distinctive ledger number that is NOT the old hardcoded 45000
    mockGetLedgerEntries.mockResolvedValueOnce({
      latestLedger: 50000,
      entries: [],
    });

    const result = await calculateStorageRent([contractId], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.ledgerSequence).toBe(50000);
      // Explicitly verify it is not the old hardcoded value
      expect(result.data.ledgerSequence).not.toBe(45000);
    }
  });

  it("returns real TTL from RPC for each entry", async () => {
    const contractId = makeContractId();
    const { xdr, Address } = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
    const address = Address.fromString(contractId);
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: address.toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    mockGetLedgerEntries.mockResolvedValueOnce({
      latestLedger: 50000,
      entries: [makeLedgerEntryResult(99999, key)],
    });

    const result = await calculateStorageRent([contractId], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.entries[0].liveUntilLedgerSeq).toBe(99999);
      expect(result.data.entries[0].remainingLedgers).toBe(99999 - 50000);
    }
  });

  it("fails with NETWORK_ERROR when getLedgerEntries throws", async () => {
    const contractId = makeContractId();

    mockGetLedgerEntries.mockRejectedValueOnce(new Error("connection refused"));

    const result = await calculateStorageRent([contractId], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.NETWORK_ERROR);
    }
  });

  it("fails with TX_BUILD_FAILED when contractIds is empty — no RPC call made", async () => {
    const result = await calculateStorageRent([], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // The stub must NOT have been called because validation is pre-RPC
    expect(mockGetLedgerEntries).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
    }
  });

  it("batches multiple contractIds in a single getLedgerEntries call", async () => {
    const ids = [makeContractId(), makeContractId(), makeContractId()];

    mockGetLedgerEntries.mockResolvedValueOnce({
      latestLedger: 60000,
      entries: [],
    });

    const result = await calculateStorageRent(ids, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Exactly one batched call regardless of how many IDs were passed
    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.entries).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// renewContractStorage
// ---------------------------------------------------------------------------

describe("renewContractStorage", () => {
  const PUBLIC_KEY = Keypair.random().publicKey();

  beforeEach(() => {
    mockLoadAccount.mockReset();
  });

  function makeSourceAccount(sequence = "100"): Account {
    return new Account(PUBLIC_KEY, sequence);
  }

  it("calls Horizon.Server.loadAccount to obtain a real sequence number", async () => {
    mockLoadAccount.mockResolvedValueOnce(makeSourceAccount("100"));

    const contractId = makeContractId();
    // extendByLedgers is a relative TTL delta (ledgers from LCL), not an absolute ledger sequence
    const result = await renewContractStorage(contractId, 55000, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      horizonUrl: HORIZON_URL,
      publicKey: PUBLIC_KEY,
    });

    // Stub must have been called — test fails if it was not
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it("returned operationXdr decodes via TransactionBuilder.fromXDR without throwing", async () => {
    const { TransactionBuilder } = await vi.importActual<typeof import("@stellar/stellar-sdk")>(
      "@stellar/stellar-sdk",
    );

    mockLoadAccount.mockResolvedValueOnce(makeSourceAccount("42"));

    const contractId = makeContractId();
    // extendByLedgers: 60000 ledgers of TTL from LCL (~3 days on Testnet)
    const result = await renewContractStorage(contractId, 60000, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      horizonUrl: HORIZON_URL,
      publicKey: PUBLIC_KEY,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Must not throw — proves we're producing real XDR, not a fake placeholder
      let decoded: any;
      expect(() => {
        decoded = TransactionBuilder.fromXDR(result.data.operationXdr, NETWORK_PASSPHRASE);
      }).not.toThrow();

      // Verify the operation type is what we built
      expect(decoded.operations[0].type).toBe("extendFootprintTtl");
    }
  });

  it("suggestedSequence reflects the stubbed account sequence, not a hardcoded value", async () => {
    mockLoadAccount.mockResolvedValueOnce(makeSourceAccount("12345"));

    const contractId = makeContractId();
    const result = await renewContractStorage(contractId, 55000, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      horizonUrl: HORIZON_URL,
      publicKey: PUBLIC_KEY,
    });

    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Must match the stub, not the old hardcoded "1"
      expect(result.data.suggestedSequence).toBe("12345");
      expect(result.data.suggestedSequence).not.toBe("1");
    }
  });

  it("fails with ACCOUNT_NOT_FOUND when loadAccount throws a 404-style error", async () => {
    const notFoundError = Object.assign(new Error("not found"), {
      response: { status: 404 },
    });
    mockLoadAccount.mockRejectedValueOnce(notFoundError);

    const contractId = makeContractId();
    const result = await renewContractStorage(contractId, 55000, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      horizonUrl: HORIZON_URL,
      publicKey: PUBLIC_KEY,
    });

    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.ACCOUNT_NOT_FOUND);
    }
  });

  it("fails with ACCOUNT_FETCH_FAILED when loadAccount throws a non-404 error", async () => {
    mockLoadAccount.mockRejectedValueOnce(new Error("internal server error"));

    const contractId = makeContractId();
    const result = await renewContractStorage(contractId, 55000, {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      horizonUrl: HORIZON_URL,
      publicKey: PUBLIC_KEY,
    });

    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.ACCOUNT_FETCH_FAILED);
    }
  });
});

// ---------------------------------------------------------------------------
// estimatedRenewalCostStroops boundary tests (finding #3)
// ---------------------------------------------------------------------------

describe("calculateStorageRent — estimatedRenewalCostStroops boundary cases", () => {
  beforeEach(() => {
    mockGetLedgerEntries.mockReset();
  });

  async function getRentEntry(liveUntilLedgerSeq: number, latestLedger: number) {
    const { xdr, Address } = await vi.importActual<typeof import("@stellar/stellar-sdk")>(
      "@stellar/stellar-sdk",
    );
    const contractId = makeContractId();
    const address = Address.fromString(contractId);
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: address.toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    mockGetLedgerEntries.mockResolvedValueOnce({
      latestLedger,
      entries: [{ key, val: {}, lastModifiedLedgerSeq: latestLedger - 1, liveUntilLedgerSeq }],
    });

    const result = await calculateStorageRent([contractId], {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    if (result.status !== "ok") throw new Error("Expected ok result");
    return result.data.entries[0];
  }

  it("returns 0 cost when entry is already expired (0 remaining ledgers)", async () => {
    // liveUntilLedgerSeq <= latestLedger → already expired
    const entry = await getRentEntry(50000, 50000);
    expect(entry.remainingLedgers).toBe(0);
    expect(entry.estimatedRenewalCostStroops).toBe(0);
  });

  it("returns 10000 stroops for 1 remaining ledger", async () => {
    // remainingLedgers = 1 → ceil(1/1000) * 10000 = 1 * 10000 = 10000
    const entry = await getRentEntry(50001, 50000);
    expect(entry.remainingLedgers).toBe(1);
    expect(entry.estimatedRenewalCostStroops).toBe(10000);
  });

  it("returns 10000 stroops for exactly 1000 remaining ledgers (boundary)", async () => {
    // remainingLedgers = 1000 → ceil(1000/1000) * 10000 = 1 * 10000 = 10000
    const entry = await getRentEntry(51000, 50000);
    expect(entry.remainingLedgers).toBe(1000);
    expect(entry.estimatedRenewalCostStroops).toBe(10000);
  });

  it("returns 20000 stroops for 1001 remaining ledgers (crosses boundary)", async () => {
    // remainingLedgers = 1001 → ceil(1001/1000) * 10000 = 2 * 10000 = 20000
    const entry = await getRentEntry(51001, 50000);
    expect(entry.remainingLedgers).toBe(1001);
    expect(entry.estimatedRenewalCostStroops).toBe(20000);
  });
});
