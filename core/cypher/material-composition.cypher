// The materials a given artifact is composed of.
//
// Inputs:  $csid — the csid of the artifact Entity (e.g.
//          'cs:clothing:kimono').
// Returns: one row per constituent material — its `csid` and `name` — for every
//          Material the artifact reaches by a MADE_OF edge. MADE_OF runs
//          artifact -> material (a Getty AAT substance), so the pattern is a
//          single outgoing hop, ordered by material name. Empty if the
//          artifact has no recorded composition.
MATCH (artifact:Entity {csid: $csid})-[:MADE_OF]->(material:Material)
RETURN material.csid AS csid, material.name AS name
ORDER BY material.name;
