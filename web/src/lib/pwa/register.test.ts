import { describe, it, expect, vi } from "vitest";
import {
  registerServiceWorker,
  unregisterServiceWorkers,
  type NavigatorLike,
} from "./register";

function fakeNavigator(
  register: (url: string, opts?: { scope?: string }) => Promise<unknown>,
): NavigatorLike {
  return { serviceWorker: { register } as never };
}

describe("registerServiceWorker()", () => {
  it("skips registration outside production", async () => {
    const register = vi.fn();
    const reg = await registerServiceWorker({
      isProduction: false,
      navigator: fakeNavigator(register),
    });
    expect(reg).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("skips when service workers are unsupported", async () => {
    const reg = await registerServiceWorker({
      isProduction: true,
      navigator: {} as NavigatorLike,
    });
    expect(reg).toBeNull();
  });

  it("skips when navigator is absent", async () => {
    const reg = await registerServiceWorker({
      isProduction: true,
      navigator: null,
    });
    expect(reg).toBeNull();
  });

  it("registers /sw.js at scope / in production", async () => {
    const fakeReg = { scope: "/" };
    const register = vi.fn().mockResolvedValue(fakeReg);
    const reg = await registerServiceWorker({
      isProduction: true,
      navigator: fakeNavigator(register),
    });
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(reg).toBe(fakeReg);
  });

  it("honors custom swUrl and scope", async () => {
    const register = vi.fn().mockResolvedValue({});
    await registerServiceWorker({
      isProduction: true,
      navigator: fakeNavigator(register),
      swUrl: "/service.js",
      scope: "/app/",
    });
    expect(register).toHaveBeenCalledWith("/service.js", { scope: "/app/" });
  });

  it("swallows registration errors and reports via onError", async () => {
    const boom = new Error("nope");
    const onError = vi.fn();
    const register = vi.fn().mockRejectedValue(boom);
    const reg = await registerServiceWorker({
      isProduction: true,
      navigator: fakeNavigator(register),
      onError,
    });
    expect(reg).toBeNull();
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe("unregisterServiceWorkers()", () => {
  it("returns 0 when unsupported", async () => {
    expect(await unregisterServiceWorkers({} as NavigatorLike)).toBe(0);
    expect(await unregisterServiceWorkers(null)).toBe(0);
  });

  it("unregisters all registrations and counts successes", async () => {
    const regs = [
      { unregister: vi.fn().mockResolvedValue(true) },
      { unregister: vi.fn().mockResolvedValue(false) },
      { unregister: vi.fn().mockResolvedValue(true) },
    ];
    const nav: NavigatorLike = {
      serviceWorker: {
        register: vi.fn(),
        getRegistrations: vi.fn().mockResolvedValue(regs),
      } as never,
    };
    expect(await unregisterServiceWorkers(nav)).toBe(2);
    for (const r of regs) expect(r.unregister).toHaveBeenCalled();
  });

  it("returns 0 when getRegistrations throws", async () => {
    const nav: NavigatorLike = {
      serviceWorker: {
        register: vi.fn(),
        getRegistrations: vi.fn().mockRejectedValue(new Error("x")),
      } as never,
    };
    expect(await unregisterServiceWorkers(nav)).toBe(0);
  });
});
