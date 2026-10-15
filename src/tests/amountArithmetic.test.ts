import { describe, it, expect } from "vitest";
import {
  xlmToStroops,
  stroopsToXlm,
  addAmounts,
  subtractAmounts,
  multiplyAmount,
  divideAmount,
  STROOPS_PER_XLM_NUMBER,
} from "../shared/amounts";

describe("Amount Arithmetic", () => {
  describe("xlmToStroops()", () => {
    it("converts 1 XLM to 10_000_000 stroops", () => {
      expect(xlmToStroops(1)).toBe(10_000_000n);
    });

    it("converts 0.1 XLM to 1_000_000 stroops", () => {
      expect(xlmToStroops(0.1)).toBe(1_000_000n);
    });

    it("converts 0.0000001 XLM to 1 stroop", () => {
      // Using string to avoid floating point precision issues
      expect(xlmToStroops("0.0000001")).toBe(1n);
    });

    it("handles zero", () => {
      expect(xlmToStroops(0)).toBe(0n);
    });

    it("handles string input", () => {
      expect(xlmToStroops("50")).toBe(500_000_000n);
    });

    it("handles negative amounts", () => {
      expect(xlmToStroops(-1)).toBe(-10_000_000n);
    });

    it("handles leading/trailing whitespace in strings", () => {
      expect(xlmToStroops("  1.5  ")).toBe(15_000_000n);
    });

    it("throws on invalid amount format", () => {
      expect(() => xlmToStroops("abc")).toThrow();
      expect(() => xlmToStroops("1.2.3")).toThrow();
    });

    it("throws on non-finite numbers", () => {
      expect(() => xlmToStroops(Infinity)).toThrow();
      expect(() => xlmToStroops(NaN)).toThrow();
    });

    it("throws when more than 7 decimal places", () => {
      expect(() => xlmToStroops("1.12345678")).toThrow(/decimal places/);
    });
  });

  describe("stroopsToXlm()", () => {
    it("converts 10_000_000 stroops to 1 XLM", () => {
      expect(stroopsToXlm(10_000_000n)).toBe("1");
    });

    it("converts 1_000_000 stroops to 0.1 XLM", () => {
      expect(stroopsToXlm(1_000_000n)).toBe("0.1");
    });

    it("converts 1 stroop to 0.0000001 XLM", () => {
      expect(stroopsToXlm(1n)).toBe("0.0000001");
    });

    it("removes trailing zeros", () => {
      expect(stroopsToXlm(10_000_000n)).toBe("1");
      expect(stroopsToXlm(15_000_000n)).toBe("1.5");
    });

    it("handles zero", () => {
      expect(stroopsToXlm(0n)).toBe("0");
    });

    it("handles negative amounts", () => {
      expect(stroopsToXlm(-10_000_000n)).toBe("-1");
    });

    it("accepts string or number input", () => {
      expect(stroopsToXlm("10000000")).toBe("1");
      expect(stroopsToXlm(10_000_000)).toBe("1");
    });
  });

  describe("addAmounts()", () => {
    it("adds two amounts", () => {
      expect(addAmounts("1", "2")).toBe("3");
    });

    it("adds decimal amounts", () => {
      expect(addAmounts("1.5", "2.3")).toBe("3.8");
    });

    it("handles negative amounts", () => {
      expect(addAmounts("-1", "2")).toBe("1");
      expect(addAmounts("-2", "-3")).toBe("-5");
    });

    it("returns result with appropriate precision", () => {
      const result = addAmounts("0.0000001", "0.0000001");
      expect(result).toBe("0.0000002");
    });
  });

  describe("subtractAmounts()", () => {
    it("subtracts two amounts", () => {
      expect(subtractAmounts("5", "3")).toBe("2");
    });

    it("subtracts decimal amounts", () => {
      expect(subtractAmounts("3.5", "1.2")).toBe("2.3");
    });

    it("handles negative results", () => {
      expect(subtractAmounts("1", "3")).toBe("-2");
    });

    it("handles negative amounts", () => {
      expect(subtractAmounts("-1", "2")).toBe("-3");
      expect(subtractAmounts("1", "-2")).toBe("3");
    });
  });

  describe("multiplyAmount()", () => {
    it("multiplies two amounts", () => {
      expect(multiplyAmount("2", "3")).toBe("6");
    });

    it("multiplies decimal amounts", () => {
      expect(multiplyAmount("1.5", "2")).toBe("3");
    });

    it("handles fractional multipliers", () => {
      expect(multiplyAmount("10", "0.5")).toBe("5");
    });

    it("handles negative amounts", () => {
      expect(multiplyAmount("-2", "3")).toBe("-6");
      expect(multiplyAmount("2", "-3")).toBe("-6");
      expect(multiplyAmount("-2", "-3")).toBe("6");
    });

    it("handles zero", () => {
      expect(multiplyAmount("0", "5")).toBe("0");
      expect(multiplyAmount("5", "0")).toBe("0");
    });
  });

  describe("divideAmount()", () => {
    it("divides two amounts", () => {
      expect(divideAmount("6", "2")).toBe("3");
    });

    it("divides decimal amounts", () => {
      expect(divideAmount("3", "2")).toBe("1.5");
    });

    it("uses half-up rounding at stroop boundary", () => {
      expect(divideAmount("1", "3")).toBe("0.3333333");
    });

    it("handles negative amounts", () => {
      expect(divideAmount("-6", "2")).toBe("-3");
      expect(divideAmount("6", "-2")).toBe("-3");
      expect(divideAmount("-6", "-2")).toBe("3");
    });

    it("handles zero dividend", () => {
      expect(divideAmount("0", "5")).toBe("0");
    });

    it("throws on zero divisor", () => {
      expect(() => divideAmount("5", "0")).toThrow(/divide.*zero/);
    });

    it("handles very small divisor (high precision)", () => {
      const result = divideAmount("1", "0.0000001");
      expect(result).toBe("10000000");
    });
  });

  describe("STROOPS_PER_XLM_NUMBER constant", () => {
    it("equals 10_000_000", () => {
      expect(STROOPS_PER_XLM_NUMBER).toBe(10_000_000);
    });
  });

  describe("Roundtrip conversions", () => {
    it("xlmToStroops -> stroopsToXlm returns original value", () => {
      const original = "123.456789";
      const stroops = xlmToStroops(original);
      const back = stroopsToXlm(stroops);
      expect(back).toBe("123.456789");
    });

    it("handles edge case values", () => {
      const testValues = ["0", "1", "0.1", "0.0000001", "1000000"];
      for (const value of testValues) {
        const stroops = xlmToStroops(value);
        const back = stroopsToXlm(stroops);
        expect(back).toBe(value);
      }
    });
  });
});
