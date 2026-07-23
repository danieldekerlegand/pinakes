// The derivation lineage descending from an ancestor invention.
//
// Inputs:  $root_csid — the csid of the ancestor Entity at the head of the
//          lineage (e.g. 'cs:invention:telephone').
// Returns: one row per descendant invention — its `csid`, `name`, and `depth`
//          (generations below the root) — for every Entity reachable by
//          following DERIVED_FROM edges up to the root. DERIVED_FROM points
//          derivative -> ancestor and chains transitively, so the
//          variable-length pattern traverses it from each descendant toward the
//          root, yielding the whole invention-lineage tree. Ordered by depth
//          then name, a breadth-first view of the lineage. Empty if the root
//          has no descendants.
MATCH path = (descendant:Entity)-[:DERIVED_FROM*1..]->(root:Entity {csid: $root_csid})
RETURN descendant.csid AS csid, descendant.name AS name,
       length(path) AS depth
ORDER BY depth, descendant.name;
