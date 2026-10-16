/**
 * EventIndex — an in-memory index for ContractEvent objects.
 *
 * Uses a djb2 hash for O(1) insertion and collision tracking.
 * Supports rich filtering via EventIndexFilter predicates.
 */

import type { ContractEvent } from "./subscribeContractEvents";
import type { EventIndexFilter } from "./types";

/** djb2 hash function — returns a hex string */
function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function hashKey(event: ContractEvent): string {
  return djb2Hash(
    String(event.id ?? "") +
      ":" +
      String(event.contractId ?? "") +
      ":" +
      /* eslint-disable @typescript-eslint/no-explicit-any */
      String((event as any).ledger ?? "") +
      /* eslint-enable @typescript-eslint/no-explicit-any */
      ":" +
      String(event.name ?? ""),
  );
}

function fullKey(event: ContractEvent): string {
  return (
    String(event.id ?? "") +
    "|" +
    String(event.contractId ?? "") +
    "|" +
    /* eslint-disable @typescript-eslint/no-explicit-any */
    String((event as any).ledger ?? "")
    /* eslint-enable @typescript-eslint/no-explicit-any */
  );
}

/**
 * An in-memory index for fast lookup and deduplication of ContractEvent objects.
 *
 * - `add(event)` — insert, tracking hash collisions separately.
 * - `query(filter)` — retrieve events matching an EventIndexFilter.
 * - `deduplicate()` — remove exact duplicates (by fullKey), return count removed.
 * - `size()` — total number of stored events (primary + collisions).
 * - `clear()` — remove all events.
 */
export class EventIndex {
  private readonly primary = new Map<string, ContractEvent>();
  private readonly collisions = new Map<string, ContractEvent[]>();

  /** Insert an event into the index. */
  add(event: ContractEvent): void {
    const h = hashKey(event);

    if (!this.primary.has(h)) {
      this.primary.set(h, event);
      return;
    }

    // Hash is already occupied — check for true equality vs collision
    const existing = this.primary.get(h)!;
    if (fullKey(existing) === fullKey(event)) {
      // Exact duplicate — do not store again
      return;
    }

    // Genuine hash collision — stash in collisions list
    if (!this.collisions.has(h)) {
      this.collisions.set(h, []);
    }
    this.collisions.get(h)!.push(event);
  }

  /** Return all events (primary + collisions) as a flat array. */
  private allEvents(): ContractEvent[] {
    const result: ContractEvent[] = [];
    for (const event of this.primary.values()) {
      result.push(event);
    }
    for (const list of this.collisions.values()) {
      for (const event of list) {
        result.push(event);
      }
    }
    return result;
  }

  /**
   * Query events using an EventIndexFilter.
   *
   * All specified filter fields must match (AND semantics).
   * The `topics` field matches if the event contains any of the provided topics (OR).
   */
  query(filter?: EventIndexFilter): ContractEvent[] {
    let events = this.allEvents();

    if (!filter) return events;

    if (filter.contractId !== undefined) {
      const cid = filter.contractId;
      events = events.filter((e) => String(e.contractId ?? "") === cid);
    }

    if (filter.name !== undefined) {
      const name = filter.name;
      events = events.filter((e) => String(e.name ?? "") === name);
    }

    if (filter.topics !== undefined && filter.topics.length > 0) {
      const filterTopics = filter.topics;
      events = events.filter((e) => {
        const eventTopics = Array.isArray(e.topics) ? e.topics : [];
        return filterTopics.some((ft) => eventTopics.includes(ft));
      });
    }

    if (filter.minLedger !== undefined) {
      const min = filter.minLedger;
      events = events.filter((e) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const ledger = (e as any).ledger;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return typeof ledger === "number" && ledger >= min;
      });
    }

    if (filter.maxLedger !== undefined) {
      const max = filter.maxLedger;
      events = events.filter((e) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const ledger = (e as any).ledger;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return typeof ledger === "number" && ledger <= max;
      });
    }

    if (filter.predicate !== undefined) {
      const predicate = filter.predicate;
      events = events.filter((e) => predicate(e));
    }

    return events;
  }

  /**
   * Remove exact duplicate events (same fullKey).
   *
   * @returns The number of duplicate events removed.
   */
  deduplicate(): number {
    const all = this.allEvents();
    const seen = new Map<string, ContractEvent>();

    for (const event of all) {
      const fk = fullKey(event);
      if (!seen.has(fk)) {
        seen.set(fk, event);
      }
    }

    const removed = all.length - seen.size;

    // Rebuild index from deduplicated set
    this.primary.clear();
    this.collisions.clear();

    for (const event of seen.values()) {
      const h = hashKey(event);
      if (!this.primary.has(h)) {
        this.primary.set(h, event);
      } else {
        if (!this.collisions.has(h)) {
          this.collisions.set(h, []);
        }
        this.collisions.get(h)!.push(event);
      }
    }

    return removed;
  }

  /** Total number of stored events (primary + all collision entries). */
  size(): number {
    let count = this.primary.size;
    for (const list of this.collisions.values()) {
      count += list.length;
    }
    return count;
  }

  /** Remove all events from the index. */
  clear(): void {
    this.primary.clear();
    this.collisions.clear();
  }
}
