/**
 * mockEventStream — deterministic contract event test helpers.
 *
 * Pure utility module — no vitest imports.
 * Designed for use in test files alongside vi.fn() fetch stubs.
 */

import type { ContractEvent } from "../soroban/subscribeContractEvents";

// ─── Option interfaces ────────────────────────────────────────────────────────

export interface MockContractEventGeneratorOptions {
  /** Starting counter value (default: 1). Subsequent events increment from here. */
  seed?: number;
  /** Contract ID to stamp on every event (default: 'CMOCK'). */
  contractId?: string;
  /** Pool of event type names; events cycle through them (default: ['transfer', 'mint', 'burn']). */
  eventTypes?: string[];
  /** Pool of topic strings; events cycle through them (default: ['topic-a', 'topic-b', 'topic-c']). */
  topicPool?: string[];
}

export interface MockEventStreamOptions {
  /**
   * After this many fetch calls, the mock will start throwing network errors.
   * Once the failure window passes, it resets and returns events again.
   */
  disconnectAfter?: number;
  /**
   * Number of consecutive failures to simulate before recovery (default: 2).
   */
  reconnectDelay?: number;
}

// ─── Generator ───────────────────────────────────────────────────────────────

/**
 * Create a deterministic ContractEvent generator.
 *
 * @example
 * const gen = createMockContractEventGenerator({ contractId: 'CTEST' });
 * const event = gen.next();   // single event
 * const batch = gen.batch(5); // array of 5 events
 */
export function createMockContractEventGenerator(
  options?: MockContractEventGeneratorOptions,
): { next(): ContractEvent; batch(n: number): ContractEvent[] } {
  const contractId = options?.contractId ?? "CMOCK";
  const eventTypes = options?.eventTypes ?? ["transfer", "mint", "burn"];
  const topicPool = options?.topicPool ?? ["topic-a", "topic-b", "topic-c"];

  let counter = options?.seed ?? 1;

  function next(): ContractEvent {
    const current = counter++;
    return {
      id: `event-${current}`,
      contractId,
      name: eventTypes[current % eventTypes.length] ?? "transfer",
      topics: [topicPool[current % topicPool.length] ?? "topic-a"],
      value: { amount: current },
      ledger: current,
    };
  }

  function batch(n: number): ContractEvent[] {
    const events: ContractEvent[] = [];
    for (let i = 0; i < n; i++) {
      events.push(next());
    }
    return events;
  }

  return { next, batch };
}

// ─── Stream mock ─────────────────────────────────────────────────────────────

/**
 * Create a mock `fetch` function that returns the provided events.
 *
 * Optionally simulates network disconnections after a given number of calls.
 *
 * @example
 * const gen = createMockContractEventGenerator();
 * const mockFetch = createMockEventStream(gen.batch(10), { disconnectAfter: 2 });
 *
 * streamContractEventsRealTime('CTEST', undefined, {
 *   horizonUrl: 'https://horizon.example.com',
 *   fetch: mockFetch,
 *   onEvent: console.log,
 * });
 */
export function createMockEventStream(
  events: ContractEvent[],
  options?: MockEventStreamOptions,
): (url: string) => Promise<Response> {
  let fetchCount = 0;
  let failCount = 0;
  const maxFails = options?.reconnectDelay ?? 2;

  return (_url: string): Promise<Response> => {
    fetchCount++;

    if (
      options?.disconnectAfter !== undefined &&
      fetchCount > options.disconnectAfter &&
      failCount < maxFails
    ) {
      failCount++;
      return Promise.reject(new Error("Network disconnected"));
    }

    // Recovery: reset fail counter once the window is exhausted
    if (failCount >= maxFails) {
      failCount = 0;
    }

    const response = {
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => ({ _embedded: { records: events } }),
    } as unknown as Response;

    return Promise.resolve(response);
  };
}
