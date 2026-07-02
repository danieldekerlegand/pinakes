% Full ancestry of a dish.
%
% Every cultural forebear of a dish — the transitive closure of derivation and
% influence, computed by the influenced_transitively/2 rule (see docs/datalog.md
% and src/culturescrape/datalog/rules.py). Load this file alongside a graph.pl
% that was generated with --rules, then run main/0.
%
% Interactive form (after `swipl graph.pl`):
%   ?- influenced_transitively('cs:dish:nikkei-ceviche', Ancestor).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/ancestry-of-dish.pl
%
% Expected output (one csid per line, any order):
%   cs:dish:tiradito
%   cs:dish:ceviche
%   cs:dish:kinilaw

main :-
    forall(
        influenced_transitively('cs:dish:nikkei-ceviche', Ancestor),
        format("~w~n", [Ancestor])
    ).
