% Shortest influence chain between two artifacts.
%
% The fewest-step path from one artifact to another over cultural-lineage edges
% (derived_from/2 and influenced_by/2 combined). The closures in rules.py answer
% "is X a forebear of Y" but not "by what shortest route"; this query rebuilds
% the route by iterative deepening — generating candidate chains in increasing
% length and committing to the first that connects the endpoints. It defines its
% own helper predicates, so it only needs the base facts from graph.pl (the
% --rules library is optional here).
%
% Interactive form (after `swipl graph.pl` and consulting this file):
%   ?- shortest_influence_chain('cs:dish:nikkei-ceviche', 'cs:dish:ceviche', C).
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/shortest-influence-chain.pl
%
% Expected output (the chain, one csid per column, tab-separated):
%   cs:dish:nikkei-ceviche<TAB>cs:dish:tiradito<TAB>cs:dish:ceviche

main :-
    shortest_influence_chain(
        'cs:dish:nikkei-ceviche', 'cs:dish:ceviche', Chain
    ),
    atomic_list_concat(Chain, '\t', Row),
    format("~w~n", [Row]).

% A single lineage step: an artifact derived from or influenced by another.
influence_link(X, Y) :- derived_from(X, Y).
influence_link(X, Y) :- influenced_by(X, Y).

% length/2 enumerates chains of length 1, 2, 3, ...; the first that connects
% Start to End is therefore a shortest one, and the cut discards the rest.
shortest_influence_chain(Start, End, Chain) :-
    length(Chain, _),
    chain_path(Start, End, Chain),
    !.

chain_path(End, End, [End]).
chain_path(Node, End, [Node | Rest]) :-
    influence_link(Node, Next),
    chain_path(Next, End, Rest).
