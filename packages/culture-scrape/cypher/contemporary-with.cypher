// All entities contemporary with a given entity.
//
// Inputs:  $csid — the csid of the focus Entity (e.g. 'cs:person:pachacuti').
// Returns: one row per contemporary — `csid`, `name`, `time_start`, `time_end`
//          — for every Entity joined to the focus by a CONTEMPORARY_WITH edge
//          (a symmetric, non-transitive temporal overlap, so direction does not
//          matter), ordered earliest-first. Empty if the focus has no recorded
//          contemporaries.
MATCH (focus:Entity {csid: $csid})-[:CONTEMPORARY_WITH]-(other:Entity)
RETURN other.csid AS csid, other.name AS name,
       other.time_start AS time_start, other.time_end AS time_end
ORDER BY other.time_start;
