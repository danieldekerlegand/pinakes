% culture-scrape — SWI-Prolog fact base
% =====================================
% Auto-generated from the canonical TSV graph (docs/data-model.md); a derived,
% mechanical projection — do not edit by hand.
%
% Predicate schema
% ----------------
%   node(Csid, Type, Name)        entity: csid, primary :LABEL, display name
%   instance_of(Csid, Label)      one per :LABEL (a multi-label node repeats)
%   located_at(Csid, Lat, Lon)    geographic coordinate (floats)
%   <dimension>(Csid, Value)      binary dimension facts, e.g. time_start/2,
%                                 time_end/2, part_of_period/2, language_code/2,
%                                 derived_from/2, ...
%   rel(Type, A, B)               generic edge: type atom + endpoint csids
%   <type>(A, B)                  typed edge, one binary predicate per :TYPE
%                                 (e.g. located_in/2, adjacent_to/2)
%   rel_conf(Type, A, B, Weight)  optional edge weight/confidence (float)
%
% Csids are carried verbatim as single-quoted atoms ('cs:dish:Q42'); the same
% csid always renders to the same atom, so the mapping is reversible.
%
% Load:  swipl this_file.pl
% Query: ?- node(X, 'Dish', Name).


:- discontiguous derived_from/2.
:- discontiguous etymology/2.
:- discontiguous instance_of/2.
:- discontiguous language_code/2.
:- discontiguous located_at/3.
:- discontiguous node/3.
:- discontiguous originates_in/2.
:- discontiguous place_qid/2.
:- discontiguous rel/3.
:- discontiguous rel_conf/4.
:- discontiguous rel_source/4.
:- discontiguous script/2.
:- discontiguous source/2.
:- discontiguous tgn_id/2.
:- discontiguous time_end/2.
:- discontiguous time_start/2.

:- dynamic derived_from/2.
:- dynamic etymology/2.
:- dynamic instance_of/2.
:- dynamic language_code/2.
:- dynamic located_at/3.
:- dynamic node/3.
:- dynamic originates_in/2.
:- dynamic place_qid/2.
:- dynamic rel/3.
:- dynamic rel_conf/4.
:- dynamic rel_source/4.
:- dynamic script/2.
:- dynamic source/2.
:- dynamic tgn_id/2.
:- dynamic time_end/2.
:- dynamic time_start/2.

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
rel(derived_from, 'cs:dish:Q207965', 'cs:language:Q5218').
derived_from('cs:dish:Q207965', 'cs:language:Q5218').
rel_conf(derived_from, 'cs:dish:Q207965', 'cs:language:Q5218', 0.33).
rel(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634').  % source: wikidata
originates_in('cs:dish:Q207965', 'cs:place:Q2634').  % source: wikidata
rel_conf(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634', 0.8).  % source: wikidata
rel_source(originates_in, 'cs:dish:Q207965', 'cs:place:Q2634', wikidata).  % source: wikidata
rel(originates_in, 'cs:place:Q2634', 'cs:language:Q5218').
originates_in('cs:place:Q2634', 'cs:language:Q5218').
