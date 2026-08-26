/**
 * Finds the Tauri command names a source file asks the backend to run.
 *
 * A regular expression is the obvious tool and gets this subtly wrong: the optional type argument
 * can contain almost anything — `invokeCommand<{ ok: boolean; items: T[] }>("...")` — so any
 * character class written to exclude "the end of the type argument" eventually excludes a
 * character that appears inside one. The result is a scan that silently misses calls, which in a
 * check whose whole job is completeness is worse than no scan at all.
 *
 * So the type argument is skipped by counting angle brackets, which is what it actually is.
 */

const NAME = /\binvoke(?:Command)?\b/g;

/** Every command name invoked in one source string. */
export function extractInvokedCommands(source) {
  const found = [];
  NAME.lastIndex = 0;
  let match;
  while ((match = NAME.exec(source)) !== null) {
    let index = match.index + match[0].length;

    // Skip whitespace, then a balanced <...> if one is there.
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] === "<") {
      let depth = 0;
      while (index < source.length) {
        if (source[index] === "<") depth += 1;
        else if (source[index] === ">") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        index += 1;
      }
      while (index < source.length && /\s/.test(source[index])) index += 1;
    }

    if (source[index] !== "(") continue;
    index += 1;
    while (index < source.length && /\s/.test(source[index])) index += 1;

    const quote = source[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const end = source.indexOf(quote, index + 1);
    if (end < 0) continue;
    const name = source.slice(index + 1, end);
    // A command name is a Rust function name: lowercase, digits and underscores.
    if (/^[a-z][a-z0-9_]*$/.test(name)) found.push(name);
  }
  return found;
}

/** Every command registered in `tauri::generate_handler!`, in declaration order. */
export function extractRegisteredCommands(mainRs) {
  const block = /generate_handler!\s*\[([\s\S]*?)\]/.exec(mainRs);
  if (!block) throw new Error("main.rs no longer contains a generate_handler! block");
  return block[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").pop());
}

/** Every command the browser-demo adapter answers. */
export function extractDemoCommands(adapterSource) {
  const table = /const HANDLERS: Record<string, Handler> = \{([\s\S]*?)\n\};/.exec(adapterSource);
  if (!table) throw new Error("the demo adapter no longer declares a HANDLERS table");
  return [...table[1].matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)].map((match) => match[1]);
}
