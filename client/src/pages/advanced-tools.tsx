import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Play, FlaskConical, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GraphFeatureGate } from "@/components/graph/GraphFeatureGate";
import {
  DATALOG_PRESETS,
  CYPHER_PRESETS,
  datalogToTable,
  cypherToTable,
  type ConsolePreset,
  type ConsoleTable,
  type DatalogResult,
  type CypherResult,
} from "@/lib/graph/research-console";

/**
 * Advanced research console (US-011): a minimal editor for read-only Datalog and
 * Cypher queries against the shared culture-scrape graph, via the first-party
 * `POST /api/graph/datalog` and `POST /api/graph/cypher` proxy routes.
 *
 * This is an intentionally experimental, advanced surface — it is NOT linked from
 * the primary navigation (reachable only at `/advanced-tools`). The whole tool is
 * gated on sidecar availability (US-005) and every query is read-only: the server
 * rejects write clauses, and the UI states as much.
 */

/** Issue a console POST and surface the server's structured error, not swallow it. */
async function runConsoleQuery<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body — fall through to the status message */
  }
  if (!res.ok) {
    const msg =
      data?.detail || data?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data as T;
}

function PresetBar({
  presets,
  onPick,
}: {
  presets: ConsolePreset[];
  onPick: (query: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="console-presets">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          title={preset.description}
          onClick={() => onPick(preset.query)}
          data-testid={`preset-${preset.label}`}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

function ResultsTable({ table }: { table: ConsoleTable }) {
  if (table.rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4" data-testid="console-empty">
        No rows returned.
      </p>
    );
  }
  return (
    <div className="max-h-[360px] overflow-auto rounded-md border">
      <Table data-testid="console-results">
        <TableHeader>
          <TableRow>
            {table.columns.map((col, i) => (
              <TableHead key={i}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, r) => (
            <TableRow key={r}>
              {table.columns.map((_, c) => (
                <TableCell key={c} className="font-mono text-xs">
                  {row[c] ?? ""}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300"
      data-testid="console-error"
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="font-mono text-xs break-all">{message}</span>
    </div>
  );
}

/** One query panel (Datalog or Cypher) with editor, presets, and results. */
function ConsolePanel({
  kind,
  presets,
  placeholder,
}: {
  kind: "datalog" | "cypher";
  presets: ConsolePreset[];
  placeholder: string;
}) {
  const [query, setQuery] = useState(presets[0]?.query ?? "");

  const mutation = useMutation<DatalogResult | CypherResult, Error, string>({
    mutationFn: (q: string) =>
      kind === "datalog"
        ? runConsoleQuery<DatalogResult>("/api/graph/datalog", { goal: q })
        : runConsoleQuery<CypherResult>("/api/graph/cypher", { query: q }),
  });

  const data = mutation.data;
  const table: ConsoleTable | null = data
    ? kind === "datalog"
      ? datalogToTable(data as DatalogResult)
      : cypherToTable(data as CypherResult)
    : null;
  // A Datalog run can succeed at the HTTP level yet not actually run (e.g. swipl
  // absent) — surface that reason/error/problems rather than a blank table.
  const datalog = kind === "datalog" ? (data as DatalogResult | undefined) : undefined;

  return (
    <div className="space-y-3">
      <PresetBar presets={presets} onPick={setQuery} />
      <Textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        rows={8}
        className="font-mono text-xs"
        data-testid={`console-editor-${kind}`}
      />
      <div className="flex items-center gap-3">
        <GraphFeatureGate backend="sidecar">
          <Button
            onClick={() => mutation.mutate(query)}
            disabled={mutation.isPending || !query.trim()}
            data-testid={`console-run-${kind}`}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run query
          </Button>
        </GraphFeatureGate>
        <span className="text-xs text-gray-500">Read-only · {kind}</span>
      </div>

      {mutation.isError && (
        <ErrorNotice message={(mutation.error as Error).message} />
      )}

      {datalog && !datalog.ran && (datalog.reason || datalog.error) && (
        <ErrorNotice message={datalog.error ?? datalog.reason ?? "Query did not run."} />
      )}
      {datalog && datalog.problems.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-400" data-testid="console-problems">
          {datalog.problems.map((p, i) => (
            <div key={i}>⚠ {p}</div>
          ))}
        </div>
      )}

      {table && <ResultsTable table={table} />}
    </div>
  );
}

export default function AdvancedToolsPage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6" data-testid="advanced-tools-page">
      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FlaskConical className="h-5 w-5 text-purple-600" />
          <h1 className="text-xl font-semibold">Graph research console</h1>
          <Badge variant="outline" className="text-amber-700 border-amber-400">
            Experimental · Advanced
          </Badge>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Run inference queries against the shared culture-scrape graph — for
          example, which cultures are <code>contemporary_with</code> an event, or the
          full <code>descends_from</code> ancestry of a language. Datalog runs over
          culture-scrape's rule set; Cypher runs against Neo4j.
        </p>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          All queries are <strong>read-only</strong>; write clauses are rejected by
          the server.
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Query editor</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="datalog">
            <TabsList>
              <TabsTrigger value="datalog" data-testid="tab-datalog">
                Datalog
              </TabsTrigger>
              <TabsTrigger value="cypher" data-testid="tab-cypher">
                Cypher
              </TabsTrigger>
            </TabsList>
            <TabsContent value="datalog" className="mt-4">
              <ConsolePanel
                kind="datalog"
                presets={DATALOG_PRESETS}
                placeholder="main :- ancestor('cs:language:gaulish', A), format(&quot;~w~n&quot;, [A])."
              />
            </TabsContent>
            <TabsContent value="cypher" className="mt-4">
              <ConsolePanel
                kind="cypher"
                presets={CYPHER_PRESETS}
                placeholder="MATCH (n:Language) RETURN n.name LIMIT 25"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
