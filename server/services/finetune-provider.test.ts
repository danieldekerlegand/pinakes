import { describe, it, expect } from "vitest";

/**
 * The KCB `finetune` invoke/subscribe surface (90-US-3).
 *
 * Every test here drives the WRAPPER, never the trainer: the subprocess boundary is
 * the injectable {@link FinetuneRunner}, so the whole invoke→subscribe path runs with
 * no uv, no Python, no training stack and no GPU. What the tests pin is the contract
 * the wrapper depends on — exit 0 = ran (telemetry + run record on disk), exit 2 =
 * refused at admission with a report, anything else = the runner itself is unusable
 * and the capability degrades to an actionable error rather than a crash.
 */
import {
  DEFAULT_LUGH_ROOT,
  FinetuneJobStore,
  FinetuneRefusedError,
  FinetuneRunNotFoundError,
  FinetuneUnavailableError,
  loadFinetuneConfig,
  parseTelemetryJsonl,
  startFinetune,
  subscribeFinetune,
  type FinetuneConfig,
  type FinetuneRun,
  type FinetuneRunner,
  type RefusalReport,
  type TelemetryEvent,
} from "./finetune-provider";

/** A minimal, well-formed KFT job manifest (only `job` is read app-side). */
const JOB = {
  kft_version: "0.3.0",
  job: "pinakes:activity:ft-run/test-1",
  base_model: "pinakes:model:qwen2.5-3b-instruct",
  modality: "text-generation",
  method: "qlora",
};

function event(over: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    job: JOB.job,
    step: 1,
    metrics: { train_loss: 0.9 },
    ts: "2026-07-23T00:00:00.000Z",
    kind: "train",
    state: "running",
    eventId: `${JOB.job}#train:1`,
    ...over,
  };
}

const TERMINAL: TelemetryEvent = event({
  step: 2,
  kind: "terminal",
  state: "succeeded",
  metrics: {},
  eventId: `${JOB.job}#terminal:2`,
  result: {
    model: "pinakes:model:qwen2.5-3b-instruct-ft-run-test-1",
    weights: ["pinakes:asset:sha256-abc"],
    egress: "local-only",
    licenseClass: "non-commercial",
  },
});

const REFUSAL: RefusalReport = {
  rejected: true,
  code: "cross-boundary-compute",
  message: "compute.class 'cloud-a100' would take local-only data across the boundary",
  provider: "pinakes",
  kftVersion: "0.3.0",
  detail: { computeClass: "cloud-a100", egress: "local-only" },
};

const CONFIG: FinetuneConfig = {
  enabled: true,
  lughRoot: "/repo/../lugh",
  uv: "uv",
  artifactsRoot: "/repo/data/runtime/finetune",
  stub: true,
  timeoutMs: 1000,
};

/** A runner that returns a recorded outcome and records what it was asked to run. */
function fakeRunner(
  outcome: Awaited<ReturnType<FinetuneRunner["run"]>> | (() => never),
  calls: unknown[] = [],
): FinetuneRunner {
  return {
    async run(input) {
      calls.push(input);
      if (typeof outcome === "function") outcome();
      return outcome;
    },
  };
}

/** Dispatch and wait for the fire-and-forget run to settle. */
function dispatch(
  runner: FinetuneRunner,
  store: FinetuneJobStore,
  input: Parameters<typeof startFinetune>[0] = { job: JOB },
): Promise<FinetuneRun> {
  return new Promise<FinetuneRun>((resolve, reject) => {
    try {
      startFinetune(input, { config: CONFIG, runner, store, onSettled: resolve });
    } catch (error) {
      reject(error);
    }
  });
}

describe("loadFinetuneConfig", () => {
  it("is invocable out of the box — every value has a working default", () => {
    const config = loadFinetuneConfig({}, "/repo");
    expect(config.enabled).toBe(true);
    // lugh is a sibling checkout now (90-extract-lugh), resolved the KOINE_ROOT way.
    expect(config.lughRoot).toBe(DEFAULT_LUGH_ROOT);
    expect(config.uv).toBe("uv");
    // Run dirs stay on the pinakes side — the wrapper never writes into lugh's checkout.
    expect(config.artifactsRoot).toBe("/repo/data/runtime/finetune");
    expect(config.stub).toBe(false);
  });

  it("PINAKES_FINETUNE_ENABLED=0 gates the surface off (advertise-only)", () => {
    for (const off of ["0", "false", "no", "off", "OFF"]) {
      expect(loadFinetuneConfig({ PINAKES_FINETUNE_ENABLED: off }, "/repo").enabled).toBe(false);
    }
    expect(loadFinetuneConfig({ PINAKES_FINETUNE_ENABLED: "1" }, "/repo").enabled).toBe(true);
    // An empty value is "unset", not "off" — same as the other optional-env vars.
    expect(loadFinetuneConfig({ PINAKES_FINETUNE_ENABLED: "" }, "/repo").enabled).toBe(true);
  });

  it("takes the lugh checkout and the uv binary from the environment", () => {
    const config = loadFinetuneConfig(
      { LUGH_ROOT: "/elsewhere/lugh", PINAKES_FINETUNE_UV: "/opt/bin/uv" },
      "/repo",
    );
    expect(config.lughRoot).toBe("/elsewhere/lugh");
    expect(config.uv).toBe("/opt/bin/uv");
  });
});

describe("parseTelemetryJsonl", () => {
  it("reads the runner's JSONL stream and tolerates trailing blank lines", () => {
    const jsonl = `${JSON.stringify(event())}\n${JSON.stringify(TERMINAL)}\n\n`;
    const events = parseTelemetryJsonl(jsonl);
    expect(events).toHaveLength(2);
    expect(events[1].result?.model).toBe("pinakes:model:qwen2.5-3b-instruct-ft-run-test-1");
  });
});

describe("startFinetune", () => {
  it("returns a run handle immediately and dispatches to the lugh runner (KFT §6 async)", async () => {
    const store = new FinetuneJobStore();
    const calls: unknown[] = [];
    const runner = fakeRunner({ code: 0, telemetry: [event(), TERMINAL] }, calls);

    const settled = new Promise<FinetuneRun>((resolve) => {
      const started = startFinetune(
        { job: JOB, stub: true },
        { config: CONFIG, runner, store, onSettled: resolve },
      );
      // `invoke` never blocks on training — it hands back a handle in `pending`.
      expect(started.state).toBe("pending");
      expect(started.job).toBe(JOB.job);
      expect(started.runId).toBeTruthy();
    });

    const run = await settled;
    expect(run.state).toBe("succeeded");
    // The manifest is forwarded VERBATIM — the wrapper never rewrites a job.
    expect((calls[0] as { manifest: unknown }).manifest).toEqual(JOB);
    expect((calls[0] as { stub: boolean }).stub).toBe(true);
  });

  it("streams the real telemetry the runner emitted, terminal event last", async () => {
    const store = new FinetuneJobStore();
    const run = await dispatch(fakeRunner({ code: 0, telemetry: [event(), TERMINAL] }), store);

    const result = await subscribeFinetune({ runId: run.runId }, { store });
    expect(result.state).toBe("succeeded");
    expect(result.events.map((e) => e.eventId)).toEqual([
      `${JOB.job}#train:1`,
      `${JOB.job}#terminal:2`,
    ]);
    // The §6 completion payload carries the minted model + its KMI weight assets.
    expect(result.terminal).toMatchObject({
      model: "pinakes:model:qwen2.5-3b-instruct-ft-run-test-1",
      weights: ["pinakes:asset:sha256-abc"],
      egress: "local-only",
    });
    expect(result.nextIndex).toBe(2);
  });

  it("surfaces an admission refusal as a failed run carrying the report (KFT §4.2)", async () => {
    const store = new FinetuneJobStore();
    const run = await dispatch(fakeRunner({ code: 2, refused: true, report: REFUSAL }), store);

    expect(run.state).toBe("failed");
    expect(run.report?.code).toBe("cross-boundary-compute");
    // No compute was committed, so there is no telemetry to stream.
    const result = await subscribeFinetune({ runId: run.runId }, { store });
    expect(result.events).toHaveLength(0);
    expect(result.report?.detail).toMatchObject({ computeClass: "cloud-a100" });
  });

  it("degrades to an actionable error when the lugh runner is unreachable (AC3)", async () => {
    const store = new FinetuneJobStore();
    const run = await dispatch(
      fakeRunner(() => {
        throw new FinetuneUnavailableError(
          "the lugh training stack is not installed — `uv pip install trl peft accelerate`",
        );
      }),
      store,
    );
    expect(run.state).toBe("failed");
    expect(run.error).toMatch(/uv pip install trl peft accelerate/);
  });

  it("refuses to dispatch when the surface is switched off, but never crashes", () => {
    const store = new FinetuneJobStore();
    expect(() =>
      startFinetune(
        { job: JOB },
        { config: { ...CONFIG, enabled: false }, runner: fakeRunner({ code: 0 }), store },
      ),
    ).toThrow(FinetuneUnavailableError);
    expect(store.list()).toHaveLength(0);
  });

  it("needs the KINP activity id the telemetry stream is addressed by", () => {
    const store = new FinetuneJobStore();
    for (const bad of [undefined, {}, { job: "" }, { job: 42 }]) {
      let thrown: unknown;
      try {
        startFinetune({ job: bad }, { config: CONFIG, runner: fakeRunner({ code: 0 }), store });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FinetuneRefusedError);
      expect((thrown as FinetuneRefusedError).report.code).toBe("malformed-job");
    }
  });
});

describe("FinetuneJobStore.subscribe", () => {
  it("replays buffered events then follows the run to its terminal state", async () => {
    const store = new FinetuneJobStore();
    store.create("run-1", JOB.job, { stub: true, now: "2026-07-23T00:00:00.000Z" });
    store.markRunning("run-1");
    store.append("run-1", [event()]);

    const seen: TelemetryEvent[] = [];
    const draining = (async () => {
      for await (const e of store.subscribe("run-1")) seen.push(e);
    })();

    // The subscriber is live: an event appended after it started still arrives.
    await Promise.resolve();
    store.append("run-1", [TERMINAL]);
    store.settle("run-1", { state: "succeeded", now: "2026-07-23T00:01:00.000Z" });
    await draining;

    expect(seen.map((e) => e.kind)).toEqual(["train", "terminal"]);
  });

  it("resumes from an index — events are replayable, so a reconnect is safe", async () => {
    const store = new FinetuneJobStore();
    store.create("run-2", JOB.job, { stub: true, now: "t0" });
    store.append("run-2", [event(), TERMINAL]);
    store.settle("run-2", { state: "succeeded", now: "t1" });

    const tail = await subscribeFinetune({ runId: "run-2", fromIndex: 1 }, { store });
    expect(tail.events).toHaveLength(1);
    expect(tail.events[0].kind).toBe("terminal");
    expect(tail.nextIndex).toBe(2);
  });

  it("does not block when the caller only wants what is buffered now", async () => {
    const store = new FinetuneJobStore();
    store.create("run-3", JOB.job, { stub: true, now: "t0" });
    store.markRunning("run-3");
    store.append("run-3", [event()]);

    const snapshot = await subscribeFinetune({ runId: "run-3", wait: false }, { store });
    expect(snapshot.state).toBe("running");
    expect(snapshot.events).toHaveLength(1);
  });

  it("reports an unknown run handle rather than hanging", async () => {
    const store = new FinetuneJobStore();
    await expect(subscribeFinetune({ runId: "nope" }, { store })).rejects.toBeInstanceOf(
      FinetuneRunNotFoundError,
    );
    await expect(subscribeFinetune({ runId: "" }, { store })).rejects.toBeInstanceOf(
      FinetuneRunNotFoundError,
    );
  });
});
