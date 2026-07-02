% The derivation lineage descending from an ancestor invention.
%
% Every invention that descends from a root — the transitive closure of the
% derived_from/2 edge (the typed view the exporter emits for the registered
% DERIVED_FROM :TYPE; see docs/datalog.md and registry.py). DERIVED_FROM points
% derivative -> ancestor and chains, so this file defines a local
% descendant_depth/3 that walks it from each descendant toward the root, tagging
% each with its depth (generations below the root) to give a breadth-first view of
% the lineage tree. It needs only the base facts from graph.pl (the --rules
% library is optional). This mirrors cypher/invention-lineage.cypher.
%
% Interactive form (after `swipl graph.pl` and consulting this file):
%   ?- descendant_depth('cs:invention:telephone', Descendant, Depth).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/invention-lineage.pl
%
% Expected output (csid and depth, tab-separated, any order):
%   cs:invention:mobile-phone<TAB>1
%   cs:invention:smartphone<TAB>2

main :-
    forall(
        descendant_depth('cs:invention:telephone', Descendant, Depth),
        (   atomic_list_concat([Descendant, Depth], '\t', Row),
            format("~w~n", [Row])
        )
    ).

% descendant_depth(Root, Descendant, Depth): Descendant derives from Root in
% Depth generations, following derived_from/2 (derivative -> ancestor) upward.
descendant_depth(Root, Descendant, 1) :-
    derived_from(Descendant, Root).
descendant_depth(Root, Descendant, Depth) :-
    derived_from(Descendant, Intermediate),
    descendant_depth(Root, Intermediate, Inner),
    Depth is Inner + 1.
