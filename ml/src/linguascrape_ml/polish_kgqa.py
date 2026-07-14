"""OPTIONAL: Gemini-polish a KGQA split into a clearly-separated variant (US-003).

This pass is **never required for CI** and produces a **separate** dataset: it
rewrites only the natural-language *question* surface with Gemini, leaving the
answer, evidence, and provenance untouched (the derivation still justifies the
unchanged answer). The deterministic core dataset (``linguascrape-export-kgqa``)
is the CI/snapshot source of truth; this variant is a nice-to-have for question
diversity when a ``GEMINI_API_KEY`` is available.

Run against an existing split::

    GEMINI_API_KEY=… uv run linguascrape-polish-kgqa \\
        --input  ml/data/kgqa/eval.jsonl \\
        --output ml/data/kgqa/eval.polished.jsonl

The pure transform (:func:`~linguascrape_ml.kgqa.apply_polish`) is unit-tested
with a fake polisher; the networked Gemini client is imported lazily here so
importing this module (and the whole package) never pulls a Gemini dependency,
and CI — which sets no ``GEMINI_API_KEY`` — never runs it. After generating the
variant, ``dvc add ml/data`` captures it alongside the deterministic core.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from linguascrape_ml.kgqa import apply_polish

# System instruction: rewrite ONLY the surface; never alter the facts/answer.
_POLISH_SYSTEM = (
    "You paraphrase a knowledge-graph question into more natural, varied English. "
    "Preserve every entity name and the exact meaning; do not add, remove, or "
    "change any fact, and do not answer the question. Return only the rewritten "
    "question."
)

DEFAULT_MODEL = "gemini-1.5-flash"


def _load_records(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line]


def _write_records(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = (
        "\n".join(
            json.dumps(r, sort_keys=True, ensure_ascii=False) for r in records
        )
        + "\n"
        if records
        else ""
    )
    path.write_text(body, encoding="utf-8")


def _gemini_polisher(model_name: str):  # pragma: no cover - networked
    """Build a ``str -> str`` polisher backed by Google Gemini (lazy import)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit(
            "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set — the polish pass is "
            "optional and only runs with a Gemini key. The deterministic core "
            "dataset (linguascrape-export-kgqa) needs no key."
        )
    try:
        import google.generativeai as genai
    except ImportError as exc:  # not a declared dep — install on demand
        raise SystemExit(
            "google-generativeai is not installed. It is intentionally not a "
            "workspace dependency (the polish pass is optional). Install it with "
            "`uv pip install google-generativeai` to run this."
        ) from exc

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name, system_instruction=_POLISH_SYSTEM)

    def polish(question: str) -> str:
        response = model.generate_content(question)
        text = (response.text or "").strip()
        return text or question  # fall back to the original on an empty reply

    return polish


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - CLI entry
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args(argv)

    records = _load_records(args.input)
    polisher = _gemini_polisher(args.model)
    polished = apply_polish(records, polisher)
    _write_records(args.output, polished)
    print(f"polished {len(polished)} records -> {args.output}")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
