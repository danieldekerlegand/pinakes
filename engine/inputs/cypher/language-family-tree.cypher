// The descent tree rooted at a language family.
//
// Inputs:  $root_csid — the csid of the ancestor Language at the root of the
//          family (e.g. 'cs:language:proto-quechua').
// Returns: one row per descendant Language — its `csid`, `name`, and `depth`
//          (generations below the root) — for every Language reachable by
//          following DESCENDS_FROM edges up to the root. DESCENDS_FROM points
//          child -> parent, so the variable-length pattern traverses it from
//          each descendant toward the root. Ordered by depth then name, giving
//          a breadth-first view of the family. Empty if the root has no
//          descendants.
MATCH path = (descendant:Language)-[:DESCENDS_FROM*1..]->(root:Language {csid: $root_csid})
RETURN descendant.csid AS csid, descendant.name AS name,
       length(path) AS depth
ORDER BY depth, descendant.name;
