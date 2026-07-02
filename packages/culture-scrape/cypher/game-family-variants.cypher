// The variant family of a given game.
//
// Inputs:  $csid — the csid of the focus Entity (e.g. 'cs:game:chess').
// Returns: one row per variant — `csid` and `name` — for every Entity joined to
//          the focus by a VARIANT_OF edge. VARIANT_OF is symmetric (a variant
//          relation reads the same in both directions) but not transitive, so
//          the pattern is a single undirected hop: querying a canonical form
//          returns its whole family of recorded variants, ordered by name.
//          Empty if the focus has no recorded variants.
MATCH (focus:Entity {csid: $csid})-[:VARIANT_OF]-(variant:Entity)
RETURN variant.csid AS csid, variant.name AS name
ORDER BY variant.name;
