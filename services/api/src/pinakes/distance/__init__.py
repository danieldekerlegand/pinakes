"""Linguistic distance — how far apart two languages are, on three axes.

The port of `server/services/linguistic-distance-calculator.ts`,
`linguistic-distance-enhanced.ts` and `phonetic-features.ts`, which
`routers/linguistic_distance.py` is the adapter over.

* :mod:`~pinakes.distance.calculator` — ASJP/LDND over word forms, plus the
  genealogical and geographic gaps the pairwise route reports beside it.
* :mod:`~pinakes.distance.enhanced` — phoneme inventories and typological
  profiles, and the weighted blend of all three dimensions.
* :mod:`~pinakes.distance.phonetic` — articulatory substitution costs, reached
  only by `phoneticMode: "ipa-weighted"`.
* :mod:`~pinakes.distance.utf16` — the code-unit semantics every edit distance
  in here indexes by.
"""
