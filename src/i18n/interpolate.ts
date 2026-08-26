/**
 * Values substituted into a translated sentence.
 *
 * A message with moving parts — a count, a unit, a molecule's name — cannot be assembled by
 * concatenation, because the pieces fall in different places in different languages. The catalogue
 * holds the whole sentence with `{name}` placeholders and the values are filled in here.
 */
export type MessageParams = Record<string, string | number>;

/** Fills `{name}` placeholders. A placeholder with no value is left as written, so it is visible. */
export function interpolate(text: string, params?: MessageParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
