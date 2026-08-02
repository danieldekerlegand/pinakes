/**
 * The KCB `finetune` capability's invoke/subscribe surface (90-US-3).
 *
 * KFT (`koine/specs/fine-tuning.md`) is deliberately **multi-provider** (§9, FT-K):
 * agora hosts the *general* trainer, and Pinakes runs its **own specialized**
 * `finetune` provider over the already-built `ml/` uv workspace. This module is that
 * provider's app-side front — and it is a **SURFACE WRAPPER, nothing more**
 * (`contracts/CLAUDE.md`): an `invoke` shells out to the already-built console script
 *
 *     uv run --project ml pinakes-train-slm --kft-job <manifest> --output-dir <run>
 *
 * and reads back the artifacts that script already writes — `kft-telemetry.jsonl`
 * (the KFT §6 training-telemetry stream) and `kft-run.json` (the §5 minted model +
 * KMI weight assets). **No training logic lives here**; `ml/src/pinakes_ml/` stays
 * the sole trainer, `ml/src/pinakes_ml/kft.py` stays the sole admission gate, and the
 * TS side never decides whether a job is admissible.
 *
 * The runner's contract, fixed by 90-US-1/US-2 and relied on here:
 *   - exit **0** — the run completed; telemetry + run record are on disk;
 *   - exit **2** — the job was **refused at admission** (specialization or the §4.2
 *     egress gate) and a machine-readable report is on stdout, no compute committed;
 *   - anything else — the runner itself failed (e.g. the undeclared trl/peft stack is
 *     absent, which is the common case in a slim environment).
 *
 * **Optional-env degrade** (the `GEONAMES_USERNAME` / `KCB_REGISTRY_URL` shape): the
 * capability is *always advertised* on the manifest, and a dispatch that cannot reach
 * the `ml/` runner returns an actionable {@link FinetuneUnavailableError} rather than
 * crashing the server. `PINAKES_FINETUNE_ENABLED=0` turns the invoke surface off the
 * same way — advertised, not invocable, with a message that says why.
 *
 * Everything network/subprocess-shaped sits behind the injectable {@link FinetuneRunner}
 * (the `engine-acquisition.ts` pattern), so the whole invoke→subscribe path is
 * tested with an in-memory fake — no uv, no Python, no GPU.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The capability name this service fronts (mirrors the manifest entry). */
export const FINETUNE_CAPABILITY = "finetune";

/** Exit code `pinakes-train-slm --kft-job` uses for an admission refusal (90-US-2). */
export const REFUSAL_EXIT_CODE = 2;

/** The job manifest the wrapper hands the runner, inside the run dir. */
export const JOB_MANIFEST_FILE = "finetune-job.json";

/** The KFT §6 telemetry stream the runner writes (JSONL, one event per line). */
export const TELEMETRY_FILE = "kft-telemetry.jsonl";

/** The KFT §5 run record the runner writes (minted model + weight assets). */
export const RUN_RECORD_FILE = "kft-run.json";

/** KFT §6 run-lifecycle states. */
export type FinetuneState = "pending" | "running" | "succeeded" | "failed" | "canceled";

/** The states after which no further telemetry arrives. */
export const TERMINAL_STATES: readonly FinetuneState[] = ["succeeded", "failed", "canceled"];

/**
 * One KFT §6 training-telemetry event, exactly as `pinakes_ml.kft_run` emits it.
 * `eventId` (`<job>#<kind>:<step>`) is the content address a consumer dedups on —
 * `job`+`step` alone is not unique here, because the eval and terminal events share
 * the final step.
 */
export interface TelemetryEvent {
  readonly job: string;
  readonly step: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly ts: string;
  readonly kind: string;
  readonly state: string;
  readonly eventId: string;
  readonly checkpoint?: string;
  readonly samples?: readonly string[];
  /** Present on the terminal event: minted model id, weight asset ids, eval results. */
  readonly result?: Readonly<Record<string, unknown>>;
}

/** The `kft-run.json` record — read back, never re-derived app-side. */
export interface FinetuneRunRecord {
  readonly runRecordVersion?: number;
  readonly kftVersion?: string;
  readonly model?: Readonly<Record<string, unknown>>;
  readonly assets?: readonly Readonly<Record<string, unknown>>[];
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly pendingExports?: readonly string[];
  readonly unsupportedExports?: readonly string[];
}

/** A KFT admission refusal report (`pinakes_ml.kft.JobRejected.report`). */
export interface RefusalReport {
  readonly rejected: true;
  readonly code: string;
  readonly message: string;
  readonly provider: string;
  readonly kftVersion?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * The `ml/` runner could not be reached or is switched off — the degrade path. The
 * capability stays advertised; the message tells the caller how to make it invocable.
 */
export class FinetuneUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinetuneUnavailableError";
  }
}

/** The job was refused **at admission** by `ml/`, before any compute (KFT §3.1/§4.2). */
export class FinetuneRefusedError extends Error {
  readonly report: RefusalReport;
  constructor(report: RefusalReport) {
    super(report.message);
    this.name = "FinetuneRefusedError";
    this.report = report;
  }
}

/** No such run handle (a stale `runId`, or one from a previous process). */
export class FinetuneRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`unknown finetune run "${runId}"`);
    this.name = "FinetuneRunNotFoundError";
  }
}

// ── Configuration (optional-env degrade) ─────────────────────────────────────

export interface FinetuneConfig {
  /** Whether an invoke may dispatch. False ⇒ advertised but not invocable. */
  readonly enabled: boolean;
  /** The `ml/` uv workspace root the console script lives in. */
  readonly mlRoot: string;
  /** The `uv` binary that runs it. */
  readonly uv: string;
  /** Where run dirs are created (git-ignored; the runner writes only here). */
  readonly artifactsRoot: string;
  /** Pass `--stub` by default — the injectable model seam, no heavy deps, no GPU. */
  readonly stub: boolean;
  /** Kill the subprocess after this long. */
  readonly timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 3_600_000;

function truthy(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

/**
 * Read the finetune surface's configuration from the environment.
 *
 * Every value has a working default, so the capability is invocable out of the box in
 * a checkout that has the `ml/` workspace synced — and `PINAKES_FINETUNE_ENABLED=0`
 * is the single switch an operator flips to advertise-only.
 */
export function loadFinetuneConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string = process.cwd(),
): FinetuneConfig {
  const mlRoot = env.PINAKES_ML_DIR ? resolve(env.PINAKES_ML_DIR) : join(repoRoot, "ml");
  const timeout = Number(env.PINAKES_FINETUNE_TIMEOUT_MS);
  return {
    enabled: truthy(env.PINAKES_FINETUNE_ENABLED, true),
    mlRoot,
    uv: env.PINAKES_FINETUNE_UV || "uv",
    artifactsRoot: env.PINAKES_FINETUNE_ARTIFACTS
      ? resolve(env.PINAKES_FINETUNE_ARTIFACTS)
      : join(mlRoot, "artifacts", "kcb"),
    stub: truthy(env.PINAKES_FINETUNE_STUB, false),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

// ── The injectable runner boundary ───────────────────────────────────────────

export interface FinetuneRunInput {
  /** The KFT finetune-job manifest, verbatim — the wrapper never rewrites it. */
  readonly manifest: unknown;
  /** The run's output dir; the runner writes telemetry + the run record here. */
  readonly runDir: string;
  /** Run against the injectable stub model (no heavy deps, no GPU). */
  readonly stub: boolean;
}

export interface FinetuneRunOutcome {
  readonly code: number;
  /** True when the runner refused at admission (exit 2) — `report` is then set. */
  readonly refused?: boolean;
  readonly report?: RefusalReport;
  readonly telemetry?: readonly TelemetryEvent[];
  readonly runRecord?: FinetuneRunRecord;
}

/** The subprocess boundary — the one thing tests replace. */
export interface FinetuneRunner {
  run(input: FinetuneRunInput): Promise<FinetuneRunOutcome>;
}

/** Result of executing the console script (the raw process outcome). */
interface ProcessOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function execute(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
): Promise<ProcessOutcome> {
  return new Promise<ProcessOutcome>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      // ENOENT here means `uv` itself is missing — the degrade case, not a run failure.
      rejectPromise(
        error.code === "ENOENT"
          ? new FinetuneUnavailableError(
              `the ml/ finetune runner is unreachable: "${command}" was not found. ` +
                "Install uv (https://docs.astral.sh/uv/) and sync the workspace " +
                "(`uv sync --project ml`), or set PINAKES_FINETUNE_UV / " +
                "PINAKES_FINETUNE_ENABLED=0 to advertise the capability without dispatching.",
            )
          : error,
      );
    });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

/** Whether the runner's output is the undeclared-training-stack message (`require_finetune_deps`). */
function isMissingTrainingStack(output: string): boolean {
  return /uv pip install trl peft accelerate|undeclared\) training stack/.test(output);
}

function parseRefusalReport(stdout: string): RefusalReport {
  // The CLI prints ONLY the report on a refusal, but tolerate leading NOTE lines.
  const start = stdout.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(stdout.slice(start)) as RefusalReport;
      if (parsed && typeof parsed.code === "string") return parsed;
    } catch {
      // fall through to the synthetic report below
    }
  }
  return {
    rejected: true,
    code: "unreadable-report",
    message: `the runner refused the job but its report could not be parsed: ${stdout.trim()}`,
    provider: "pinakes",
  };
}

/** Parse the JSONL telemetry stream, skipping blank lines. */
export function parseTelemetryJsonl(text: string): TelemetryEvent[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

/**
 * The live runner: write the manifest, shell out to `pinakes-train-slm --kft-job`,
 * read back the telemetry + run record it wrote. That console script is the whole
 * implementation — this function adds no training behaviour of its own.
 */
export function createLiveFinetuneRunner(config: FinetuneConfig): FinetuneRunner {
  return {
    async run({ manifest, runDir, stub }: FinetuneRunInput): Promise<FinetuneRunOutcome> {
      await mkdir(runDir, { recursive: true });
      const manifestPath = join(runDir, JOB_MANIFEST_FILE);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

      const args = [
        "run",
        "--project",
        config.mlRoot,
        "pinakes-train-slm",
        "--kft-job",
        manifestPath,
        "--output-dir",
        runDir,
        // The KCB surface owns neither the MLflow store nor docs/ml-baselines.md.
        "--no-mlflow",
        "--no-doc",
      ];
      if (stub) args.push("--stub");

      const outcome = await execute(config.uv, args, {
        cwd: config.mlRoot,
        timeoutMs: config.timeoutMs,
      });

      if (outcome.code === REFUSAL_EXIT_CODE) {
        return { code: outcome.code, refused: true, report: parseRefusalReport(outcome.stdout) };
      }
      if (outcome.code !== 0) {
        const detail = `${outcome.stderr}\n${outcome.stdout}`.trim();
        if (isMissingTrainingStack(detail)) {
          throw new FinetuneUnavailableError(
            "the ml/ training stack is not installed — trl/peft/accelerate are " +
              "deliberately undeclared dependencies (ml/CLAUDE.md). Install them " +
              "(`uv pip install trl peft accelerate`) or invoke with `stub: true` " +
              `to run the pipeline against the injectable stub model. Runner said: ${detail}`,
          );
        }
        throw new Error(`the ml/ finetune runner exited ${outcome.code}: ${detail}`);
      }

      const telemetry = parseTelemetryJsonl(
        await readFile(join(runDir, TELEMETRY_FILE), "utf-8"),
      );
      const runRecord = JSON.parse(
        await readFile(join(runDir, RUN_RECORD_FILE), "utf-8"),
      ) as FinetuneRunRecord;
      return { code: 0, telemetry, runRecord };
    },
  };
}

// ── The run store (invoke → subscribe) ───────────────────────────────────────

/** One dispatched run, as a consumer sees it. */
export interface FinetuneRun {
  /** Local handle for `subscribe` — NOT the KINP activity id. */
  readonly runId: string;
  /** The job's KINP activity id (KFT §3 `job`), the telemetry stream's address. */
  readonly job: string;
  readonly state: FinetuneState;
  readonly stub: boolean;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly events: readonly TelemetryEvent[];
  /** Set once the run settles successfully. */
  readonly runRecord?: FinetuneRunRecord;
  /** Set when `ml/` refused the job at admission (KFT §3.1/§4.2). */
  readonly report?: RefusalReport;
  /** Set when the dispatch itself failed (runner unreachable, crash, timeout). */
  readonly error?: string;
}

interface MutableRun {
  runId: string;
  job: string;
  state: FinetuneState;
  stub: boolean;
  startedAt: string;
  completedAt?: string;
  events: TelemetryEvent[];
  runRecord?: FinetuneRunRecord;
  report?: RefusalReport;
  error?: string;
}

function frozen(run: MutableRun): FinetuneRun {
  return { ...run, events: [...run.events] };
}

/**
 * In-memory registry of dispatched runs plus the `subscribe` fan-out.
 *
 * Deliberately not persisted: a run handle is only meaningful while the dispatching
 * process lives, and the durable record is the run dir the `ml/` runner wrote
 * (`kft-run.json` + `kft-telemetry.jsonl`) — the same stance `jobStore` takes for
 * acquisition jobs.
 */
export class FinetuneJobStore {
  private readonly runs = new Map<string, MutableRun>();
  private readonly waiters = new Map<string, Array<() => void>>();

  create(runId: string, job: string, options: { stub: boolean; now: string }): FinetuneRun {
    const run: MutableRun = {
      runId,
      job,
      state: "pending",
      stub: options.stub,
      startedAt: options.now,
      events: [],
    };
    this.runs.set(runId, run);
    return frozen(run);
  }

  get(runId: string): FinetuneRun | undefined {
    const run = this.runs.get(runId);
    return run ? frozen(run) : undefined;
  }

  list(): FinetuneRun[] {
    return [...this.runs.values()].map(frozen);
  }

  markRunning(runId: string): void {
    const run = this.require(runId);
    if (run.state === "pending") run.state = "running";
    this.notify(runId);
  }

  append(runId: string, events: readonly TelemetryEvent[]): void {
    if (events.length === 0) return;
    this.require(runId).events.push(...events);
    this.notify(runId);
  }

  settle(
    runId: string,
    outcome: {
      state: FinetuneState;
      now: string;
      runRecord?: FinetuneRunRecord;
      report?: RefusalReport;
      error?: string;
    },
  ): void {
    const run = this.require(runId);
    run.state = outcome.state;
    run.completedAt = outcome.now;
    if (outcome.runRecord) run.runRecord = outcome.runRecord;
    if (outcome.report) run.report = outcome.report;
    if (outcome.error) run.error = outcome.error;
    this.notify(runId);
  }

  /**
   * The KCB `subscribe` verb: yield every telemetry event from `fromIndex`, then keep
   * yielding as they arrive, and return when the run reaches a terminal state. Events
   * are idempotent under redelivery (`eventId`), so a reconnecting consumer may replay
   * from 0 without special handling.
   */
  async *subscribe(runId: string, fromIndex = 0): AsyncGenerator<TelemetryEvent> {
    let index = Math.max(0, fromIndex);
    for (;;) {
      const run = this.require(runId);
      while (index < run.events.length) {
        yield run.events[index];
        index += 1;
      }
      if (TERMINAL_STATES.includes(run.state)) return;
      await this.nextChange(runId);
    }
  }

  private require(runId: string): MutableRun {
    const run = this.runs.get(runId);
    if (!run) throw new FinetuneRunNotFoundError(runId);
    return run;
  }

  private nextChange(runId: string): Promise<void> {
    return new Promise<void>((resolvePromise) => {
      const list = this.waiters.get(runId) ?? [];
      list.push(resolvePromise);
      this.waiters.set(runId, list);
    });
  }

  private notify(runId: string): void {
    const list = this.waiters.get(runId);
    if (!list) return;
    this.waiters.delete(runId);
    for (const wake of list) wake();
  }
}

/** The process-wide store the live MCP/A2A surfaces dispatch into. */
export const finetuneJobStore = new FinetuneJobStore();

// ── invoke ───────────────────────────────────────────────────────────────────

export interface FinetuneInvokeInput {
  /** The KFT finetune-job manifest (koine/schemas/finetune-job.schema.json). */
  readonly job?: unknown;
  /** Run against the injectable stub model instead of the real training stack. */
  readonly stub?: boolean;
}

export interface FinetuneInvokeResult {
  readonly runId: string;
  readonly job: string;
  readonly state: FinetuneState;
  readonly stub: boolean;
  readonly message: string;
}

export interface FinetuneDeps {
  readonly config?: FinetuneConfig;
  readonly runner?: FinetuneRunner;
  readonly store?: FinetuneJobStore;
  readonly newRunId?: () => string;
  readonly now?: () => string;
  /** Awaited by tests so the fire-and-forget dispatch is deterministic. */
  readonly onSettled?: (run: FinetuneRun) => void;
}

/**
 * The KINP activity id a job is keyed by — the ONE thing read out of the manifest
 * app-side. Every other admission rule (specialization, the §4.2 egress gate,
 * hyperparameter validation) belongs to `ml/src/pinakes_ml/kft.py` and is not
 * duplicated here; a manifest that gets past this check and is then refused is
 * exactly the intended flow.
 */
function jobActivityId(manifest: unknown): string {
  const job = (manifest as { job?: unknown } | null)?.job;
  if (typeof job !== "string" || job.trim() === "") {
    throw new FinetuneRefusedError({
      rejected: true,
      code: "malformed-job",
      message:
        'a finetune job needs a "job" KINP activity id (KFT §3, ' +
        "koine/schemas/finetune-job.schema.json) — the telemetry stream is addressed by it",
      provider: "pinakes",
    });
  }
  return job.trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The terminal lifecycle state the run's own last event reports (KFT §6). */
function terminalStateOf(events: readonly TelemetryEvent[]): FinetuneState {
  const last = events[events.length - 1];
  const state = last?.state;
  return TERMINAL_STATES.includes(state as FinetuneState)
    ? (state as FinetuneState)
    : "succeeded";
}

/**
 * Start a KFT run: validate we can address it, register the handle, and dispatch to
 * the `ml/` runner **fire-and-forget** (KFT §6 — `invoke` begins an *async* run, and
 * a consumer follows it with `subscribe`). Returns as soon as the handle exists.
 *
 * Throws {@link FinetuneUnavailableError} when the surface is switched off and
 * {@link FinetuneRefusedError} when the manifest is not even addressable; every other
 * refusal comes back through the stream as a `failed` terminal state with a report.
 */
export function startFinetune(
  input: FinetuneInvokeInput,
  deps: FinetuneDeps = {},
): FinetuneInvokeResult {
  const config = deps.config ?? loadFinetuneConfig();
  const store = deps.store ?? finetuneJobStore;
  const now = deps.now ?? (() => new Date().toISOString());

  if (!config.enabled) {
    throw new FinetuneUnavailableError(
      "the finetune invoke surface is disabled (PINAKES_FINETUNE_ENABLED=0). The " +
        "capability stays advertised on the KCB manifest; re-enable it to dispatch, " +
        "or route the job to the general trainer (KFT §9).",
    );
  }

  const manifest = input.job;
  const job = jobActivityId(manifest);
  const stub = input.stub ?? config.stub;
  const runId = (deps.newRunId ?? randomUUID)();
  store.create(runId, job, { stub, now: now() });

  const runner = deps.runner ?? createLiveFinetuneRunner(config);
  const runDir = join(config.artifactsRoot, runId);

  void (async () => {
    try {
      store.markRunning(runId);
      const outcome = await runner.run({ manifest, runDir, stub });
      if (outcome.refused) {
        store.settle(runId, {
          state: "failed",
          now: now(),
          report: outcome.report,
          error: outcome.report?.message,
        });
      } else {
        const events = outcome.telemetry ?? [];
        store.append(runId, events);
        store.settle(runId, {
          state: terminalStateOf(events),
          now: now(),
          runRecord: outcome.runRecord,
        });
      }
    } catch (error) {
      store.settle(runId, { state: "failed", now: now(), error: messageOf(error) });
    } finally {
      const settled = store.get(runId);
      if (settled) deps.onSettled?.(settled);
    }
  })();

  return {
    runId,
    job,
    state: "pending",
    stub,
    message: `finetune run started for ${job}; subscribe with runId ${runId}`,
  };
}

// ── subscribe ────────────────────────────────────────────────────────────────

export interface FinetuneSubscribeInput {
  readonly runId?: string;
  /** Resume point in the stream (events are replayable — `eventId` dedups). */
  readonly fromIndex?: number;
  /** Await the terminal event (default); `false` returns what is buffered now. */
  readonly wait?: boolean;
}

export interface FinetuneSubscribeResult {
  readonly runId: string;
  readonly job: string;
  readonly state: FinetuneState;
  readonly events: readonly TelemetryEvent[];
  readonly nextIndex: number;
  /** The KFT §6 completion payload (minted model id + weight asset ids). */
  readonly terminal?: Readonly<Record<string, unknown>>;
  readonly runRecord?: FinetuneRunRecord;
  readonly report?: RefusalReport;
  readonly error?: string;
}

/**
 * The KCB `subscribe` verb over one run's KFT §6 stream. With `wait` (the default) it
 * drains to the terminal event; with `wait: false` it returns the buffered slice so a
 * poller can advance `fromIndex` itself.
 */
export async function subscribeFinetune(
  input: FinetuneSubscribeInput,
  deps: FinetuneDeps = {},
): Promise<FinetuneSubscribeResult> {
  const store = deps.store ?? finetuneJobStore;
  const runId = input.runId?.trim();
  if (!runId) throw new FinetuneRunNotFoundError(String(input.runId ?? ""));
  const fromIndex = Math.max(0, input.fromIndex ?? 0);

  const events: TelemetryEvent[] = [];
  if (input.wait === false) {
    const snapshot = store.get(runId);
    if (!snapshot) throw new FinetuneRunNotFoundError(runId);
    events.push(...snapshot.events.slice(fromIndex));
  } else {
    for await (const event of store.subscribe(runId, fromIndex)) events.push(event);
  }

  const run = store.get(runId);
  if (!run) throw new FinetuneRunNotFoundError(runId);
  const terminal = events.find((e) => e.result !== undefined)?.result;
  return {
    runId,
    job: run.job,
    state: run.state,
    events,
    nextIndex: fromIndex + events.length,
    ...(terminal ? { terminal } : {}),
    ...(run.runRecord ? { runRecord: run.runRecord } : {}),
    ...(run.report ? { report: run.report } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}
