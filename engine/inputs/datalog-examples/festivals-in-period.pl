% Festivals and living traditions belonging to a named period.
%
% Every practice that shares a calendrical slot — the entities joined to a
% Period by a part_of_period/2 edge (the typed view the exporter emits for the
% registered PART_OF_PERIOD :TYPE; see docs/datalog.md and registry.py). The edge
% runs practice -> period, so the period csid is the second argument and the first
% is left open to enumerate its members. PART_OF_PERIOD is neither symmetric nor
% transitive, so a single direct hop is the whole answer; no --rules library is
% needed. This mirrors cypher/festivals-in-period.cypher.
%
% Interactive form (after `swipl graph.pl`):
%   ?- part_of_period(Practice, 'cs:period:spring').
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/festivals-in-period.pl
%
% Expected output (one csid per line, any order):
%   cs:festival:holi
%   cs:festival:hanami

main :-
    forall(
        part_of_period(Practice, 'cs:period:spring'),
        format("~w~n", [Practice])
    ).
