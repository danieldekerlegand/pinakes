% The entities a given source contributed, by provenance.
%
% Every entity whose row came from a named acquisition source — joining the
% queryable provenance fact source/2 (keyed by csid; the machine-readable form of
% the trailing `% source:` comment) to node/3 for the display name. This is what
% makes provenance a first-class query target: `source(C, pinakes)` selects
% the csids a source contributed, and node/3 names them. Provenance is neither
% symmetric nor transitive, so a single direct lookup is the whole answer; no
% --rules library is needed. The sibling rel_source/4 does the same for edges.
%
% Interactive form (after `swipl graph.pl`):
%   ?- source(Csid, pinakes), node(Csid, _, Name).
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/entities-by-source.pl
%
% Expected output (one `csid<TAB>name` per line, any order):
%   cs:haplogroup:r1b       Haplogroup R1b
%   cs:language:pie Proto-Indo-European
%   cs:language:proto-celtic        Proto-Celtic
%   cs:language:gaulish     Gaulish
%   cs:place:western-europe Western Europe
%   cs:event:la-tene        La Tène culture

main :-
    forall(
        ( source(Csid, pinakes), node(Csid, _, Name) ),
        format("~w\t~w~n", [Csid, Name])
    ).
