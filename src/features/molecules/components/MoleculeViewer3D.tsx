import { Button, Select, Space, Switch, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateMolecule3d } from "../../../lib/api";
import { buildMock3dMolBlock } from "../../../lib/mockStructure";
import type { Molecule } from "../../../types";

type Atom3D = { index: number; element: string; x: number; y: number; z: number };
type Bond3D = { from: number; to: number; order: number };
type ParsedStructure = { atoms: Atom3D[]; bonds: Bond3D[]; source: "saved" | "generated-preview" | "empty" };
type DragState = { x: number; y: number; rotateX: number; rotateY: number } | undefined;

const elementColors: Record<string, string> = {
  H: "#dce8f7",
  B: "#f59e0b",
  C: "#243041",
  N: "#2563eb",
  O: "#f0182f",
  F: "#22c55e",
  P: "#f97316",
  S: "#eab308",
  Cl: "#16a34a",
  Br: "#92400e",
  I: "#7c3aed"
};

const isoView = {
  rotateX: 35.264,
  rotateY: -45,
  zoom: 1
};

export default function MoleculeViewer3D({ molecule }: { molecule: Molecule }) {
  const [style, setStyle] = useState("ball-and-stick");
  const [rotateX, setRotateX] = useState(isoView.rotateX);
  const [rotateY, setRotateY] = useState(isoView.rotateY);
  const [zoom, setZoom] = useState(isoView.zoom);
  const [autoRotate, setAutoRotate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedBlocks, setGeneratedBlocks] = useState<{ molBlock?: string; sdfBlock?: string; pdbBlock?: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState>();

  const rawStructure =
    generatedBlocks?.sdfBlock ||
    generatedBlocks?.molBlock ||
    generatedBlocks?.pdbBlock ||
    molecule.sdfBlock ||
    molecule.molBlock ||
    molecule.pdbBlock ||
    "";

  const parsed = useMemo(() => {
    const saved = parseStructure(rawStructure);
    if (saved.atoms.length) return { ...saved, source: "saved" as const };
    if (molecule.smilesCanonical) {
      const preview = parseStructure(buildMock3dMolBlock(molecule.smilesCanonical, molecule.name));
      return { ...preview, source: preview.atoms.length ? "generated-preview" as const : "empty" as const };
    }
    return { atoms: [], bonds: [], source: "empty" as const };
  }, [molecule.name, molecule.smilesCanonical, rawStructure]);

  const scene = useMemo(() => projectStructure(parsed, rotateX, rotateY, style, zoom), [parsed, rotateX, rotateY, style, zoom]);
  useEffect(() => {
    drawCanvas(canvasRef.current, scene);
  }, [scene]);

  useEffect(() => {
    if (!autoRotate) return undefined;
    let frame = 0;
    let previous = performance.now();
    function tick(now: number) {
      const delta = now - previous;
      previous = now;
      setRotateY((value) => normalizeAngle(value + delta * 0.018));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate]);

  const styleLabels: Record<string, string> = {
    "ball-and-stick": "球棍模型",
    stick: "棍状模型",
    sphere: "球状模型",
    line: "线框模型"
  };

  async function generate3d() {
    const smiles = molecule.smilesCanonical || molecule.smilesRaw;
    if (!smiles) {
      message.error("缺少 SMILES，无法生成 3D 结构。");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateMolecule3d(smiles);
      const molBlock = String(result.mol_block ?? "");
      const sdfBlock = String(result.sdf_block ?? "");
      const pdbBlock = String(result.pdb_block ?? "");
      if (!molBlock && !sdfBlock && !pdbBlock) throw new Error("3D 生成未返回结构块。");
      setGeneratedBlocks({ molBlock, sdfBlock, pdbBlock });
      message.success("3D 结构已生成。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "3D 结构生成失败。");
    } finally {
      setGenerating(false);
    }
  }

  function exportBlock(format: "mol" | "sdf" | "pdb") {
    const content =
      format === "sdf"
        ? generatedBlocks?.sdfBlock || molecule.sdfBlock
        : format === "mol"
          ? generatedBlocks?.molBlock || molecule.molBlock
          : generatedBlocks?.pdbBlock || molecule.pdbBlock;
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${molecule.name}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function resetView() {
    setRotateX(isoView.rotateX);
    setRotateY(isoView.rotateY);
    setZoom(isoView.zoom);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY, rotateX, rotateY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setRotateY(normalizeAngle(drag.rotateY + (event.clientX - drag.x) * 0.45));
    setRotateX(clamp(drag.rotateX + (event.clientY - drag.y) * 0.45, -180, 180));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    setZoom((value) => clamp(value * (event.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.4));
  }

  return (
    <div>
      <Space className="viewer-toolbar" wrap>
        <Select
          value={style}
          style={{ width: 180 }}
          options={[
            { value: "ball-and-stick", label: "球棍模型" },
            { value: "stick", label: "棍状模型" },
            { value: "sphere", label: "球状模型" },
            { value: "line", label: "线框模型" }
          ]}
          onChange={setStyle}
        />
        <Button loading={generating} onClick={generate3d}>
          {parsed.source === "saved" ? "重新生成 3D" : "生成 3D"}
        </Button>
        <Button disabled={!molecule.molBlock && !generatedBlocks?.molBlock} onClick={() => exportBlock("mol")}>导出 MOL</Button>
        <Button disabled={!molecule.sdfBlock && !generatedBlocks?.sdfBlock} onClick={() => exportBlock("sdf")}>导出 SDF</Button>
        <Button disabled={!molecule.pdbBlock && !generatedBlocks?.pdbBlock} onClick={() => exportBlock("pdb")}>导出 PDB</Button>
        <Button onClick={resetView}>重置视角</Button>
        <Switch checked={autoRotate} onChange={setAutoRotate} checkedChildren="自动旋转" unCheckedChildren="自动旋转" />
        <Tag color={parsed.source === "saved" ? "green" : "gold"}>
          {parsed.source === "saved" ? "已加载 3D 结构" : "SMILES 预览结构"}
        </Tag>
      </Space>
      <div className="viewer-shell molecule-3d-shell molecule-3d-clean-shell">
        {scene.atoms.length ? (
          <canvas
            ref={canvasRef}
            className="molecule-3d-canvas"
            width={640}
            height={360}
            aria-label={`${molecule.name} 3D structure`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          />
        ) : (
          <div className="molecule-3d-empty">
            <Typography.Text strong>暂无可渲染的 3D 坐标</Typography.Text>
            <Typography.Text type="secondary">请确认该分子有 SMILES，或点击“生成 3D”。</Typography.Text>
          </div>
        )}
      </div>
      <div className="molecule-3d-meta">
        <Typography.Text type="secondary">拖拽旋转，滚轮缩放；当前显示模式：{styleLabels[style] ?? style}</Typography.Text>
        <Typography.Text type="secondary">缩放 {zoom.toFixed(2)}x · X {Math.round(rotateX)}° · Y {Math.round(rotateY)}°</Typography.Text>
      </div>
    </div>
  );
}

function drawCanvas(canvas: HTMLCanvasElement | null, scene: ReturnType<typeof projectStructure>) {
  if (!canvas) return;
  const width = 640;
  const height = 360;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = "100%";
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#05070d";
  context.fillRect(0, 0, width, height);

  scene.bonds.forEach((bond) => {
    drawBond(context, bond);
  });

  scene.atoms.forEach((atom) => {
    context.save();
    context.globalAlpha = atom.opacity;
    const gradient = context.createRadialGradient(
      atom.x - atom.radius * 0.32,
      atom.y - atom.radius * 0.35,
      atom.radius * 0.2,
      atom.x,
      atom.y,
      atom.radius
    );
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.18, atom.color);
    gradient.addColorStop(1, atom.color);
    context.fillStyle = gradient;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(atom.x, atom.y, atom.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (atom.radius >= 8) {
      context.globalAlpha = 0.22;
      context.strokeStyle = "#dbe7f5";
      context.lineWidth = atom.element === "H" ? 4 : 3;
      context.beginPath();
      context.arc(atom.x, atom.y, atom.radius + 2, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  });
  drawAtomLegend(context, scene.atomLegend, width, height);
}

function drawBond(
  context: CanvasRenderingContext2D,
  bond: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    order: number;
    fromRadius: number;
    toRadius: number;
  }
) {
  const dx = bond.x2 - bond.x1;
  const dy = bond.y2 - bond.y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const shortenStart = Math.min(length * 0.28, bond.fromRadius + 7);
  const shortenEnd = Math.min(length * 0.28, bond.toRadius + 7);
  const x1 = bond.x1 + ux * shortenStart;
  const y1 = bond.y1 + uy * shortenStart;
  const x2 = bond.x2 - ux * shortenEnd;
  const y2 = bond.y2 - uy * shortenEnd;
  const normalizedOrder = Math.round(bond.order);
  const color = "#e5e7eb";
  const shadowColor = "rgba(148, 163, 184, 0.58)";
  const drawLine = (offset: number, dashed = false, width = bond.width) => {
    context.save();
    context.globalAlpha = 1;
    context.strokeStyle = shadowColor;
    context.lineWidth = width + 2;
    context.lineCap = "round";
    if (dashed) context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(x1 + px * offset, y1 + py * offset);
    context.lineTo(x2 + px * offset, y2 + py * offset);
    context.stroke();

    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(x1 + px * offset, y1 + py * offset);
    context.lineTo(x2 + px * offset, y2 + py * offset);
    context.stroke();
    context.restore();
  };

  if (normalizedOrder === 2) {
    drawLine(-bond.width * 0.75);
    drawLine(bond.width * 0.75);
    return;
  }
  if (normalizedOrder === 3) {
    drawLine(0);
    drawLine(-bond.width * 1.15, false, Math.max(2.5, bond.width * 0.72));
    drawLine(bond.width * 1.15, false, Math.max(2.5, bond.width * 0.72));
    return;
  }
  if (normalizedOrder === 4) {
    drawLine(-bond.width * 0.55);
    drawLine(bond.width * 0.9, true, Math.max(2.5, bond.width * 0.7));
    return;
  }
  drawLine(0);
}

function drawAtomLegend(
  context: CanvasRenderingContext2D,
  atomLegend: Array<{ element: string; color: string; count: number }>,
  width: number,
  height: number
) {
  if (!atomLegend.length) return;
  const panelWidth = 116;
  const rowHeight = 24;
  const panelHeight = 30 + atomLegend.length * rowHeight;
  const x = width - panelWidth - 18;
  const y = Math.max(18, (height - panelHeight) / 2);
  context.save();
  context.fillStyle = "rgba(15, 23, 42, 0.72)";
  context.strokeStyle = "rgba(148, 163, 184, 0.36)";
  context.lineWidth = 1;
  roundRect(context, x, y, panelWidth, panelHeight, 8);
  context.fill();
  context.stroke();
  context.fillStyle = "#dbeafe";
  context.font = "700 12px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("原子实例", x + 12, y + 16);
  atomLegend.forEach((entry, index) => {
    const cy = y + 36 + index * rowHeight;
    context.fillStyle = entry.color;
    context.beginPath();
    context.arc(x + 18, cy, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.2;
    context.stroke();
    context.fillStyle = "#e5edf7";
    context.font = "12px system-ui, sans-serif";
    context.fillText(`${entry.element} × ${entry.count}`, x + 32, cy);
  });
  context.restore();
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function parseStructure(content: string): Omit<ParsedStructure, "source"> {
  if (!content.trim()) return { atoms: [], bonds: [] };
  if (content.includes("V2000") || content.includes("M  END")) return parseMolBlock(content);
  if (content.includes("ATOM") || content.includes("HETATM")) return parsePdbBlock(content);
  return { atoms: [], bonds: [] };
}

function parseMolBlock(content: string): Omit<ParsedStructure, "source"> {
  const lines = content.split(/\r?\n/);
  const countsIndex = lines.findIndex((line) => line.includes("V2000") && /^\s*\d+\s+\d+/.test(line));
  if (countsIndex < 0) return { atoms: [], bonds: [] };
  const countParts = lines[countsIndex].trim().split(/\s+/);
  const atomCount = Number(lines[countsIndex].slice(0, 3)) || Number(countParts[0]) || 0;
  const bondCount = Number(lines[countsIndex].slice(3, 6)) || Number(countParts[1]) || 0;
  const atomLines = lines.slice(countsIndex + 1, countsIndex + 1 + atomCount);
  const bondLines = lines.slice(countsIndex + 1 + atomCount, countsIndex + 1 + atomCount + bondCount);
  const atoms = atomLines
    .map((line, index) => {
      const parts = line.trim().split(/\s+/);
      return {
        index,
        x: Number(line.slice(0, 10)) || Number(parts[0]) || 0,
        y: Number(line.slice(10, 20)) || Number(parts[1]) || 0,
        z: Number(line.slice(20, 30)) || Number(parts[2]) || 0,
        element: normalizeElement(line.slice(31, 34).trim() || parts[3] || "C")
      };
    })
    .filter((atom) => Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z));
  const bonds = bondLines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        from: (Number(line.slice(0, 3)) || Number(parts[0])) - 1,
        to: (Number(line.slice(3, 6)) || Number(parts[1])) - 1,
        order: Number(line.slice(6, 9)) || Number(parts[2]) || 1
      };
    })
    .filter((bond) => bond.from >= 0 && bond.to >= 0 && bond.from < atoms.length && bond.to < atoms.length);
  return { atoms, bonds };
}

function parsePdbBlock(content: string): Omit<ParsedStructure, "source"> {
  const lines = content.split(/\r?\n/);
  const serialToIndex = new Map<number, number>();
  const atoms: Atom3D[] = [];
  lines.forEach((line) => {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) return;
    const serial = Number(line.slice(6, 11).trim()) || atoms.length + 1;
    const element = normalizeElement(line.slice(76, 78).trim() || line.slice(12, 16).replace(/\d/g, "").trim() || "C");
    serialToIndex.set(serial, atoms.length);
    atoms.push({
      index: atoms.length,
      element,
      x: Number(line.slice(30, 38).trim()) || 0,
      y: Number(line.slice(38, 46).trim()) || 0,
      z: Number(line.slice(46, 54).trim()) || 0
    });
  });
  const bondKeys = new Set<string>();
  const bonds: Bond3D[] = [];
  lines.forEach((line) => {
    if (!line.startsWith("CONECT")) return;
    const serials = line.slice(6).trim().split(/\s+/).map(Number).filter(Boolean);
    const from = serialToIndex.get(serials[0]);
    if (from === undefined) return;
    serials.slice(1).forEach((serial) => {
      const to = serialToIndex.get(serial);
      if (to === undefined) return;
      const key = [from, to].sort((a, b) => a - b).join("-");
      if (bondKeys.has(key)) return;
      bondKeys.add(key);
      bonds.push({ from, to, order: 1 });
    });
  });
  return { atoms, bonds: bonds.length ? bonds : inferBonds(atoms) };
}

function projectStructure(parsed: ParsedStructure, rotateXDeg: number, rotateYDeg: number, style: string, zoom: number) {
  const rotateX = (rotateXDeg * Math.PI) / 180;
  const rotateY = (rotateYDeg * Math.PI) / 180;
  const rotated = parsed.atoms.map((atom) => {
    const x1 = atom.x * Math.cos(rotateY) + atom.z * Math.sin(rotateY);
    const z1 = -atom.x * Math.sin(rotateY) + atom.z * Math.cos(rotateY);
    const y1 = atom.y * Math.cos(rotateX) - z1 * Math.sin(rotateX);
    const z2 = atom.y * Math.sin(rotateX) + z1 * Math.cos(rotateX);
    return { ...atom, rx: x1, ry: y1, rz: z2 };
  });
  const xs = rotated.map((atom) => atom.rx);
  const ys = rotated.map((atom) => atom.ry);
  const zs = rotated.map((atom) => atom.rz);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const minZ = Math.min(...zs, 0);
  const maxZ = Math.max(...zs, 1);
  const scale = Math.min(155 / Math.max(maxX - minX, 1), 108 / Math.max(maxY - minY, 1), 46) * zoom;
  const radiusBase = style === "sphere" ? 16 : style === "line" ? 4 : style === "stick" ? 7 : 10;
  const projectPoint = (point: { x: number; y: number; z: number }) => {
    const x1 = point.x * Math.cos(rotateY) + point.z * Math.sin(rotateY);
    const z1 = -point.x * Math.sin(rotateY) + point.z * Math.cos(rotateY);
    const y1 = point.y * Math.cos(rotateX) - z1 * Math.sin(rotateX);
    const z2 = point.y * Math.sin(rotateX) + z1 * Math.cos(rotateX);
    return {
      x: 320 + (x1 - (minX + maxX) / 2) * scale,
      y: 178 - (y1 - (minY + maxY) / 2) * scale,
      z: z2
    };
  };
  const atoms = rotated
    .map((atom) => {
      const depth = (atom.rz - minZ) / Math.max(maxZ - minZ, 1);
      const color = elementColors[atom.element] ?? "#64748b";
      return {
        index: atom.index,
        element: atom.element,
        x: 320 + (atom.rx - (minX + maxX) / 2) * scale,
        y: 178 - (atom.ry - (minY + maxY) / 2) * scale,
        z: atom.rz,
        radius: atom.element === "H" ? Math.max(radiusBase - 2.2, 5.5) : radiusBase + depth * 2,
        color,
        textColor: atom.element === "H" ? "#334155" : "#ffffff",
        opacity: 0.92 + depth * 0.08
      };
    })
    .sort((a, b) => a.z - b.z);
  const atomByIndex = new Map(atoms.map((atom) => [atom.index, atom]));
  const bonds = parsed.bonds
    .map((bond) => {
      const from = atomByIndex.get(bond.from);
      const to = atomByIndex.get(bond.to);
      if (!from || !to) return undefined;
      return {
        from: bond.from,
        to: bond.to,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        z: (from.z + to.z) / 2,
        width: style === "line" ? 2.5 : style === "sphere" ? 4.5 : 7,
        order: bond.order,
        fromRadius: from.radius,
        toRadius: to.radius,
        opacity: 1
      };
    })
    .filter(Boolean)
    .sort((a, b) => a!.z - b!.z) as Array<{
    from: number;
    to: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    z: number;
    width: number;
    order: number;
    fromRadius: number;
    toRadius: number;
    opacity: number;
  }>;
  const frameEdges = buildFrameEdges(parsed.atoms, projectPoint);
  const elementLegend = Array.from(
    parsed.atoms.reduce((map, atom) => map.set(atom.element, (map.get(atom.element) ?? 0) + 1), new Map<string, number>())
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 9)
    .map(([element, count]) => ({ element, count, color: elementColors[element] ?? "#64748b" }));
  const atomLegend = elementLegend.map((entry) => ({ ...entry }));
  return { atoms, bonds, frameEdges, axes: projectAxes(rotateX, rotateY), elementLegend, atomLegend };
}

function buildFrameEdges(atoms: Atom3D[], projectPoint: (point: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) {
  if (!atoms.length) return [];
  const xs = atoms.map((atom) => atom.x);
  const ys = atoms.map((atom) => atom.y);
  const zs = atoms.map((atom) => atom.z);
  const pad = 0.45;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const corners = [
    { x: minX, y: minY, z: minZ },
    { x: maxX, y: minY, z: minZ },
    { x: maxX, y: maxY, z: minZ },
    { x: minX, y: maxY, z: minZ },
    { x: minX, y: minY, z: maxZ },
    { x: maxX, y: minY, z: maxZ },
    { x: maxX, y: maxY, z: maxZ },
    { x: minX, y: maxY, z: maxZ }
  ].map(projectPoint);
  return [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ].map(([from, to]) => ({
    x1: corners[from].x,
    y1: corners[from].y,
    x2: corners[to].x,
    y2: corners[to].y,
    z: (corners[from].z + corners[to].z) / 2
  }));
}

function projectAxes(rotateX: number, rotateY: number) {
  const vectors = [
    { label: "a", color: "#ef4444", x: 1, y: 0, z: 0 },
    { label: "b", color: "#22c55e", x: 0, y: 1, z: 0 },
    { label: "c", color: "#3b82f6", x: 0, y: 0, z: 1 }
  ];
  return vectors.map((vector) => {
    const x1 = vector.x * Math.cos(rotateY) + vector.z * Math.sin(rotateY);
    const z1 = -vector.x * Math.sin(rotateY) + vector.z * Math.cos(rotateY);
    const y1 = vector.y * Math.cos(rotateX) - z1 * Math.sin(rotateX);
    return { label: vector.label, color: vector.color, x: x1 * 34, y: -y1 * 34 };
  });
}

function inferBonds(atoms: Atom3D[]) {
  const bonds: Bond3D[] = [];
  for (let index = 0; index < atoms.length - 1; index += 1) {
    const atom = atoms[index];
    const next = atoms[index + 1];
    const distance = Math.hypot(atom.x - next.x, atom.y - next.y, atom.z - next.z);
    if (distance <= 2.1) bonds.push({ from: index, to: index + 1, order: 1 });
  }
  return bonds;
}

function normalizeElement(value: string) {
  if (!value) return "C";
  const clean = value.replace(/[^a-zA-Z]/g, "");
  if (!clean) return "C";
  return clean.length === 1 ? clean.toUpperCase() : `${clean[0].toUpperCase()}${clean.slice(1).toLowerCase()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value: number) {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
}
