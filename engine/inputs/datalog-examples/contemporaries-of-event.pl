% Contemporaries of an event.
%
% Everything that overlaps an event in time, computed by the contemporary/2 rule.
% The rule derives overlap arithmetically from the time_start/time_end bounds
% (time_end(X) >= time_start(Y) both ways) and also honours any explicitly
% authored contemporary_with edge, so a contemporary is returned whether it was
% dated or asserted, and from either endpoint. contemporary/2 is reflexive (a span
% overlaps itself), so the query filters the event out of its own answers. Load
% alongside a graph.pl built with --rules.
%
% Interactive form (after `swipl graph.pl`):
%   ?- contemporary('cs:event:inca-expansion', Other), Other \== 'cs:event:inca-expansion'.
%
% Run on the bundled example dataset:
%   pinakes_engine to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/contemporaries-of-event.pl
%
% Expected output (one csid per line, any order):
%   cs:event:columbian-exchange
%   cs:dish:ceviche

main :-
    forall(
        ( contemporary('cs:event:inca-expansion', Other),
          Other \== 'cs:event:inca-expansion' ),
        format("~w~n", [Other])
    ).
