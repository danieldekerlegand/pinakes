% The materials a given artifact is composed of.
%
% Every constituent material of an artifact — the materials it reaches by a
% made_of/2 edge (the typed view the exporter emits for the registered MADE_OF
% :TYPE; see docs/datalog.md and registry.py). MADE_OF runs artifact -> material
% (a Getty AAT substance) and is neither symmetric nor transitive, so a single
% direct hop from the artifact is the whole composition; no --rules library is
% needed. This mirrors cypher/material-composition.cypher.
%
% Interactive form (after `swipl graph.pl`):
%   ?- made_of('cs:clothing:kimono', Material).
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/material-composition.pl
%
% Expected output (one csid per line, any order):
%   cs:material:silk
%   cs:material:cotton

main :-
    forall(
        made_of('cs:clothing:kimono', Material),
        format("~w~n", [Material])
    ).
