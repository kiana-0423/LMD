"""Warnings the sidecar produces, in a form the interface can translate.

A warning like *"3 feature(s) were dropped because no record had a value"* is a count and a list,
not a sentence. Written as a sentence here it can only ever be English, and it is shown next to a
training result in an interface the user chose a language for.

So a warning is a dictionary: a `code` naming the situation, `params` carrying the values, and
`detail` carrying the English prose untouched. The Rust layer passes it through unchanged and the
frontend renders whichever it can. A build that does not know the code still shows the detail,
so adding a warning never has to wait for a translation.
"""

from __future__ import annotations

from typing import Any


def message(code: str, detail: str, **params: Any) -> dict[str, Any]:
    """One translatable warning.

    `detail` is never translated: it is the diagnostic a user quotes when asking for help.
    """
    return {"code": code, "params": params, "detail": detail}


# Codes the training path emits. They match the constants in src-tauri/src/commands/messages.rs
# and the keys in src/i18n/LanguageContext.tsx; renaming one is a breaking change for all three.
TRAINING_DROPPED_FEATURES = "training.droppedFeatures"
TRAINING_UNGROUPED_SPLIT = "training.ungroupedSplit"
TRAINING_SMALL_SAMPLE = "training.smallSample"
TRAINING_NOT_SCOREABLE = "training.notScoreable"
TRAINING_TOO_FEW_GROUPS = "training.tooFewGroups"
TRAINING_FORMULATION_GROUPS_ONLY = "training.formulationGroupsOnly"
