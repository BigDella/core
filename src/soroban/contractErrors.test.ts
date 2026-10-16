import { describe, it, expect } from "vitest";
import {
  decodeContractError,
  DEFAULT_CONTRACT_ERROR_MAP,
  FACTORY_CONTRACT_ERRORS,
  ROUTER_CONTRACT_ERRORS,
  FACTORY_ERROR_CODES,
  ROUTER_ERROR_CODES,
} from "./contractErrors";

describe("contractErrors", () => {
  describe("DEFAULT_CONTRACT_ERROR_MAP namespace collision fix", () => {
    // Factory numeric codes with namespace prefix
    it("resolves FACTORY_1 to PAIR_ALREADY_EXISTS", () => {
      const result = decodeContractError(
        "FACTORY_1",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.code).toBe("FACTORY_1");
    });

    it("resolves FACTORY_2 to INVALID_FIRST_TOKEN", () => {
      const result = decodeContractError(
        "FACTORY_2",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("not a valid token");
      expect(result.code).toBe("FACTORY_2");
    });

    it("resolves FACTORY_3 to INVALID_SECOND_TOKEN", () => {
      const result = decodeContractError(
        "FACTORY_3",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("not a valid token");
      expect(result.code).toBe("FACTORY_3");
    });

    it("resolves FACTORY_4 to IDENTICAL_TOKENS", () => {
      const result = decodeContractError(
        "FACTORY_4",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("identical");
      expect(result.code).toBe("FACTORY_4");
    });

    it("resolves FACTORY_5 to UNAUTHORIZED", () => {
      const result = decodeContractError(
        "FACTORY_5",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("not authorized");
      expect(result.code).toBe("FACTORY_5");
    });

    // Router numeric codes with namespace prefix
    it("resolves ROUTER_1 to ROUTER_INVALID_PATH", () => {
      const result = decodeContractError(
        "ROUTER_1",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("swap path");
      expect(result.code).toBe("ROUTER_1");
    });

    it("resolves ROUTER_2 to ROUTER_INSUFFICIENT_LIQUIDITY", () => {
      const result = decodeContractError(
        "ROUTER_2",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("Insufficient liquidity");
      expect(result.code).toBe("ROUTER_2");
    });

    it("resolves ROUTER_3 to ROUTER_SLIPPAGE_EXCEEDED", () => {
      const result = decodeContractError(
        "ROUTER_3",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("slippage");
      expect(result.code).toBe("ROUTER_3");
    });

    it("resolves ROUTER_4 to EXPIRED_DEADLINE", () => {
      const result = decodeContractError(
        "ROUTER_4",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("deadline");
      expect(result.code).toBe("ROUTER_4");
    });

    it("resolves ROUTER_5 to EXCESSIVE_INPUT_AMOUNT", () => {
      const result = decodeContractError(
        "ROUTER_5",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("input amount");
      expect(result.code).toBe("ROUTER_5");
    });

    // Symbolic names resolve from both maps
    it("resolves PAIR_ALREADY_EXISTS symbolic name", () => {
      const result = decodeContractError(
        "PAIR_ALREADY_EXISTS",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.code).toBe("PAIR_ALREADY_EXISTS");
    });

    it("resolves ROUTER_SLIPPAGE_EXCEEDED symbolic name", () => {
      const result = decodeContractError(
        "ROUTER_SLIPPAGE_EXCEEDED",
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("slippage");
      expect(result.code).toBe("ROUTER_SLIPPAGE_EXCEEDED");
    });
  });

  describe("contract-specific maps use namespaced numeric codes", () => {
    it("resolves FACTORY_1 to PAIR_ALREADY_EXISTS in FACTORY_CONTRACT_ERRORS", () => {
      const result = decodeContractError("FACTORY_1", FACTORY_CONTRACT_ERRORS);
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.code).toBe("FACTORY_1");
    });

    it("resolves FACTORY_5 to UNAUTHORIZED in FACTORY_CONTRACT_ERRORS", () => {
      const result = decodeContractError("FACTORY_5", FACTORY_CONTRACT_ERRORS);
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("not authorized");
      expect(result.code).toBe("FACTORY_5");
    });

    it("resolves ROUTER_1 to ROUTER_INVALID_PATH in ROUTER_CONTRACT_ERRORS", () => {
      const result = decodeContractError("ROUTER_1", ROUTER_CONTRACT_ERRORS);
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("swap path");
      expect(result.code).toBe("ROUTER_1");
    });

    it("resolves ROUTER_8 to MINIMUM_LIQUIDITY in ROUTER_CONTRACT_ERRORS", () => {
      const result = decodeContractError("ROUTER_8", ROUTER_CONTRACT_ERRORS);
      expect(result.decoded).toBe(true);
      expect(result.message).toContain("minimum liquidity");
      expect(result.code).toBe("ROUTER_8");
    });
  });

  describe("all factory and router codes are mapped", () => {
    it("all FACTORY_ERROR_CODES have entries in FACTORY_CONTRACT_ERRORS", () => {
      for (const [name, code] of Object.entries(FACTORY_ERROR_CODES)) {
        expect(FACTORY_CONTRACT_ERRORS[name]).toBeDefined(
          `Missing entry for ${name}`,
        );
        expect(FACTORY_CONTRACT_ERRORS[`FACTORY_${code}`]).toBeDefined(
          `Missing namespaced numeric entry for ${name} (code FACTORY_${code})`,
        );
      }
    });

    it("all ROUTER_ERROR_CODES have entries in ROUTER_CONTRACT_ERRORS", () => {
      for (const [name, code] of Object.entries(ROUTER_ERROR_CODES)) {
        expect(ROUTER_CONTRACT_ERRORS[name]).toBeDefined(
          `Missing entry for ${name}`,
        );
        expect(ROUTER_CONTRACT_ERRORS[`ROUTER_${code}`]).toBeDefined(
          `Missing namespaced numeric entry for ${name} (code ROUTER_${code})`,
        );
      }
    });
  });
});
