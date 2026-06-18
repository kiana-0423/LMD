const organicElements = new Set(["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I", "H"]);

export function buildMock3dMolBlock(smiles: string, label = "LMD GENERATED 3D") {
  const tokens = extractAtomTokens(smiles);
  const elements = tokens.map((token) => token.element);
  const atoms = elements.map((element, index) => {
    const angle = index * 1.12;
    return {
      element,
      x: index * 1.32 - ((elements.length - 1) * 1.32) / 2,
      y: Math.sin(angle) * 0.72,
      z: Math.cos(angle) * 0.72
    };
  });
  const bonds = atoms.slice(1).map((_, index) => [index + 1, index + 2, inferMockBondOrder(smiles, tokens, index)]);
  const header = `${label.slice(0, 70)}\n  LMD MOCK          3D\n\n`;
  const counts = `${padInt(atoms.length, 3)}${padInt(bonds.length, 3)}  0  0  0  0            999 V2000\n`;
  const atomLines = atoms
    .map(
      (atom) =>
        `${padFloat(atom.x)}${padFloat(atom.y)}${padFloat(atom.z)} ${atom.element.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`
    )
    .join("\n");
  const bondLines = bonds.map(([from, to, order]) => `${padInt(from, 3)}${padInt(to, 3)}${padInt(order, 3)}  0`).join("\n");
  return `${header}${counts}${atomLines}${bondLines ? `\n${bondLines}` : ""}\nM  END\n`;
}

export function buildMockSdfBlock(molBlock: string) {
  return `${molBlock.trimEnd()}\n$$$$\n`;
}

export function buildMockPdbBlock(smiles: string, label = "LMD") {
  const elements = extractElements(smiles);
  const atomLines = elements.map((element, index) => {
    const serial = index + 1;
    const angle = index * 1.12;
    const x = index * 1.32 - ((elements.length - 1) * 1.32) / 2;
    const y = Math.sin(angle) * 0.72;
    const z = Math.cos(angle) * 0.72;
    return `HETATM${padInt(serial, 5)} ${`${element}${serial}`.padEnd(4, " ")} UNL     1    ${padFloat(
      x,
      8,
      3
    )}${padFloat(y, 8, 3)}${padFloat(z, 8, 3)}  1.00  0.00          ${element.padStart(2, " ")}`;
  });
  const conectLines = elements.slice(1).map((_, index) => `CONECT${padInt(index + 1, 5)}${padInt(index + 2, 5)}`);
  return `HEADER ${label.slice(0, 60)}\nREMARK SMILES ${smiles}\n${atomLines.join("\n")}\n${conectLines.join("\n")}\nEND\n`;
}

function extractElements(smiles: string) {
  const elements = extractAtomTokens(smiles)
    .map((token) => token.element)
    .filter((token) => organicElements.has(token));
  return elements.length ? elements.slice(0, 80) : ["C"];
}

function extractAtomTokens(smiles: string) {
  const matches = Array.from(smiles.matchAll(/Cl|Br|[A-Z][a-z]?|[bcnops]/g));
  const tokens = matches
    .map((match) => {
      const raw = match[0];
      const element = raw.length === 1 ? raw.toUpperCase() : raw;
      return {
        raw,
        element,
        index: match.index ?? 0,
        aromatic: raw === raw.toLowerCase()
      };
    })
    .filter((token) => organicElements.has(token.element));
  return tokens.length ? tokens.slice(0, 80) : [{ raw: "C", element: "C", index: 0, aromatic: false }];
}

function inferMockBondOrder(smiles: string, tokens: ReturnType<typeof extractAtomTokens>, bondIndex: number) {
  const current = tokens[bondIndex];
  const next = tokens[bondIndex + 1];
  const between = smiles.slice(current.index + current.raw.length, next.index);
  if (between.includes("#")) return 3;
  if (between.includes("=")) return 2;
  if (between.includes(":") || (current.aromatic && next.aromatic)) return 4;
  return 1;
}

function padInt(value: number, width: number) {
  return String(value).padStart(width, " ");
}

function padFloat(value: number, width = 10, digits = 4) {
  return value.toFixed(digits).padStart(width, " ");
}
