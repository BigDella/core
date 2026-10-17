/**
 * contractEventStream.test.ts — Integration tests for real-time event streaming.
 *
 * Tests end-to-end streaming behaviour: sequential polls, reconnection/backoff,
 * exponential delay growth, and cancellation during backoff.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamContractEventsRealTime } from "../../soroban/streamContractEventsRealTime";
import {
  createMockContractEventGenerator,
  createMockEventStream,
} from "../../testing/mockEventStream";
import type { ContractEvent } from "../../soroban/subscribeContractEvents";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeResponse(events: ContractEvent[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { records: events } }),
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Integration: contractEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("end-to-end: delivers events from two sequential polls", async () => {
    const gen = createMockContractEventGenerator({ contractId: "CINT" });
    const batch1 = gen.batch(2);
    const batch2 = gen.batch(2);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(batch1))
      .mockResolvedValue(makeResponse(batch2));

    const received: ContractEvent[][] = [];
    const onEvent = (evts: ContractEvent[]) => received.push(evts);

    const sub = streamContractEventsRealTime("CINT", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: fetchMock,
      onEvent,
    });

    // First poll
    await vi.advanceTimersByTimeAsync(1600);
    // Second poll
    await vi.advanceTimersByTimeAsync(1600);

    sub.stop();

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[0]).toHaveLength(2);
    expect(received[1]).toHaveLength(2);
  });

  it("reconnection: onError and onReconnect called, events eventually delivered", async () => {
    const gen = createMockContractEventGenerator({ contractId: "CRECONN" });
    const successEvents = gen.batch(1);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new Error("Connection refused"));
      }
      return Promise.resolve(makeResponse(successEvents));
    });

    const onError = vi.fn();
    const onReconnect = vi.fn();
    const onEvent = vi.fn();

    const sub = streamContractEventsRealTime("CRECONN", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: fetchMock,
      onEvent,
      onError,
      onReconnect,
    });

    // Advance through failures: 1500ms, 3000ms, 6000ms, 12000ms (success)
    await vi.advanceTimersByTimeAsync(1600);   // fail 1
    await vi.advanceTimersByTimeAsync(3100);   // fail 2
    await vi.advanceTimersByTimeAsync(6100);   // fail 3
    await vi.advanceTimersByTimeAsync(12100);  // success

    sub.stop();

    expect(onError).toHaveBeenCalledTimes(3);
    // onReconnect fires on attempt > 0, so from the second failure onward
    expect(onReconnect.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onEvent).toHaveBeenCalled();
  });

  it("backoff delays grow exponentially", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fail"));
    const onEvent = vi.fn();
    const capturedDelays: number[] = [];

    const origSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (typeof delay === "number" && delay >= 1000) {
          capturedDelays.push(delay);
        }
        return origSetTimeout(fn as any, delay, ...args);
      });

    const sub = streamContractEventsRealTime("CEXP", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: fetchMock,
      onEvent,
    });

    // Advance: first poll at 1500ms fails → schedules 3000ms
    await vi.advanceTimersByTimeAsync(1600);
    // Second poll fires at 3000ms → schedules 6000ms
    await vi.advanceTimersByTimeAsync(3100);
    // Third poll fires at 6000ms → schedules 12000ms
    await vi.advanceTimersByTimeAsync(6100);

    sub.stop();
    setTimeoutSpy.mockRestore();

    // capturedDelays: [1500, 3000, 6000, ...]
    const relevant = capturedDelays.filter((d) => d >= 1500);
    expect(relevant[0]).toBe(1500);
    expect(relevant[1]).toBe(3000);
    expect(relevant[2]).toBe(6000);
  });

  it("cancellation: stop() during backoff prevents retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fail"));
    const onEvent = vi.fn();

    const sub = streamContractEventsRealTime("CCANCEL", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: fetchMock,
      onEvent,
    });

    // First poll fires and fails
    await vi.advanceTimersByTimeAsync(1600);

    const callsAfterFirst = fetchMock.mock.calls.length;

    // Stop during the backoff window (before 3000ms retry fires)
    sub.stop();

    // Advance well past the backoff period
    await vi.advanceTimersByTimeAsync(10_000);

    // Fetch should not have been called again after stop()
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("Integration: createMockEventStream helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers all events in a single poll with no duplicates", async () => {
    const gen = createMockContractEventGenerator({ contractId: "CSTREAM" });
    const events = gen.batch(10);
    const mockFetch = createMockEventStream(events);

    const received: ContractEvent[] = [];
    const sub = streamContractEventsRealTime("CSTREAM", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: mockFetch,
      onEvent: (evts) => received.push(...evts),
    });

    await vi.advanceTimersByTimeAsync(1600);

    sub.stop();

    const uniqueIds = new Set(received.map((e) => e.id));
    expect(uniqueIds.size).toBe(received.length);
    expect(received.length).toBe(10);
  });

  it("simulates network disconnection and recovery", async () => {
    const gen = createMockContractEventGenerator({ contractId: "CDISCONN" });
    const events = gen.batch(3);
    // Disconnect after 1st call, recover after 2 failures (default reconnectDelay)
    const mockFetch = createMockEventStream(events, {
      disconnectAfter: 1,
      reconnectDelay: 2,
    });

    const onError = vi.fn();
    const onEvent = vi.fn();

    const sub = streamContractEventsRealTime("CDISCONN", undefined, {
      horizonUrl: "https://horizon.example.com",
      intervalMs: 1500,
      fetch: mockFetch,
      onEvent,
      onError,
    });

    // First poll succeeds (call 1)
    await vi.advanceTimersByTimeAsync(1600);
    // Second poll fails (call 2 > disconnectAfter=1, failCount < 2)
    await vi.advanceTimersByTimeAsync(1600);
    // Third poll fails (call 3, failCount < 2)
    await vi.advanceTimersByTimeAsync(3100);
    // Fourth poll recovers (failCount >= 2 resets)
    await vi.advanceTimersByTimeAsync(6100);

    sub.stop();

    expect(onError).toHaveBeenCalled();
    // Events should have been delivered on the first poll and recovery poll
    expect(onEvent).toHaveBeenCalled();
  });
});
