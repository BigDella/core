import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, Networks, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";

import { checkNetworkHealth } from "../network";
import { analyzeContractStorage } from "../soroban/storageAnalysis";
import {
  createSigningRequest,
  addSignature,
  isComplete,
  getSigningStatus,
  serializeSigningRequest,
  deserializeSigningRequest,
} from "../transaction/signingCoordinator";

const TESTNET_XDR =
  "AAAAAgAAAAArg6xVmhrfK8Kf1L0wCEKReWNmDUacUNz/RAwldACowwAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAABqO6RQAAAAAAAAAAEAAAAAAAAACQAAAAAAAAABdACowwAAAEBh9aFJaCgi8jCtB4tqReRPYyywWPIWl6v1+92iXCdqsKGvoxRafpQiAIdvHr6+Jw2Ybd4Vs89XDO0nDVtwip4K";

const TEST_XDR_HASH = TransactionBuilder.fromXDR(TESTNET_XDR, Networks.TESTNET)
  .hash()
  .toString("hex");

// Mutable holder so the mocked Horizon server can return the real transaction
// hash without referencing module-scope constants from the hoisted factory.
const replayState = vi.hoisted(() => ({ hash: "" }));

// Mock only the Horizon server construction so a submission can be simulated
// without touching the network. Every other serverFactory export is preserved.
vi.mock("../shared/serverFactory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/serverFactory")>();
  return {
    ...actual,
    createHorizonServer: vi.fn(() => ({
      submitTransaction: vi.fn().mockImplementation(async () => ({
        hash: replayState.hash,
        ledger: 1,
        envelope_xdr: "",
        result_xdr: "",
      })),
    })),
  };
});

import {
  submitTransaction,
  clearReplayProtection,
  getReplayProtectionStats,
} from "../transaction/submitTransaction";

// ─── #732 ─────────────────────────────────────────────────────────────────────

describe("#732 checkNetworkHealth probes the Soroban RPC health endpoint", () => {
  it("sends a JSON-RPC getHealth POST to the RPC URL and keeps Horizon as a GET", async () => {
    const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: init as Record<string, unknown> });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const result = await checkNetworkHealth("https://horizon.test/", "https://rpc.test", {
      fetchFn,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.rpc.reachable).toBe(true);
    expect(result.data.horizon.reachable).toBe(true);
    expect(result.data.status).toBe("healthy");

    const rpcCall = calls.find((call) => call.url.startsWith("https://rpc.test"));
    expect(rpcCall?.init?.method).toBe("POST");
    expect(JSON.parse(String(rpcCall?.init?.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "getHealth",
      params: [],
    });

    const horizonCall = calls.find((call) => call.url.includes("horizon.test"));
    expect(horizonCall?.url).toBe("https://horizon.test/ledgers?limit=1");
    expect(horizonCall?.init?.method).toBe("GET");
  });

  it("reports the RPC as unreachable when the health probe returns a non-success status", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      return String(url).includes("horizon")
        ? ({ ok: true, status: 200 } as Response)
        : ({ ok: false, status: 405 } as Response);
    }) as unknown as typeof fetch;

    const result = await checkNetworkHealth("https://horizon.test", "https://rpc.test", {
      fetchFn,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.horizon.reachable).toBe(true);
    expect(result.data.rpc.reachable).toBe(false);
    expect(result.data.status).toBe("degraded");
  });
});

// ─── #736 ─────────────────────────────────────────────────────────────────────

describe("#736 analyzeContractStorage sizes ScVal values via XDR", () => {
  it("returns the XDR byte length for a real ScVal value", () => {
    const value = nativeToScVal("hello world");
    const result = analyzeContractStorage([{ key: "greeting", value }]);

    expect(result.entries[0].sizeBytes).toBe(value.toXDR().length);
    expect(result.entries[0].sizeBytes).toBeGreaterThan(2);
  });

  it("returns the XDR byte length for a mock (duck-typed) ScVal", () => {
    const mockScVal = {
      switch: () => 0,
      toXDR: () => Buffer.from([1, 2, 3, 4, 5]),
    };
    const result = analyzeContractStorage([{ key: "mock", value: mockScVal }]);

    expect(result.entries[0].sizeBytes).toBe(5);
  });

  it("groups repeated ScVal values under a deterministic, non-empty fingerprint", () => {
    const a = nativeToScVal(42, { type: "u32" });
    const b = nativeToScVal(42, { type: "u32" });
    const result = analyzeContractStorage([
      { key: "a", value: a },
      { key: "b", value: b },
      { key: "c", value: b },
    ]);

    expect(result.repeatedValueGroups).toHaveLength(1);
    expect(result.repeatedValueGroups[0].count).toBe(3);
    expect(result.repeatedValueGroups[0].fingerprint).not.toBe("{}");
    expect(result.repeatedValueGroups[0].fingerprint.length).toBeGreaterThan(2);
  });

  it("still falls back to JSON encoding for plain objects", () => {
    const result = analyzeContractStorage([{ key: "plain", value: { a: 1 } }]);
    expect(result.entries[0].sizeBytes).toBe(new TextEncoder().encode('{"a":1}').byteLength);
  });
});

// ─── #737 ─────────────────────────────────────────────────────────────────────

describe("#737 clearReplayProtection resets the replay-protection registry", () => {
  afterEach(() => clearReplayProtection());

  it("registers successful submissions and clears them on demand", async () => {
    clearReplayProtection();
    expect(getReplayProtectionStats().trackedHashes).toBe(0);

    replayState.hash = TEST_XDR_HASH;

    const first = await submitTransaction(
      "https://horizon-testnet.stellar.org",
      Networks.TESTNET,
      TESTNET_XDR,
    );
    expect(first.status).toBe("ok");
    expect(getReplayProtectionStats().trackedHashes).toBe(1);

    const duplicate = await submitTransaction(
      "https://horizon-testnet.stellar.org",
      Networks.TESTNET,
      TESTNET_XDR,
    );
    expect(duplicate.status).toBe("error");
    if (duplicate.status === "error") {
      expect(duplicate.error.message).toMatch(/Replay protection/i);
    }

    clearReplayProtection();
    expect(getReplayProtectionStats().trackedHashes).toBe(0);
  });
});

// ─── #729 ─────────────────────────────────────────────────────────────────────

describe("#729 signing requests survive JSON serialization", () => {
  const signer = Keypair.random().publicKey();

  function buildRequest() {
    const created = createSigningRequest("test-xdr", [signer]);
    if (created.status !== "ok") throw new Error("expected ok");
    const added = addSignature(created.data, "signature-hex", signer);
    if (added.status !== "ok") throw new Error("expected ok");
    return created.data;
  }

  it("preserves collected signatures through JSON.stringify / JSON.parse", () => {
    const request = buildRequest();

    const json = JSON.stringify(request);
    expect(json).toContain("signature-hex");

    const revived = JSON.parse(json);
    const status = getSigningStatus(revived);
    expect(status.status).toBe("ok");
    if (status.status !== "ok") return;
    expect(status.data.signed).toEqual([signer]);
    expect(status.data.complete).toBe(true);

    const complete = isComplete(revived);
    expect(complete.status === "ok" && complete.data).toBe(true);
  });

  it("round-trips through serializeSigningRequest / deserializeSigningRequest", () => {
    const request = buildRequest();
    const parsed = deserializeSigningRequest(serializeSigningRequest(request));

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.data.collectedSignatures).toEqual({ [signer]: "signature-hex" });
    expect(parsed.data.threshold).toBe(request.threshold);
  });

  it("rejects invalid serialized input", () => {
    expect(deserializeSigningRequest("not-json").status).toBe("error");
    expect(deserializeSigningRequest('{"xdr":123}').status).toBe("error");
  });
});
