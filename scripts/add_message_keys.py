#!/usr/bin/env python3
"""Adds message keys to all three locale files at once.

A key added to one language and forgotten in the others is a blank label on somebody's screen, and
the compile-time `MessageCatalogue` type only catches it once every file has been edited. This
writes all three together so they cannot drift in the first place.

Reads a JSON object of {key: {"en": ..., "zh": ..., "ja": ...}} from stdin.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "i18n" / "locales"
FILES = {"en": ROOT / "en-US.ts", "zh": ROOT / "zh-CN.ts", "ja": ROOT / "ja-JP.ts"}
CLOSERS = {"en": "} as const;", "zh": "};", "ja": "};"}


def encode(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> int:
    additions: dict[str, dict[str, str]] = json.load(sys.stdin)
    for language, path in FILES.items():
        text = path.read_text(encoding="utf-8")
        closer = CLOSERS[language]
        index = text.rindex("\n" + closer)
        lines = []
        for key, values in additions.items():
            if f'"{key}":' in text:
                continue
            lines.append(f"  {encode(key)}: {encode(values[language])},")
        if not lines:
            continue
        # The last existing entry has no trailing comma; give it one before appending.
        head = text[:index].rstrip()
        if not head.endswith(","):
            head += ","
        path.write_text(head + "\n" + "\n".join(lines).rstrip(",") + "\n" + closer + text[index + 1 + len(closer):], encoding="utf-8")
        print(f"{path.name}: +{len(lines)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
