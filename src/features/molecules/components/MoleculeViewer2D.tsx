import { Button, Space, message } from "antd";
import { useState } from "react";
import MoleculeStructurePreview from "../../../components/MoleculeStructurePreview";
import type { Molecule } from "../../../types";

export default function MoleculeViewer2D({ molecule }: { molecule: Molecule }) {
  const [zoom, setZoom] = useState(1);
  const svg = molecule.structureSvg || fallbackStructureSvg(molecule);

  async function copySmiles() {
    await navigator.clipboard.writeText(molecule.smilesCanonical);
    message.success("规范 SMILES 已复制。");
  }

  function downloadSvg() {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${molecule.name}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Space className="viewer-toolbar" wrap>
        <Button onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))}>放大</Button>
        <Button onClick={() => setZoom((value) => Math.max(0.5, value - 0.2))}>缩小</Button>
        <Button onClick={() => setZoom(1)}>重置视图</Button>
        <Button onClick={downloadSvg}>下载 SVG</Button>
        <Button onClick={copySmiles}>复制规范 SMILES</Button>
      </Space>
      <div style={{ transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 120ms ease" }}>
        <MoleculeStructurePreview svg={svg} title="2D 结构" />
      </div>
    </div>
  );
}

function fallbackStructureSvg(molecule: Molecule) {
  const label = escapeSvg(molecule.formula || molecule.name);
  const subLabel = escapeSvg(molecule.smilesCanonical || molecule.inchiKey || "structure");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="300" viewBox="0 0 520 300">
    <rect width="520" height="300" rx="8" fill="#f8fafc"/>
    <g stroke="#0f766e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M78 158 L136 112 L198 158 L260 112 L322 158 L384 112 L442 158"/>
      <path d="M198 158 L198 218"/>
      <path d="M322 158 L322 218"/>
    </g>
    <g font-family="Arial, sans-serif" font-weight="700" text-anchor="middle">
      <circle cx="78" cy="158" r="20" fill="#2563eb"/><text x="78" y="164" font-size="16" fill="#fff">C</text>
      <circle cx="198" cy="158" r="20" fill="#14b8a6"/><text x="198" y="164" font-size="16" fill="#092233">O</text>
      <circle cx="322" cy="158" r="20" fill="#f59e0b"/><text x="322" y="164" font-size="16" fill="#092233">S</text>
      <circle cx="442" cy="158" r="20" fill="#64748b"/><text x="442" y="164" font-size="16" fill="#fff">R</text>
    </g>
    <text x="260" y="54" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#172033">${label}</text>
    <text x="260" y="270" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#526275">${subLabel.slice(0, 72)}</text>
  </svg>`;
}

function escapeSvg(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
