/**
 * Personal-tier gating for the shared-graph proxy (analyzer-bridge US-004).
 *
 * The Analyzer bridge can ingest a user's own files into the graph as a **personal
 * tier**: content-addressed `asset` nodes (`:LABEL` `Asset`, `source=analyzer`) plus
 * their grounding edges. The privacy invariant (the Analyzer bridge spec §6) is that
 * personal-tier facts are **local-only** — they must never surface through the
 * proxy the browser talks to unless the operator has explicitly opted in.
 *
 * So the graph proxy filters personal nodes out of every result **by default**,
 * and surfaces them only when the `PERSONAL_TIER_ENABLED` flag is set — the same
 * feature-flag-off-by-default posture as the correlation-graph migration
 * (`cross-domain-correlation-graph.ts`). Gating is post-projection and pure, so a
 * corpus that has never ingested a personal file is unaffected (no such node
 * exists to drop).
 */

/** The `source` provenance token that marks a personal-tier record (`analyzer`). */
export const PERSONAL_SOURCE = "analyzer";

/** The distinct node `:LABEL` every personal media asset carries. */
export const ASSET_LABEL = "Asset";

/** The minimal node shape the personal predicate reads (labels + provenance). */
export interface TierGatedNode {
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * Whether the graph proxy may surface personal-tier (Analyzer) nodes. Opt-in via
 * `PERSONAL_TIER_ENABLED` (true/1/yes/on); **off by default**, so personal media
 * facts stay local-only out of the box (the privacy invariant). Mirrors
 * `isGraphCorrelationEnabled`'s env-flag shape.
 */
export function isPersonalTierEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.PERSONAL_TIER_ENABLED;
  return Boolean(raw && /^(true|1|yes|on)$/i.test(raw.trim()));
}

/** The `source` provenance tokens on a node (`"pinakes;analyzer"` → both). */
function sourceTokens(properties: Record<string, unknown>): string[] {
  const source = properties.source;
  if (typeof source !== "string") return [];
  return source
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Whether a node is personal-tier: it carries the `Asset` label **or** any
 * `source=analyzer` provenance token (a grounded record may merge sources, so a
 * single `analyzer` token is enough — mirrors the Python `is_personal_source`).
 */
export function isPersonalNode(node: TierGatedNode): boolean {
  if (node.labels.includes(ASSET_LABEL)) return true;
  return sourceTokens(node.properties).includes(PERSONAL_SOURCE);
}

/**
 * Drop personal-tier nodes unless the tier is *enabled*. A no-op when *enabled*
 * (the operator opted in) or when the set holds no personal node (the common
 * case — nothing to contain).
 */
export function filterPersonalNodes<T extends TierGatedNode>(
  nodes: T[],
  enabled: boolean,
): T[] {
  if (enabled) return nodes;
  return nodes.filter((node) => !isPersonalNode(node));
}
