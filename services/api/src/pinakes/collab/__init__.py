"""The collaborative runtime stores — what users add on top of the dataset.

The port of `server/services/{collections,annotations}.ts`
(docs/UNIFIED-PROJECT-PLAN.md §7). Each store is a JSON-per-record directory
under `data/runtime/`, and each is *soft-owned*: there is no auth anywhere in
this project, so a record belongs to an opaque owner id the client supplies and
persists per browser. That is the whole access model, and reproducing it exactly
matters more than improving it — the TypeScript server reads the same
directories during the cutover.

Same discipline as :mod:`pinakes.contributions`: plain arguments in, JSON-ready
dicts out, no FastAPI import below this line. The routers
(:mod:`pinakes.routers.collections`, :mod:`pinakes.routers.annotations`) are
adapters over it, and :mod:`pinakes.routers._owner` is the one place that knows
how an owner id is read off a request.

.. warning::

   **Do not add ``from __future__ import annotations`` to this file.** It binds
   the name ``annotations`` on *this package*, so ``from pinakes.collab import
   annotations`` hands back the ``__future__._Feature`` object instead of the
   submodule — and the failure lands at request time, as an ``AttributeError``
   on every annotation route. There is nothing here to annotate, so nothing is
   lost; every module below still uses it. ``test_the_annotations_submodule_is_
   not_shadowed`` is the guard.
"""
