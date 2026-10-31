"""Map recognized (whisper) word timings back onto the script's own words.

The captions must show the script's spelling, but only the recognizer knows when
each word was spoken. We match normalized tokens with difflib and interpolate the
words the recognizer missed or misheard.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

_NORMALIZE = re.compile(r"[^\w]+", re.UNICODE)


@dataclass
class Word:
    text: str
    start: float
    end: float


def normalize(token: str) -> str:
    return _NORMALIZE.sub("", token.lower())


def script_tokens(text: str) -> list[str]:
    return [t for t in text.split() if normalize(t)]


def proportional(tokens: list[str], start: float, end: float) -> list[Word]:
    """Spread tokens over [start, end] weighted by character length."""
    if not tokens:
        return []
    weights = [len(normalize(t)) + 1 for t in tokens]
    total = sum(weights)
    span = max(end - start, 0.0)
    words: list[Word] = []
    cursor = start
    for token, weight in zip(tokens, weights):
        length = span * weight / total
        words.append(Word(token, round(cursor, 3), round(cursor + length, 3)))
        cursor += length
    return words


def align(tokens: list[str], recognized: list[Word], start: float, end: float) -> list[Word]:
    """Give every script token a time, using recognized words where they match.

    `start`/`end` bound the audio the tokens belong to; gaps the recognizer did
    not cover are filled proportionally between the nearest anchored words.
    """
    if not tokens:
        return []
    if not recognized:
        return proportional(tokens, start, end)

    times: list[tuple[float, float] | None] = [None] * len(tokens)
    matcher = difflib.SequenceMatcher(
        a=[normalize(t) for t in tokens],
        b=[normalize(w.text) for w in recognized],
        autojunk=False,
    )
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                w = recognized[j1 + k]
                times[i1 + k] = (w.start, w.end)
        elif tag == "replace" and i2 - i1 == j2 - j1:
            # Same count, different spelling (e.g. "2" vs "two"): trust position.
            for k in range(i2 - i1):
                w = recognized[j1 + k]
                times[i1 + k] = (w.start, w.end)

    words: list[Word] = []
    i = 0
    while i < len(tokens):
        if times[i] is not None:
            s, e = times[i]
            words.append(Word(tokens[i], s, e))
            i += 1
            continue
        j = i
        while j < len(tokens) and times[j] is None:
            j += 1
        gap_start = words[-1].end if words else start
        gap_end = times[j][0] if j < len(tokens) else end
        if gap_end < gap_start:
            gap_end = gap_start
        words.extend(proportional(tokens[i:j], gap_start, gap_end))
        i = j

    return monotonic(words, start, end)


def monotonic(words: list[Word], start: float, end: float) -> list[Word]:
    """Clamp into [start, end] and remove overlaps so captions never go backwards."""
    out: list[Word] = []
    prev_end = start
    for w in words:
        s = min(max(w.start, prev_end), end)
        e = min(max(w.end, s), end)
        out.append(Word(w.text, round(s, 3), round(e, 3)))
        prev_end = e
    return out
