"""Build the 500-passage benchmark set from the local PDFs in engine/benchmarking_src/.

Usage: python extract_passages.py [n=500]
Writes engine/bench/data/passages.json (gitignored: the source PDFs are not ours to commit).
Chunking mirrors shared/engine-stub.ts: 1-3 sentences, ~25-80 words.
"""

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
SRC = ROOT.parent / "benchmarking_src"
OUT = ROOT / "data" / "passages.json"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 500

SENT = re.compile(r"[^.!?]+[.!?]+[\"')\]]*|[^.!?]+$")


def chunk(text: str) -> list[str]:
    sentences = [s.strip() for s in SENT.findall(re.sub(r"\s+", " ", text).strip()) if s.strip()]
    out, cur, words = [], [], 0
    for s in sentences:
        n = len(s.split(" "))
        if cur and (len(cur) >= 3 or words + n > 80):
            out.append(" ".join(cur))
            cur, words = [], 0
        cur.append(s)
        words += n
        if words >= 25:
            out.append(" ".join(cur))
            cur, words = [], 0
    if cur:
        out.append(" ".join(cur))
    return out


def passages(pdf: Path) -> list[str]:
    out = []
    for page in PdfReader(pdf).pages:
        for p in chunk(page.extract_text() or ""):
            if 8 <= len(p.split()) <= 120:  # drop page numbers / headers and runaway blobs
                out.append(p)
    return out


def spread(items: list[str], n: int) -> list[str]:
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


slides = [p for f in sorted((SRC / "pdf_slides").glob("*.pdf")) for p in passages(f)]
books = [p for f in sorted((SRC / "textbooks").glob("*.pdf")) for p in passages(f)]
half = N // 2
picked = spread(slides, half)
picked += spread(books, N - len(picked))

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(picked, indent=0))
words = [len(p.split()) for p in picked]
print(f"slides={len(slides)} books={len(books)} -> {len(picked)} passages, "
      f"avg {sum(words) / len(words):.1f} words, max {max(words)}  -> {OUT}")
