import { afterEach, describe, expect, it } from "vitest";
import {
  LocalStorageCursorStore,
  MemoryCursorStore,
  PersistentEventDeduplicationStore,
  createCursorStore,
} from "./cursorStore";

/** Minimal in-memory Storage implementation for the working-path tests. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  getItem(key: string): string | null {
    return this.entries.has(key) ? (this.entries.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

type Restore = () => void;

/**
 * Deletes a global property entirely. Passing `undefined` is not enough: the
 * constructor's default parameter would re-engage and the test would prove nothing.
 */
function removeGlobal(name: string): Restore {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  delete (globalThis as unknown as Record<string, unknown>)[name];
  return () => {
    if (descriptor !== undefined) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as unknown as Record<string, unknown>)[name];
    }
  };
}

describe("LocalStorageCursorStore", () => {
  let restore: Restore | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("throws a descriptive error when constructed without arguments and localStorage is absent", () => {
    restore = removeGlobal("localStorage");
    expect(() => new LocalStorageCursorStore()).toThrow(/localStorage is unavailable/);
  });

  it("throws a descriptive error when constructed with an explicit undefined and localStorage is absent", () => {
    restore = removeGlobal("localStorage");
    expect(() => new LocalStorageCursorStore(undefined)).toThrow(/localStorage is unavailable/);
  });

  it("throws when the injected object does not expose the Storage methods", () => {
    expect(() => new LocalStorageCursorStore({} as Storage)).toThrow(/requires a Storage implementation/);
  });

  it("round-trips save/load/clear against a valid storage implementation", async () => {
    const store = new LocalStorageCursorStore(new MemoryStorage());
    expect(await store.load("k")).toBeUndefined();
    await store.save("k", "v");
    expect(await store.load("k")).toBe("v");
    await store.clear("k");
    expect(await store.load("k")).toBeUndefined();
  });

  it("clears only cursor entries when clear() is called without a key", async () => {
    const storage = new MemoryStorage();
    const store = new LocalStorageCursorStore(storage);
    await store.save("a", "1");
    await store.save("b", "2");
    storage.setItem("unrelated", "keep");
    await store.clear();
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBeUndefined();
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});

describe("createCursorStore", () => {
  let restore: Restore | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("returns a working MemoryCursorStore when localStorage is absent", async () => {
    restore = removeGlobal("localStorage");
    const store = createCursorStore();
    expect(store).toBeInstanceOf(MemoryCursorStore);
    await store.save("k", "v");
    expect(await store.load("k")).toBe("v");
  });

  it("returns a MemoryCursorStore when passed an explicit undefined and localStorage is absent", () => {
    restore = removeGlobal("localStorage");
    expect(createCursorStore(undefined)).toBeInstanceOf(MemoryCursorStore);
  });

  it("returns a working LocalStorageCursorStore when given a valid storage", async () => {
    const store = createCursorStore(new MemoryStorage());
    expect(store).toBeInstanceOf(LocalStorageCursorStore);
    await store.save("k", "v");
    expect(await store.load("k")).toBe("v");
  });

  it("returns a LocalStorageCursorStore backed by the global when localStorage is present", async () => {
    const storage = new MemoryStorage();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: storage, writable: true, configurable: true });
    restore = () => {
      if (descriptor !== undefined) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete (globalThis as unknown as Record<string, unknown>)["localStorage"];
    };
    const store = createCursorStore();
    expect(store).toBeInstanceOf(LocalStorageCursorStore);
    await store.save("k", "v");
    expect(storage.getItem("sorokit:cursor:k")).toBe("v");
  });

  it("falls back to MemoryCursorStore when reading localStorage throws", () => {
    restore = removeGlobal("localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: access to localStorage is denied");
      },
    });
    expect(createCursorStore()).toBeInstanceOf(MemoryCursorStore);
  });
});

describe("unaffected stores", () => {
  it("MemoryCursorStore keeps its behaviour", async () => {
    const store = new MemoryCursorStore();
    expect(await store.load("k")).toBeUndefined();
    await store.save("k", "v");
    expect(await store.load("k")).toBe("v");
    await store.clear();
    expect(await store.load("k")).toBeUndefined();
  });

  it("PersistentEventDeduplicationStore keeps its behaviour", async () => {
    const store = new PersistentEventDeduplicationStore();
    expect(await store.has("e1")).toBe(false);
    await store.add("e1");
    expect(await store.has("e1")).toBe(true);
    await store.clear();
    expect(await store.has("e1")).toBe(false);
  });
});
