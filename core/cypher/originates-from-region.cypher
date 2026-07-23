// Everything that originates from a given region.
//
// Inputs:  $region_csid — the csid of the origin Place node (a region or
//          culture of origin, e.g. 'cs:place:andes').
// Returns: one row per originating Entity — its `csid` and `name` plus the
//          `region` name — for every Entity with an ORIGINATES_FROM edge into
//          the region, ordered by name. Empty if nothing originates from it.
MATCH (origin:Entity)-[:ORIGINATES_FROM]->(region:Place {csid: $region_csid})
RETURN origin.csid AS csid, origin.name AS name, region.name AS region
ORDER BY origin.name;
