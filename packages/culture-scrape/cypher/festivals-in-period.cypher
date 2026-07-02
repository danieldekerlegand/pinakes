// Every festival or living tradition belonging to a named period.
//
// Inputs:  $period_csid — the csid of the Period node (a season or named
//          calendar period, e.g. 'cs:period:spring').
// Returns: one row per practice — its `csid` and `name` — for every Entity with
//          a PART_OF_PERIOD edge into the period, ordered by name. PART_OF_PERIOD
//          runs practice -> period, so the pattern is a single outgoing hop;
//          the rows are the festivals and traditions that share that calendrical
//          slot. Empty if nothing is recorded for the period.
MATCH (practice:Entity)-[:PART_OF_PERIOD]->(period:Period {csid: $period_csid})
RETURN practice.csid AS csid, practice.name AS name
ORDER BY practice.name;
