import { useEffect, useMemo, useState } from "react";
import { basename } from "./paths";
import { pathKey, type VaultResolver } from "./vault";
import { forceLayout, layoutViewBox } from "./graphLayout";

const MAX_NEIGHBOURS = 40;
const MAX_VAULT_NODES = 150;

type Node = { path: string; label: string; x: number; y: number; center: boolean };
type Edge = { a: Node; b: Node };
type GraphMode = "local" | "vault";

/** Deduped links between the given nodes (one line per pair, either direction). */
function edgesAmong(nodes: Node[], resolver: VaultResolver): Edge[] {
  const byKey = new Map(nodes.map((n) => [pathKey(n.path), n]));
  const out: Edge[] = [];
  const added = new Set<string>();
  for (const n of nodes) {
    for (const target of resolver.outgoingFor(n.path)) {
      const other = byKey.get(pathKey(target));
      if (!other || other === n) continue;
      const id = [pathKey(n.path), pathKey(other.path)].sort().join("→");
      if (added.has(id)) continue;
      added.add(id);
      out.push({ a: n, b: other });
    }
  }
  return out;
}

/** The active note in the middle, everything it links to and everything that
 * links to it arranged in a ring, with links between neighbours drawn too. */
function localGraph(centerPath: string, resolver: VaultResolver) {
  const outgoing = resolver.outgoingFor(centerPath);
  const incoming = resolver.backlinksFor(centerPath).map((b) => b.path);
  const seen = new Set<string>([pathKey(centerPath)]);
  const neighbours: string[] = [];
  for (const p of [...outgoing, ...incoming]) {
    const key = pathKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    neighbours.push(p);
    if (neighbours.length >= MAX_NEIGHBOURS) break;
  }

  const nodes: Node[] = [
    { path: centerPath, label: basename(centerPath), x: 0, y: 0, center: true },
  ];
  const radius = neighbours.length <= 8 ? 140 : 180;
  neighbours.forEach((p, i) => {
    const angle = (i / neighbours.length) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      path: p,
      label: basename(p),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      center: false,
    });
  });
  return {
    nodes,
    edges: edgesAmong(nodes, resolver),
    viewBox: "-240 -220 480 440",
    truncated: 0,
  };
}

/** Every note in the vault under a force layout; capped by link degree so a
 * big vault stays readable. */
function vaultGraph(centerPath: string, resolver: VaultResolver) {
  const outgoingOf = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const f of resolver.files) {
    const out = resolver.outgoingFor(f.path);
    outgoingOf.set(pathKey(f.path), out);
    degree.set(pathKey(f.path), (degree.get(pathKey(f.path)) ?? 0) + out.length);
    for (const t of out) degree.set(pathKey(t), (degree.get(pathKey(t)) ?? 0) + 1);
  }

  let picked = resolver.files;
  const truncated = Math.max(0, resolver.files.length - MAX_VAULT_NODES);
  if (truncated > 0) {
    picked = [...resolver.files]
      .sort(
        (a, b) =>
          (degree.get(pathKey(b.path)) ?? 0) - (degree.get(pathKey(a.path)) ?? 0) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, MAX_VAULT_NODES);
    if (!picked.some((f) => pathKey(f.path) === pathKey(centerPath))) {
      const cur = resolver.byPath(centerPath);
      if (cur) picked[picked.length - 1] = cur;
    }
  }

  const indexOf = new Map<string, number>();
  picked.forEach((f, i) => indexOf.set(pathKey(f.path), i));
  const edgePairs: [number, number][] = [];
  const added = new Set<string>();
  picked.forEach((f, i) => {
    for (const t of outgoingOf.get(pathKey(f.path)) ?? []) {
      const j = indexOf.get(pathKey(t));
      if (j === undefined || j === i) continue;
      const id = [Math.min(i, j), Math.max(i, j)].join("→");
      if (added.has(id)) continue;
      added.add(id);
      edgePairs.push([i, j]);
    }
  });

  const pts = forceLayout(picked.length, edgePairs);
  const nodes: Node[] = picked.map((f, i) => ({
    path: f.path,
    label: basename(f.path),
    x: pts[i].x,
    y: pts[i].y,
    center: pathKey(f.path) === pathKey(centerPath),
  }));
  // The layout's edge pairs double as the drawn lines — one resolution pass.
  const edges: Edge[] = edgePairs.map(([i, j]) => ({ a: nodes[i], b: nodes[j] }));
  return { nodes, edges, viewBox: layoutViewBox(pts), truncated };
}

/** Graph modal with two scopes: the current note's neighbourhood, or the whole
 * vault. Click a node to open it (the graph re-centres). */
export function GraphView({
  centerPath,
  resolver,
  onOpen,
  onClose,
}: {
  centerPath: string;
  resolver: VaultResolver;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<GraphMode>("local");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { nodes, edges, viewBox, truncated } = useMemo(
    () =>
      mode === "local" ? localGraph(centerPath, resolver) : vaultGraph(centerPath, resolver),
    [mode, centerPath, resolver],
  );

  return (
    <div
      className="modal-overlay graph-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card graph-card" role="dialog" aria-label="Graph">
        <header className="modal-head">
          <h2>Graph</h2>
          <div className="seg-choice graph-mode" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "local"}
              className={mode === "local" ? "active" : ""}
              onClick={() => setMode("local")}
            >
              Local
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "vault"}
              className={mode === "vault" ? "active" : ""}
              onClick={() => setMode("vault")}
            >
              Vault
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="graph-body">
          {nodes.length <= 1 && mode === "local" ? (
            <p className="graph-empty">
              No links yet. Add a <code>[[wiki link]]</code> to another note and it will show up
              here.
            </p>
          ) : (
            <>
              <svg viewBox={viewBox} className="graph-svg">
                {edges.map((e, i) => (
                  <line
                    key={i}
                    className="graph-edge"
                    x1={e.a.x}
                    y1={e.a.y}
                    x2={e.b.x}
                    y2={e.b.y}
                  />
                ))}
                {nodes.map((n) => (
                  <g
                    key={n.path}
                    className={"graph-node" + (n.center ? " center" : "")}
                    transform={`translate(${n.x}, ${n.y})`}
                    onClick={() => {
                      if (!n.center) onOpen(n.path);
                    }}
                  >
                    <circle r={n.center ? 11 : 7} />
                    <text y={n.center ? 26 : 20} textAnchor="middle">
                      {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
                    </text>
                  </g>
                ))}
              </svg>
              {mode === "vault" && truncated > 0 && (
                <p className="graph-note">
                  Showing the {MAX_VAULT_NODES} most-linked notes; {truncated} more are hidden.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
