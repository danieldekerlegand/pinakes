% All entities within a region, transitively.
%
% Every entity contained in a region through any chain of located_in/2 edges —
% the transitive closure computed by the within_region/2 rule. The region csid
% is the second argument; the first is left open so the query enumerates the
% region's members. Load alongside a graph.pl generated with --rules.
%
% Interactive form (after `swipl graph.pl`):
%   ?- within_region(Entity, 'cs:place:peru').
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/entities-within-region.pl
%
% Expected output (one csid per line, any order):
%   cs:place:lima
%   cs:dish:ceviche
%   cs:dish:tiradito

main :-
    forall(
        within_region(Entity, 'cs:place:peru'),
        format("~w~n", [Entity])
    ).
