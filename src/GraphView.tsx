import { useEffect, useMemo } from "react";
import { basename } from "./paths";
import { pathKey, type VaultResolver } from "./vault";

const MAX_NEIGHBOURS = 40;

type Node = { path: string; label: string; x: number; y: number; center: boolean };

/**
 * Local graph: the active note in the middle, everything it links to and
 * everything that links to it arranged in a ring, with links between
 * neighbours drawn too. Click a node to open it (the graph re-centres).
 */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { nodes, edges } = useMemo(() => {
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

    const byKey = new Map(nodes.map((n) => [pathKey(n.path), n]));
    const edges: { a: Node; b: Node }[] = [];
    const added = new Set<string>();
    for (const n of nodes) {
      for (const target of resolver.outgoingFor(n.path)) {
        const other = byKey.get(pathKey(target));
        if (!other || other === n) continue;
        const id = [pathKey(n.path), pathKey(other.path)].sort().join("→");
        if (added.has(id)) continue;
        added.add(id);
        edges.push({ a: n, b: other });
      }
    }
    return { nodes, edges };
  }, [centerPath, resolver]);

  return (
    <div
      className="modal-overlay graph-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card graph-card" role="dialog" aria-label="Local graph">
        <header className="modal-head">
          <h2>Local graph</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="graph-body">
          {nodes.length === 1 ? (
            <p className="graph-empty">
              No links yet. Add a <code>[[wiki link]]</code> to another note and it will show up
              here.
            </p>
          ) : (
            <svg viewBox="-240 -220 480 440" className="graph-svg">
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
          )}
        </div>
      </div>
    </div>
  );
}
