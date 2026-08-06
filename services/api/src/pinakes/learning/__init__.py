"""Learning mode — the quiz generator behind `/api/quiz`.

Its own package rather than a module under `lexicons/` or `analytics/`: it is
neither a corpus *reader* (it consumes the loaders those own) nor a computation
whose answer is a function of the corpus — every call draws a different quiz.
"""
