// Shortest cultural path between two entities.
//
// Inputs:  $start_csid, $end_csid — the csid primary keys of the two Entity
//          nodes to connect (e.g. 'cs:dish:ceviche' and 'cs:dish:kinilaw').
// Returns: a single row — `path` (the shortest chain of cultural-lineage edges
//          joining them) and `hops` (its length in edges) — or no rows if the
//          two entities are not connected within the hop bound. The path
//          traverses only cultural-derivation edges, in either direction, so a
//          shared ancestor or mutual influence still links them.
MATCH (start:Entity {csid: $start_csid}), (end:Entity {csid: $end_csid})
MATCH path = shortestPath(
  (start)-[:DERIVED_FROM|INFLUENCED_BY|VARIANT_OF|BORROWED_FROM|COGNATE_WITH*..15]-(end)
)
RETURN path, length(path) AS hops;
