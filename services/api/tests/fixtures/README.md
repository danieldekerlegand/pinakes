# `services/api/tests/fixtures/` — recorded upstream responses

Canned HTTP payloads the ingest tests replay instead of reaching the network:
Open Context / tDAR searches, a Wikipedia/Wikidata page, a Wikipedia extract.

They were recorded by the TypeScript suite and lived at
`server/services/fixtures/` until the cutover (`tasks/chief/80-cutover.json`
US-2) deleted `server/`. The Python tests had been reading them across that
boundary; they moved here rather than being re-recorded, so what the two
implementations were graded against stays the same bytes.

`place-resolver/` did **not** come across: `services/api/src/pinakes/search/places.py`
is tested against inline payloads, so those three files had no reader left.

Recorded, not synthesised — do not hand-edit one to make a test pass. Re-record
against the real endpoint or write the payload inline in the test.
