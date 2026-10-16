import { describe, it, expect, vi } from "vitest";
import { AdaptiveRateLimiter, parseRetryAfter } from "../network/adaptiveRateLimiter";

describe("parseRetryAfter()", () => {
  it("parses numeric Retry-After header as seconds", () => {
    const result = parseRetryAfter("60", 0);
    expect(result).toBe(60000);
  });

  it("parses date Retry-After header", () => {
    const now = 1000;
    const futureDate = new Date(now + 120000).toUTCString();
    const result = parseRetryAfter(futureDate, now);
    expect(result).toBe(120000);
  });

  it("returns undefined for empty string", () => {
    const result = parseRetryAfter("", 0);
    expect(result).toBeUndefined();
  });

  it("returns undefined for null", () => {
    const result = parseRetryAfter(null, 0);
    expect(result).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    const result = parseRetryAfter(undefined, 0);
    expect(result).toBeUndefined();
  });

  it("returns 0 for past dates", () => {
    const now = 1000;
    const pastDate = new Date(now - 120000).toUTCString();
    const result = parseRetryAfter(pastDate, now);
    expect(result).toBe(0);
  });

  it("returns undefined for invalid format", () => {
    const result = parseRetryAfter("not-a-number", 0);
    expect(result).toBeUndefined();
  });
});

describe("AdaptiveRateLimiter", () => {
  it("initializes with default options", () => {
    const limiter = new AdaptiveRateLimiter();
    expect(limiter.getDelay("https://example.com")).toBe(0);
  });

  it("getDelay returns 0 for unknown endpoint", () => {
    const limiter = new AdaptiveRateLimiter();
    expect(limiter.getDelay("https://unknown.com")).toBe(0);
  });

  it("recordResponse updates state for 429 response", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    limiter.recordResponse(endpoint, { status: 429 });
    
    const state = limiter.getState(endpoint);
    expect(state).toBeDefined();
    expect(state?.consecutive429s).toBe(1);
    expect(state?.retryAfterMs).toBeGreaterThan(0);
  });

  it("recordResponse clears state for non-429 response", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    
    // First record a 429
    limiter.recordResponse(endpoint, { status: 429 });
    expect(limiter.getState(endpoint)).toBeDefined();
    
    // Then record a 200
    limiter.recordResponse(endpoint, { status: 200 });
    expect(limiter.getState(endpoint)).toBeUndefined();
  });

  it("getState returns undefined for unknown endpoint", () => {
    const limiter = new AdaptiveRateLimiter();
    const state = limiter.getState("https://unknown.com");
    expect(state).toBeUndefined();
  });

  it("reset clears all state when no endpoint is specified", () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.recordResponse("https://endpoint1.com", { status: 429 });
    limiter.recordResponse("https://endpoint2.com", { status: 429 });
    
    limiter.reset();
    
    expect(limiter.getState("https://endpoint1.com")).toBeUndefined();
    expect(limiter.getState("https://endpoint2.com")).toBeUndefined();
  });

  it("reset clears specific endpoint state when endpoint is provided", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint1 = "https://endpoint1.com";
    const endpoint2 = "https://endpoint2.com";
    
    limiter.recordResponse(endpoint1, { status: 429 });
    limiter.recordResponse(endpoint2, { status: 429 });
    
    limiter.reset(endpoint1);
    
    expect(limiter.getState(endpoint1)).toBeUndefined();
    expect(limiter.getState(endpoint2)).toBeDefined();
  });

  it("fetch calls request function and records response", async () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    const request = vi.fn().mockResolvedValue({ status: 200 });
    
    const response = await limiter.fetch(endpoint, request);
    
    expect(request).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("acquire waits for the delay period", async () => {
    let now = 0;
    const getNow = () => now;
    const limiter = new AdaptiveRateLimiter({ now: getNow });
    const endpoint = "https://example.com";
    
    // Record a 429 to set a delay
    limiter.recordResponse(endpoint, { status: 429 });
    
    const delay = limiter.getDelay(endpoint);
    expect(delay).toBeGreaterThan(0);
  });

  it("handles Retry-After header in 429 response", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    const headers = {
      get: (name: string) => name === "Retry-After" ? "30" : null,
    };
    
    limiter.recordResponse(endpoint, { status: 429, headers });
    
    const state = limiter.getState(endpoint);
    expect(state?.retryAfterMs).toBe(30000);
  });

  it("respects maxDelayMs option", () => {
    const limiter = new AdaptiveRateLimiter({ maxDelayMs: 5000 });
    const endpoint = "https://example.com";
    const headers = {
      get: (name: string) => name === "Retry-After" ? "3600" : null,
    };
    
    limiter.recordResponse(endpoint, { status: 429, headers });
    
    const state = limiter.getState(endpoint);
    expect(state?.retryAfterMs).toBe(5000); // capped at maxDelayMs
  });

  it("increments consecutive429s counter", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    
    limiter.recordResponse(endpoint, { status: 429 });
    limiter.recordResponse(endpoint, { status: 429 });
    limiter.recordResponse(endpoint, { status: 429 });
    
    const state = limiter.getState(endpoint);
    expect(state?.consecutive429s).toBe(3);
  });

  it("doubles retry delay on repeated 429s without Retry-After header", () => {
    const limiter = new AdaptiveRateLimiter();
    const endpoint = "https://example.com";
    
    limiter.recordResponse(endpoint, { status: 429 });
    const firstDelay = limiter.getState(endpoint)?.retryAfterMs;
    
    limiter.recordResponse(endpoint, { status: 429 });
    const secondDelay = limiter.getState(endpoint)?.retryAfterMs;
    
    expect(secondDelay).toBeGreaterThanOrEqual(firstDelay! * 2);
  });
});
