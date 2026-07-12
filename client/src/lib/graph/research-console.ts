/**
 * Pure helpers for the Datalog/Cypher research console (US-011).
 *
 * The console is an advanced, experimental surface: it lets a researcher run
 * read-only inference queries against the shared culture-scrape graph through the
 * first-party `POST /api/graph/datalog` and `POST /api/graph/cypher` proxy routes.
 * This module holds the shipped example presets and the normalisation of each
 * endpoint's response into a single `{ columns, rows }` table shape, so the page
 * component stays a thin renderer and the logic is unit-testable (the repo has no
 * jsdom — see the neighborhood-graph precedent).
 */

/** A ready-to-run example query shown as a clickable preset in the console. */
export interface ConsolePreset {
  /** Short label for the preset button. */
  label: string;
  /** One-line description of what the query answers. */
  description: string;
  /** The query text loaded into the editor when the preset is chosen. */
  query: string;
}

/**
 * Datalog presets — ad-hoc `main/0` goals over the inference rules culture-scrape
 * ships (see packages/culture-scrape/datalog/examples). The csids are drawn from
 * the bundled example dataset so the presets are runnable, not just illustrative.
 */
export const DATALOG_PRESETS: ConsolePreset[] = [
  {
    label: "contemporary_with/2",
    description:
      "Everything contemporary with an event — derived on demand by the " +
      "contemporary/2 rule from the time_start/time_end bounds (the pairwise " +
      "CONTEMPORARY_WITH edge is no longer stored). Reflexive, so the query " +
      "filters the event itself out.",
    query: `main :-
    forall(
        ( contemporary('cs:event:inca-expansion', Other),
          Other \\== 'cs:event:inca-expansion' ),
        format("~w~n", [Other])
    ).`,
  },
  {
    label: "precedes/2",
    description:
      "Everything an event strictly precedes — derived on demand by the " +
      "precedes/2 rule (time_end(X) < time_start(Y)); no stored PRECEDES edge.",
    query: `main :-
    forall(
        precedes('cs:event:inca-expansion', Later),
        format("~w~n", [Later])
    ).`,
  },
  {
    label: "same_region/2",
    description: "All entities within a region, transitively (within_region/2).",
    query: `main :-
    forall(
        within_region(Entity, 'cs:place:peru'),
        format("~w~n", [Entity])
    ).`,
  },
  {
    label: "descends_from (transitive)",
    description: "Full ancestry of a language via ancestor/2 over descends_from.",
    query: `main :-
    forall(
        ancestor('cs:language:gaulish', Ancestor),
        format("~w~n", [Ancestor])
    ).`,
  },
];

/** Cypher presets — read-only `MATCH … RETURN … LIMIT` reads over the graph. */
export const CYPHER_PRESETS: ConsolePreset[] = [
  {
    label: "descends_from edges",
    description: "Descendant → ancestor pairs across the shared graph.",
    query: `MATCH (n)-[:DESCENDS_FROM]->(m)
RETURN n.name AS descendant, m.name AS ancestor
LIMIT 25`,
  },
  {
    label: "languages",
    description: "Sample of language nodes with their csid.",
    query: `MATCH (n:Language)
RETURN n.csid AS csid, n.name AS name
LIMIT 25`,
  },
];

/** A normalised tabular result: named columns and stringified rows. */
export interface ConsoleTable {
  columns: string[];
  rows: string[][];
}

/** Response shape of `POST /api/graph/datalog` (mirrors DatalogResponse). */
export interface DatalogResult {
  ran: boolean;
  rows: string[][];
  problems: string[];
  error: string | null;
  reason: string | null;
}

/** Response shape of `POST /api/graph/cypher` (mirrors CypherResponse). */
export interface CypherResult {
  columns: string[];
  rows: string[][];
}

/**
 * Normalise a Datalog outcome into a table. Datalog answer rows are unnamed
 * tuples, so the columns are synthesised: a single-column answer is labelled
 * `Result`, a wider answer `Column 1..N` (from the widest row).
 */
export function datalogToTable(result: DatalogResult): ConsoleTable {
  const width = result.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns =
    width <= 1
      ? ["Result"]
      : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return { columns, rows: result.rows };
}

/** Normalise a Cypher result into a table (its columns are already named). */
export function cypherToTable(result: CypherResult): ConsoleTable {
  return { columns: result.columns, rows: result.rows };
}
