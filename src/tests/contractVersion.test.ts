import { describe, expect, it, beforeEach } from "vitest";
import {
  getContractVersionHistory,
  resetContractVersionTracking,
  parseVersionFromMeta,
  recordObservation,
} from "../soroban/contractVersion";

describe("contractVersion - versionHistory capping", () => {
  const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

  beforeEach(() => {
    resetContractVersionTracking(contractId);
  });

  it("recordObservation caps history at MAX_VERSION_HISTORY_ENTRIES (100)", () => {
    for (let i = 0; i < 150; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    const history = getContractVersionHistory(contractId);
    expect(history.length).toBeLessThanOrEqual(100);
    expect(history.length).toBe(100);
  });

  it("drops oldest entries (FIFO) when exceeding cap, not newest", () => {
    for (let i = 0; i < 105; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    const history = getContractVersionHistory(contractId);
    expect(history.length).toBe(100);
    expect(history[0].version).toBe("v5.0.0");
    expect(history[99].version).toBe("v104.0.0");
  });

  it("getContractVersionHistory returns at most capped number of entries", () => {
    for (let i = 0; i < 200; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    const history = getContractVersionHistory(contractId);
    expect(history.length).toBeLessThanOrEqual(100);
  });

  it("resetContractVersionTracking clears history as before", () => {
    for (let i = 0; i < 50; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    expect(getContractVersionHistory(contractId).length).toBe(50);

    resetContractVersionTracking(contractId);

    expect(getContractVersionHistory(contractId).length).toBe(0);
  });

  it("maintains correct chronological order when capping", () => {
    for (let i = 0; i < 150; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    const history = getContractVersionHistory(contractId);

    for (let i = 1; i < history.length; i++) {
      const prevTime = new Date(history[i - 1].observedAt).getTime();
      const currTime = new Date(history[i].observedAt).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  it("records isUpgrade correctly after capping", () => {
    recordObservation(contractId, "v1.0.0");
    let history = getContractVersionHistory(contractId);
    expect(history[0].isUpgrade).toBe(false);

    recordObservation(contractId, "v2.0.0");
    history = getContractVersionHistory(contractId);
    expect(history[1].isUpgrade).toBe(true);

    for (let i = 3; i < 110; i++) {
      recordObservation(contractId, `v${i}.0.0`);
    }

    history = getContractVersionHistory(contractId);
    expect(history.length).toBe(100);
    expect(history[history.length - 1].isUpgrade).toBe(true);
  });

  it("handles rapid successive calls without exceeding cap", () => {
    for (let i = 0; i < 500; i++) {
      recordObservation(contractId, `v${i % 10}.0.0`);
    }

    const history = getContractVersionHistory(contractId);
    expect(history.length).toBeLessThanOrEqual(100);
  });

  it("works independently for multiple contracts", () => {
    const contractId2 = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4";

    for (let i = 0; i < 150; i++) {
      recordObservation(contractId, `v${i}.0.0`);
      recordObservation(contractId2, `u${i}.0.0`);
    }

    const history1 = getContractVersionHistory(contractId);
    const history2 = getContractVersionHistory(contractId2);

    expect(history1.length).toBe(100);
    expect(history2.length).toBe(100);
    expect(history1[0].version).toBe("v50.0.0");
    expect(history2[0].version).toBe("u50.0.0");

    resetContractVersionTracking(contractId2);
    expect(getContractVersionHistory(contractId2).length).toBe(0);
    expect(getContractVersionHistory(contractId).length).toBe(100);
  });
});

describe("contractVersion - parseVersionFromMeta", () => {
  it("returns null for malformed input", () => {
    const result = parseVersionFromMeta(new Uint8Array([0xff, 0xff]));
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = parseVersionFromMeta(new Uint8Array(0));
    expect(result).toBeNull();
  });
});
