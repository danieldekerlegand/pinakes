import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * KCB describe → invoke → subscribe against the **real `ml/` runner** (90-US-4).
 *
 * Every other spec for this capability drives the wrapper with an injected
 * {@link FinetuneRunner}; this one does not. It shells out to the actual console script
 * (`uv run --project ml pinakes-train-slm --kft-job …`) through
 * {@link createLiveFinetuneRunner}, which is the only way to prove that the argv the
 * wrapper builds, the exit codes it branches on, and the two files it reads back are the
 * contract `ml/` actually implements — a fake runner can only prove the wrapper is
 * self-consistent.
 *
 * It needs **no heavy deps and no GPU**: the run goes through the injectable `--stub`
 * model seam (`ml/src/pinakes_ml/slm_finetune.py` `stub_trainer` / `stub_model_factory`),
 * which is the same seam `ml/`'s own CI exercises. A stub run takes well under a second.
 *
 * **What a stub run legitimately does NOT produce: weight bytes.** `kft_run.mint_weight_assets`
 * content-addresses files that exist, so a stub run mints the model entity and reports
 * `pendingExports: [adapter, merged-fp16, gguf]` with **zero** assets rather than
 * fabricating placeholder ids (`ml/CLAUDE.md` — "nothing is minted for bytes that do not
 * exist"). So the assertions below pin the minted **model entity id** and the fact that the
 * GGUF asset is reported *pending*; the populated-asset shape of the terminal payload is
 * pinned in `finetune-provider.test.ts`, where a fake runner can hand back the outcome a
 * real `pinakes-export-gguf` produces without inventing a 2 GB file.
 */
import {
  createLiveFinetuneRunner,
  loadFinetuneConfig,
  FinetuneJobStore,
  startFinetune,
  subscribeFinetune,
  type FinetuneConfig,
  type FinetuneRun,
} from "./finetune-provider";
import { selectFinetuneProvider, type ProviderManifest } from "./finetune-routing";
import { registerCapabilityBusRoutes } from "../routes/capability-bus";
import { CAPABILITY_MANIFEST } from "@shared/capability-manifest";

const REPO_ROOT = process.cwd();
const ML_ROOT = join(REPO_ROOT, "ml");
const GOLDEN_JOB = join(ML_ROOT, "fixtures", "kft", "finetune-job.json");
const RUNNER_MODULE = join(ML_ROOT, "src", "pinakes_ml", "train_slm.py");

/**
 * Whether the `ml/` workspace can actually be driven here. `uv` is not a dependency of
 * the web app, so a checkout without it skips the live leg — but see the guard test
 * below: everything that could *rot* (paths, the console-script entry) is asserted
 * unconditionally, so a relocation fails loudly instead of silently vanishing into a
 * skip (the `ml/CLAUDE.md` "a stale path is a permanent SKIP, not a failure" gotcha).
 */
function uvIsAvailable(): boolean {
  try {
    return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

const LIVE = uvIsAvailable() && existsSync(RUNNER_MODULE);

describe("the ml/ runner the wrapper dispatches to", () => {
  it("is where the manifest says it is, and is a declared console script", () => {
    expect(existsSync(RUNNER_MODULE)).toBe(true);
    expect(existsSync(GOLDEN_JOB)).toBe(true);
    const pyproject = readFileSync(join(ML_ROOT, "pyproject.toml"), "utf-8");
    expect(pyproject).toContain('pinakes-train-slm = "pinakes_ml.train_slm:main"');
    // The capability advertises that module by path; a move that broke this would make
    // the manifest point at nothing (the `x_surfaces` wrapper invariant).
    const finetune = CAPABILITY_MANIFEST.capabilities.find((c) => c.name === "finetune");
    expect(finetune?.x_surfaces.map((s) => s.implementation)).toContain(
      "ml/src/pinakes_ml/train_slm.py",
    );
    expect(finetune?.x_specialization?.admission).toBe("ml/src/pinakes_ml/kft.py");
    expect(existsSync(join(REPO_ROOT, finetune!.x_specialization!.admission!))).toBe(true);
  });
});

describe.skipIf(!LIVE)("KFT describe → invoke → subscribe (real ml/ runner, --stub)", () => {
  let artifactsRoot: string;
  let config: FinetuneConfig;
  let baseUrl: string;
  let server: Server;

  beforeAll(async () => {
    artifactsRoot = mkdtempSync(join(tmpdir(), "pinakes-kft-"));
    config = { ...loadFinetuneConfig({}, REPO_ROOT), artifactsRoot, stub: true, timeoutMs: 600_000 };
    const app: Express = express();
    app.use(express.json());
    registerCapabilityBusRoutes(app, { origin: null, publish: async () => ({
      registered: false,
      servingDirectly: true,
      registryUrl: null,
      detail: "not attempted in this test",
    }) });
    server = await new Promise<Server>((done) => {
      const s = app.listen(0, () => done(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(artifactsRoot, { recursive: true, force: true });
  });

  /**
   * The `invoke` verb over the live runner. Returns immediately with a handle (KFT §6 —
   * an invoke *starts* an async run), plus the store to `subscribe` against and a promise
   * the test can await so the fire-and-forget dispatch is deterministic.
   */
  function invoke(job: unknown) {
    const store = new FinetuneJobStore();
    let settle!: (run: FinetuneRun) => void;
    const settled = new Promise<FinetuneRun>((done) => {
      settle = done;
    });
    const handle = startFinetune(
      { job, stub: true },
      { config, store, runner: createLiveFinetuneRunner(config), onSettled: (run) => settle(run) },
    );
    return { handle, store, settled };
  }

  it("describes the capability with the FT-K signal a registry routes on", async () => {
    const body = await fetch(`${baseUrl}/api/kcb/capabilities`).then((r) => r.json());
    const finetune = body.capabilities.find((c: { name: string }) => c.name === "finetune");
    expect(finetune.grant).toBe("invoke:finetune");
    expect(finetune.cost.meter).toBe("gpu-seconds");
    expect(finetune.specialization).toMatchObject({
      provider_class: "specialized",
      modality: "text-generation",
      egress: "local-only",
    });
  });

  it("runs the golden job end to end and streams the KFT §6 telemetry", async () => {
    const job = JSON.parse(readFileSync(GOLDEN_JOB, "utf-8"));
    // The registry would send this job here: `datasetKind: rule-sft` is the signal.
    const providers: ProviderManifest[] = [CAPABILITY_MANIFEST];
    expect(selectFinetuneProvider({ job }, providers).provider).toBe("pinakes:agent:resolver");

    const { handle, store, settled } = invoke(job);
    // invoke returns a handle, not a result — training has not finished (KFT §6).
    expect(handle.job).toBe(job.job);
    expect(handle.state).toBe("pending");

    // subscribe drains the live stream to the terminal event.
    const stream = await subscribeFinetune({ runId: handle.runId }, { store });
    const run = await settled;
    expect(run.error).toBeUndefined();
    expect(stream.state).toBe("succeeded");
    expect(stream.nextIndex).toBe(stream.events.length);

    const events = stream.events;
    expect(events.length).toBeGreaterThan(3);
    // A real loss/adherence curve, not a fabricated one: the tier-4 eval brackets the
    // training rows, and the terminal event is last.
    expect(events[0].kind).toBe("eval:untuned");
    expect(events.some((e) => e.kind === "train")).toBe(true);
    expect(events.some((e) => e.kind === "eval:finetuned")).toBe(true);
    expect(events[events.length - 1].kind).toBe("terminal");
    // §6 addresses by job+step, which collides here (eval and terminal share the final
    // step) — `eventId` carries the kind, so redelivery stays idempotent.
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    for (const event of events) {
      expect(event.job).toBe(job.job);
      expect(typeof event.step).toBe("number");
      expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // The stub reports the schedule it really ran and NO loss — a fabricated curve is
    // exactly what §6 exists to replace (ml/CLAUDE.md).
    const train = events.filter((e) => e.kind === "train");
    expect(train.map((e) => e.step)).toEqual(train.map((_, i) => i + 1));
    for (const e of train) expect(e.metrics.train_loss).toBeUndefined();
  });

  it("ends with a terminal event carrying the minted model entity + the weight-asset slot", async () => {
    const job = JSON.parse(readFileSync(GOLDEN_JOB, "utf-8"));
    const { handle, store, settled } = invoke(job);
    const stream = await subscribeFinetune({ runId: handle.runId }, { store });
    const run = await settled;
    const terminal = stream.events[stream.events.length - 1];
    expect(terminal.state).toBe("succeeded");
    // The completion payload is on the stream too — a subscriber never has to re-fetch.
    expect(stream.terminal).toEqual(terminal.result);

    const result = terminal.result as Record<string, unknown>;
    // KFT §5.1/§5.2 — minted off the base entity + the job's PROV activity id.
    expect(result.model).toBe("pinakes:model:qwen2.5-3b-instruct-ft-run-insimul-slm-9f2a");
    // §5.4 — the run's egress and union license inherit onto the outputs.
    expect(result.egress).toBe("local-only");
    expect(result.licenseClass).toBe("proprietary");
    // §5.3 — no bytes, so no asset ids; the GGUF is reported pending, never invented.
    expect(result.weights).toEqual([]);
    expect(result.pendingExports).toEqual(["adapter", "merged-fp16", "gguf"]);

    const record = run.runRecord!;
    expect(stream.runRecord).toEqual(record);
    expect(record.assets).toEqual([]);
    expect(record.model).toMatchObject({
      entityId: result.model,
      basedOn: "pinakes:model:qwen2.5-3b-instruct",
      derivedFrom: "pinakes:model:qwen2.5-3b-instruct",
      egress: "local-only",
      localOnly: true,
    });
    // The run's reproducibility anchor (§5.2, FT-C) rides on the PROV activity.
    expect(record.provenance).toMatchObject({ activity: job.job, seed: job.seed });
  });

  it("refuses a cross-boundary compute class with a report, before any compute (KFT §4.2)", async () => {
    // Pinakes is the LOCAL-ONLY leg: its SLM corpora are synthetic/proprietary/personal
    // tier, so the effective egress is local-only and a cloud placement is refused at
    // admission — not attempted and abandoned. agora's general trainer is the cloud-capable
    // sibling (agora:90-finetune-trainer), and this is the boundary between them.
    const job = JSON.parse(readFileSync(GOLDEN_JOB, "utf-8"));
    job.compute = { class: "single-gpu-a100-80gb", egress: "derived" };

    const { handle, store, settled } = invoke(job);
    const stream = await subscribeFinetune({ runId: handle.runId }, { store });
    const run = await settled;
    expect(run.state).toBe("failed");
    expect(stream.report?.code).toBe("cross-boundary-compute");
    expect(stream.report?.provider).toBe("pinakes");
    expect(stream.report?.detail).toMatchObject({
      computeClass: "single-gpu-a100-80gb",
      effective: "local-only",
    });
    expect(stream.report?.message).toContain("never bursts");
    // No compute was committed: no telemetry, no run record, no minted model.
    expect(stream.events).toEqual([]);
    expect(run.runRecord).toBeUndefined();
  });

  it("refuses a job outside the specialization with the code a router reads (FT-K)", async () => {
    const job = JSON.parse(readFileSync(GOLDEN_JOB, "utf-8"));
    job.modality = "text-to-image";
    job.method = "lora";

    // A registry applying FT-K would never send this here in the first place…
    const decision = selectFinetuneProvider({ job }, [CAPABILITY_MANIFEST]);
    expect(decision.outcome).toBe("unroutable");
    expect(decision.rejected[0].code).toBe("unsupported-modality");

    // …and if one did anyway, admission refuses it with the same code and names agora.
    const { handle, store } = invoke(job);
    const stream = await subscribeFinetune({ runId: handle.runId }, { store });
    expect(stream.state).toBe("failed");
    expect(stream.report?.code).toBe("unsupported-modality");
    expect(stream.report?.message).toContain("agora");
  });
});
