import { describe, it, expect, vi } from "vitest";
import { getOnlineStatus, subscribeOnlineStatus } from "./online-status";

describe("getOnlineStatus()", () => {
  it("reflects navigator.onLine when present", () => {
    expect(getOnlineStatus({ onLine: true })).toBe(true);
    expect(getOnlineStatus({ onLine: false })).toBe(false);
  });

  it("defaults to online when onLine is unavailable", () => {
    expect(getOnlineStatus(null)).toBe(true);
    expect(getOnlineStatus(undefined)).toBe(true);
    expect(getOnlineStatus({})).toBe(true);
  });
});

describe("subscribeOnlineStatus()", () => {
  function fakeTarget() {
    const listeners: Record<string, Array<() => void>> = {
      online: [],
      offline: [],
    };
    return {
      listeners,
      addEventListener: vi.fn((type: "online" | "offline", cb: () => void) => {
        listeners[type].push(cb);
      }),
      removeEventListener: vi.fn((type: "online" | "offline", cb: () => void) => {
        listeners[type] = listeners[type].filter((l) => l !== cb);
      }),
      emit(type: "online" | "offline") {
        listeners[type].forEach((l) => l());
      },
    };
  }

  it("invokes callback with true on online and false on offline", () => {
    const target = fakeTarget();
    const cb = vi.fn();
    subscribeOnlineStatus(target, cb);

    target.emit("offline");
    expect(cb).toHaveBeenLastCalledWith(false);
    target.emit("online");
    expect(cb).toHaveBeenLastCalledWith(true);
  });

  it("removes both listeners on unsubscribe", () => {
    const target = fakeTarget();
    const cb = vi.fn();
    const unsubscribe = subscribeOnlineStatus(target, cb);
    expect(target.listeners.online.length).toBe(1);
    expect(target.listeners.offline.length).toBe(1);

    unsubscribe();
    expect(target.listeners.online.length).toBe(0);
    expect(target.listeners.offline.length).toBe(0);

    target.emit("offline");
    expect(cb).not.toHaveBeenCalled();
  });
});
