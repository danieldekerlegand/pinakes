% The variant family of a given game.
%
% Every game in the same family as a focus game — the entities joined to it by a
% variant_of/2 edge (the typed view the exporter emits for the registered
% VARIANT_OF :TYPE; see docs/datalog.md and registry.py). VARIANT_OF is symmetric
% but not transitive: the source records each variant edge in one direction only,
% so this file defines a local variant/2 that adds the mirror, letting a query
% from the canonical form reach its whole recorded family. It needs only the base
% facts from graph.pl (the --rules library is optional). This mirrors
% cypher/game-family-variants.cypher.
%
% Interactive form (after `swipl graph.pl` and consulting this file):
%   ?- variant('cs:game:chess', Variant).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/game-family-variants.pl
%
% Expected output (one csid per line, any order):
%   cs:game:shogi
%   cs:game:xiangqi

main :-
    forall(
        variant('cs:game:chess', Variant),
        format("~w~n", [Variant])
    ).

% variant/2 is the symmetric closure of the one-directional variant_of/2 edge.
variant(X, Y) :- variant_of(X, Y).
variant(X, Y) :- variant_of(Y, X).
