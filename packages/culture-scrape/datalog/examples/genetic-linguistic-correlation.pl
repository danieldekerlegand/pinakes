% Genetic–linguistic correlation of a haplogroup.
%
% Every language a haplogroup correlates with — the genetic_linguistic_correlation/2
% rule pairs a haplogroup that originates_from a region with each language spoken_in
% that same region (see docs/datalog.md and src/culturescrape/datalog/rules.py).
% This is the symbolic core of LinguaScrape's genetic–linguistic correlation ported
% into logic; the numeric overlap score stays a CPU-domain computation in the
% TypeScript engine. The facts here are LinguaScrape-origin (source: linguascrape),
% linked through the merged graph. Load alongside a graph.pl built with --rules.
%
% Interactive form (after `swipl graph.pl`):
%   ?- genetic_linguistic_correlation('cs:haplogroup:r1b', Language).
%
% Run on the bundled example dataset:
%   culturescrape to-datalog datalog/examples/dataset \
%       --engine swipl --rules --out /tmp/eg
%   swipl -q -g main -t halt /tmp/eg/graph.pl \
%       datalog/examples/genetic-linguistic-correlation.pl
%
% Expected output (one csid per line, any order):
%   cs:language:proto-celtic
%   cs:language:gaulish

main :-
    forall(
        genetic_linguistic_correlation('cs:haplogroup:r1b', Language),
        format("~w~n", [Language])
    ).
