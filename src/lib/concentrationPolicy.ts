import type { MessageKey } from "../i18n/LanguageContext";

/**
 * What a model needs supplied for a concentration, and what it must never be sent.
 *
 * A model records the basis it was fitted on, and there are three of them. They are not degrees of
 * the same thing, and the backend refuses a request built for the wrong one — so every prediction
 * screen has to ask the same three questions, and every one of them has to answer them the same
 * way. That is why this lives here rather than in each page: the screening page and the two
 * workbench modes previously each decided for themselves, and each of them only handled `wt%`.
 *
 *  - **`wt%`** — a real proportion. Needs a finite positive number *and* the unit it was measured
 *    in, which the backend converts to weight percent.
 *  - **`unrecorded`** — a number on a scale nobody wrote down. Needs a finite positive number and
 *    *no unit*. Attaching "wt%" to it would claim a measurement that was never made, and the
 *    backend correctly refuses the request.
 *  - **`none`** — the model was fitted with no concentrations at all. Sends neither value nor
 *    unit. There is no field to fill in, because a value entered here would silently change what
 *    the prediction means.
 *
 * The refusal to invent a value is the point of the whole module. A default of `1` is not a
 * neutral starting position: it is a scientific claim, made on the user's behalf, that they never
 * made and cannot see.
 */
export type ConcentrationBasis = "wt%" | "unrecorded" | "none";

/** The units a `wt%` model accepts. Each converts to weight percent by arithmetic alone. */
export const CONCENTRATION_UNITS = ["wt%", "ppm", "mass fraction", "g/kg"] as const;

export type ConcentrationUnit = (typeof CONCENTRATION_UNITS)[number];

/** Reads a model's recorded basis, refusing anything this build does not define. */
export function readBasis(basis: string | undefined): ConcentrationBasis | undefined {
  if (basis === "wt%" || basis === "unrecorded" || basis === "none") return basis;
  return undefined;
}

/** How a model's basis is named in the interface. */
export function basisLabelKey(basis: string | undefined): MessageKey {
  if (basis === "wt%") return "model.basisMass";
  if (basis === "none") return "model.basisNone";
  if (basis === "unrecorded") return "model.basisUnrecorded";
  return "backend.datasetUnknownBasis";
}

/** What a prediction screen must show and collect for one basis. */
export type ConcentrationPolicy = {
  basis: ConcentrationBasis;
  /** Whether the user must supply a number at all. */
  needsValue: boolean;
  /** Whether a unit accompanies that number. False for `unrecorded`: none exists to send. */
  needsUnit: boolean;
  /** The label for the number field. */
  labelKey: MessageKey;
  /** The sentence explaining what this model expects. */
  helpKey: MessageKey;
};

const POLICIES: Record<ConcentrationBasis, ConcentrationPolicy> = {
  "wt%": {
    basis: "wt%",
    needsValue: true,
    needsUnit: true,
    labelKey: "concentration.massLabel",
    helpKey: "concentration.massHelp"
  },
  unrecorded: {
    basis: "unrecorded",
    needsValue: true,
    // Deliberately false. A unit-less model was fitted on numbers with no unit; sending "wt%"
    // alongside one claims a conversion that cannot be made and the backend refuses it.
    needsUnit: false,
    labelKey: "concentration.unrecordedLabel",
    helpKey: "concentration.unrecordedHelp"
  },
  none: {
    basis: "none",
    needsValue: false,
    needsUnit: false,
    labelKey: "concentration.massLabel",
    helpKey: "concentration.noneHelp"
  }
};

/** The policy for a model's recorded basis, or `undefined` when the basis is unreadable. */
export function concentrationPolicy(basis: string | undefined): ConcentrationPolicy | undefined {
  const known = readBasis(basis);
  return known ? POLICIES[known] : undefined;
}

/** What a caller supplies for one component. */
export type ConcentrationEntry = { value: number | null; unit?: string };

/** The concentration fields of one item in a prediction payload. */
export type ConcentrationPayload = { concentration?: number; concentrationUnit?: string };

export type ConcentrationCheck =
  | { ok: true; payload: ConcentrationPayload }
  | { ok: false; messageKey: MessageKey };

/**
 * Validates one entry against a model's basis and builds exactly the payload the backend expects.
 *
 * The three shapes are as different as the bases are:
 *
 *   `wt%`        → `{ concentration: 1.5, concentrationUnit: "ppm" }`
 *   `unrecorded` → `{ concentration: 1.5 }`                    — no unit key at all
 *   `none`       → `{}`                                        — neither
 */
export function buildConcentration(
  policy: ConcentrationPolicy,
  entry: ConcentrationEntry
): ConcentrationCheck {
  if (!policy.needsValue) {
    // A `none` model is sent nothing, whatever happens to be in the state.
    return { ok: true, payload: {} };
  }
  const { value } = entry;
  if (value === null || value === undefined) {
    return { ok: false, messageKey: "concentration.required" };
  }
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, messageKey: "concentration.positive" };
  }
  if (!policy.needsUnit) {
    // The absent key, not an empty string: the Rust reader treats a blank unit as "no unit
    // recorded", which is exactly this basis, and omitting the key says the same thing.
    return { ok: true, payload: { concentration: value } };
  }
  const unit = (entry.unit ?? "").trim();
  if (!unit) {
    return { ok: false, messageKey: "concentration.unitRequired" };
  }
  return { ok: true, payload: { concentration: value, concentrationUnit: unit } };
}

/**
 * Validates a list of entries, returning the first problem rather than a partial payload.
 *
 * Half a candidate blend is not a candidate blend: predicting on one whose components were
 * partly validated would send the backend a request it must refuse, with a message about the
 * data rather than about the field the user left blank.
 */
export function buildConcentrations(
  policy: ConcentrationPolicy,
  entries: ConcentrationEntry[]
): { ok: true; payloads: ConcentrationPayload[] } | { ok: false; messageKey: MessageKey } {
  const payloads: ConcentrationPayload[] = [];
  for (const entry of entries) {
    const checked = buildConcentration(policy, entry);
    if (!checked.ok) return checked;
    payloads.push(checked.payload);
  }
  return { ok: true, payloads };
}
