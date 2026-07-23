// Smoke query: relationship counts by :TYPE.
// Tallies every relationship by its type across the whole graph, highest count
// first. Compare each tally against the corpus manifest's edges_by_type to prove
// the load carried every edge type end to end.
MATCH ()-[r]->()
RETURN type(r) AS type, count(*) AS count
ORDER BY count DESC, type;
