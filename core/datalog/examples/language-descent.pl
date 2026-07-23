% Full ancestry of a language.
%
% Every ancestor of a language — the transitive closure of descends_from/2,
% computed by the ancestor/2 rule (see docs/datalog.md and
% src/culturescrape/datalog/rules.py). The descends_from edges here are
% pinakes-origin (source: pinakes), so this query demonstrates the base
% transitive closure running across the merged graph. Load this file alongside a
% graph.pl that was generated with --rules, then run main/0.
%
% Interactive form (after `swipl graph.pl`):
%   ?- ancestor('cs:language:gaulish', Ancestor).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/language-descent.pl
%
% Expected output (one csid per line, any order):
%   cs:language:proto-celtic
%   cs:language:pie

main :-
    forall(
        ancestor('cs:language:gaulish', Ancestor),
        format("~w~n", [Ancestor])
    ).
