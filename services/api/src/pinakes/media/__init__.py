"""Media assets and generated reconstruction imagery.

Two `server/services/*.ts` files land here: `media-asset-service.ts` (the
validated CRUD over `media-assets.tsv`) as :mod:`pinakes.media.assets`, and
`image-generator.ts` (the Gemini reconstruction prompt + its prompt ledger) as
:mod:`pinakes.media.images`. Both are reached only by `routers/media.py`.
"""
