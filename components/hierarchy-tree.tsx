"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

export type HierarchyTreeNode = {
  id: string;
  role: string;
  code: string;
  name: string;
  parentId: string | null;
  status: string;
  detailHref: string;
  hostCount: number;
  liveMinutes: number;
  sessions: number;
  giftValue: number;
};

function compact(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function HierarchyTree({ nodes: initialNodes }: { nodes: HierarchyTreeNode[] }) {
  const [hostPages, setHostPages] = useState<Record<string, { nodes: HierarchyTreeNode[]; page: number; hasNext: boolean }>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const nodes = useMemo(() => [...initialNodes, ...Object.values(hostPages).flatMap((value) => value.nodes)], [initialNodes, hostPages]);
  const roots = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    return nodes.filter((node) => !node.parentId || !ids.has(node.parentId));
  }, [nodes]);
  const children = useMemo(() => {
    const result = new Map<string, HierarchyTreeNode[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      result.set(node.parentId, [...(result.get(node.parentId) ?? []), node]);
    }
    return result;
  }, [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.map((node) => node.id)));
  const [query, setQuery] = useState("");
  const visibleForSearch = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return null;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visible = new Set<string>();
    for (const node of nodes) {
      if (!node.code.includes(cleaned) && !node.name.toLowerCase().includes(cleaned)) continue;
      let current: HierarchyTreeNode | undefined = node;
      while (current) {
        visible.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return visible;
  }, [nodes, query]);

  async function loadHosts(id: string, page = 1) {
    setLoading(id); setLoadError("");
    try {
      const response = await fetch(`/api/hierarchy/${encodeURIComponent(id)}/hosts?page=${page}`);
      if (!response.ok) throw new Error("Hosts could not be loaded. Try expanding this Agency again.");
      const data = await response.json() as { nodes: HierarchyTreeNode[]; page: number; hasNext: boolean };
      setHostPages((current) => ({ ...current, [id]: { ...data, nodes: page === 1 ? data.nodes : [...(current[id]?.nodes ?? []), ...data.nodes] } }));
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Hosts could not be loaded."); }
    finally { setLoading(null); }
  }

  function toggle(node: HierarchyTreeNode) {
    const id = node.id;
    if (!expanded.has(id) && node.role === "AGENCY" && node.hostCount > 0 && !hostPages[id]) void loadHosts(id);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function branch(node: HierarchyTreeNode, depth: number): React.ReactNode {
    if (visibleForSearch && !visibleForSearch.has(node.id)) return null;
    const nodeChildren = children.get(node.id) ?? [];
    const hasChildren = nodeChildren.length > 0 || (node.role === "AGENCY" && node.hostCount > 0);
    const open = visibleForSearch ? true : expanded.has(node.id);
    return <div className="hierarchy-branch" key={node.id}>
      <div className="hierarchy-node" style={{ "--tree-depth": depth } as React.CSSProperties}>
        <button
          className="hierarchy-toggle"
          type="button"
          aria-label={hasChildren ? `${open ? "Collapse" : "Expand"} ${node.name}` : `${node.name} has no children`}
          disabled={!hasChildren}
          onClick={() => toggle(node)}
        >{hasChildren ? open ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span className="role-dot" />}</button>
        <div className="hierarchy-identity">
          <Link href={node.detailHref}>{node.name}</Link>
          <small>{node.role.replaceAll("_", " ")} · <span className="mono">{node.code}</span></small>
        </div>
        <div className="hierarchy-performance" aria-label="30 day performance">
          <span><b>{node.hostCount}</b> hosts</span>
          <span><b>{compact(node.liveMinutes)}</b> live min</span>
          <span><b>{compact(node.giftValue)}</b> gift value</span>
        </div>
        <span className={`badge ${node.status === "ACTIVE" || node.status === "APPROVED" ? "badge-success" : "badge-neutral"}`}>{node.status}</span>
      </div>
      {open && nodeChildren.map((child) => branch(child, depth + 1))}
      {open && loading === node.id ? <p className="form-note" role="status">Loading hosts…</p> : null}
      {open && hostPages[node.id]?.hasNext ? <button className="secondary-button" type="button" disabled={loading === node.id} onClick={() => void loadHosts(node.id, hostPages[node.id].page + 1)}>Load more hosts</button> : null}
    </div>;
  }

  return <>
    {loadError ? <p role="alert">{loadError}</p> : null}
    <p className="form-note">Expand an Agency to load its hosts. Search here finds team accounts and already-loaded hosts; use Hosts for platform-wide host search.</p>
    <label className="hierarchy-search">
      <Search size={16} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value.replace(/[^\dA-Za-z ]/g, ""))}
        placeholder="Search by 6-digit Management ID or name"
        inputMode="search"
        aria-label="Search hierarchy"
      />
    </label>
    {visibleForSearch?.size === 0
      ? <p className="hierarchy-no-match">No entity in your permitted branch matches that ID.</p>
      : <div className="hierarchy-tree">{roots.map((root) => branch(root, 0))}</div>}
  </>;
}
