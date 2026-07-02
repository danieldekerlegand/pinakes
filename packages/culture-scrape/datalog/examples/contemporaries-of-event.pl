% Contemporaries of an event.
%
% Everything that overlaps an event in time — the symmetric closure of the
% contemporary_with edge, computed by the contemporary/2 rule. Because the rule
% mirrors the stored edge, a contemporary is returned even when the edge was
% recorded from the other endpoint. Load alongside a graph.pl built with --rules.
%
% Interactive form (after `swipl graph.pl`):
%   ?- contemporary('cs:event:inca-expansion', Other).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/contemporaries-of-event.pl
%
% Expected output (one csid per line, any order):
%   cs:event:columbian-exchange
%   cs:dish:ceviche

main :-
    forall(
        contemporary('cs:event:inca-expansion', Other),
        format("~w~n", [Other])
    ).
