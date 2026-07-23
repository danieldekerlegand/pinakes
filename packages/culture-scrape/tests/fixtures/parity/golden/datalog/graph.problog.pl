% culture-scrape — ProbLog probabilistic fact base
% ================================================
% Auto-generated from the canonical TSV graph (docs/data-model.md); a derived,
% mechanical projection — do not edit by hand.
%
% ProbLog dialect (https://dtai.cs.kuleuven.be/problog/): Prolog syntax with
% annotated facts. An edge's confidence becomes the fact's probability:
%   0.8::located_in('cs:dish:Q42', 'cs:place:Q123').
% A confidence of 1.0 (or none) is a certain fact, written unannotated. Node,
% dimension and provenance facts are certain. The shared Horn inference rules
% (--rules) are ProbLog-compatible verbatim.
%
% Predicate schema (see graph.pl's header for the full vocabulary):
%   node(Csid, Type, Name)        entity: csid, primary label, display name
%   instance_of(Csid, Label)      one per label
%   <dimension>(Csid, Value)      time_start/2, language_code/2, derived_from/2, ...
%   W::rel(Type, A, B)            generic edge, W = confidence (omitted when 1.0)
%   W::<type>(A, B)               typed edge, one binary predicate per :TYPE
%   rel_conf(Type, A, B, W)       queryable confidence companion (certain)
%   rel_source(Type, A, B, Src)   queryable provenance companion (certain)
%
% Query: add e.g. `query(within_region('cs:dish:Q42', X)).`, then run
%        `problog this_file.problog.pl` (pip install problog).

node('cs:dish:Q207965', 'CulturalArtifact', 'Ceviche').  % source: wikidata
instance_of('cs:dish:Q207965', 'CulturalArtifact').  % source: wikidata
instance_of('cs:dish:Q207965', 'Dish').  % source: wikidata
source('cs:dish:Q207965', wikidata).  % source: wikidata
located_at('cs:dish:Q207965', -12.0464, -77.0428).  % source: wikidata
time_start('cs:dish:Q207965', 1500).  % source: wikidata
place_qid('cs:dish:Q207965', 'Q2634').  % source: wikidata
language_code('cs:dish:Q207965', spa).  % source: wikidata
node('cs:language:Q5218', 'Language', 'Quechua').  % source: glottolog
instance_of('cs:language:Q5218', 'Language').  % source: glottolog
source('cs:language:Q5218', glottolog).  % source: glottolog
language_code('cs:language:Q5218', que).  % source: glottolog
script('cs:language:Q5218', 'Latn').  % source: glottolog
etymology('cs:language:Q5218', '*qhichwa ‘temperate valley’').  % source: glottolog
derived_from('cs:language:Q5218', 'cs:language:Q5218').  % source: glottolog
node('cs:place:Q2634', 'Place', 'Lima').
instance_of('cs:place:Q2634', 'Place').
located_at('cs:place:Q2634', -12.0464, -77.0428).
time_end('cs:place:Q2634', -1).
tgn_id('cs:place:Q2634', '7005812').
0.33::rel(derived_from, 'cs:dish:Q207965', 'cs:language:Q5218').
0.33::derived_from('cs:dish:Q207965', 'cs:language:Q5218').
rel_conf(derived_from, 'cs:dish:Q207965', 'cs:language:Q5218', 0.33).
0.8::rel(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634').  % source: wikidata
0.8::originates_in('cs:dish:Q207965', 'cs:place:Q2634').  % source: wikidata
rel_conf(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634', 0.8).  % source: wikidata
rel_source(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634', wikidata).  % source: wikidata
rel(originates_in, 'cs:place:Q2634', 'cs:language:Q5218').
originates_in('cs:place:Q2634', 'cs:language:Q5218').
