// Smoke query: node counts by label.
// Tallies every node under each label it carries, highest count first. Because
// every node also carries the shared Entity anchor, the Entity row equals the
// total node count -- compare it (and each label's tally) against the corpus
// manifest's nodes_by_label to prove the load is complete.
MATCH (n)
UNWIND labels(n) AS label
RETURN label, count(*) AS count
ORDER BY count DESC, label;
