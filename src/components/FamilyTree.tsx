'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { RawNodeDatum, CustomNodeElementProps } from 'react-d3-tree';

const Tree = dynamic(
  () => import('react-d3-tree').then((m) => ({ default: m.Tree })),
  { ssr: false }
);

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Person {
  id: string;
  full_name: string;
  alt_name: string;
  parent_id: string | null;
  tooltip: string;
  image_url: string;
}

interface Spouse {
  id: string;
  full_name: string;
  alt_name: string;
  person_id: string;
  image_url: string;
}

interface Link {
  id: number;
  person_id: string;
  url: string;
  description: string;
  display_html: string;
}

interface Props {
  people: Person[];
  spouses: Spouse[];
  links: Link[];
}

// ─── Generation color palette ─────────────────────────────────────────────────

const GEN_COLORS = [
  { border: '#7c3aed', bg: '#f5f3ff', text: '#4c1d95', label: 'Generation 1' },
  { border: '#2563eb', bg: '#eff6ff', text: '#1e3a8a', label: 'Generation 2' },
  { border: '#0891b2', bg: '#ecfeff', text: '#164e63', label: 'Generation 3' },
  { border: '#059669', bg: '#ecfdf5', text: '#064e3b', label: 'Generation 4' },
  { border: '#d97706', bg: '#fffbeb', text: '#78350f', label: 'Generation 5' },
  { border: '#e11d48', bg: '#fff1f2', text: '#881337', label: 'Generation 6' },
  { border: '#4f46e5', bg: '#eef2ff', text: '#312e81', label: 'Generation 7' },
  { border: '#c026d3', bg: '#fdf4ff', text: '#701a75', label: 'Generation 8' },
];
function getGenColor(gen: number) {
  return GEN_COLORS[Math.max(0, gen) % GEN_COLORS.length];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEHOLDER =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyNSIgY3k9IjI1IiByPSIyNSIgZmlsbD0iI2U1ZDRiNCIvPjxjaXJjbGUgY3g9IjI1IiBjeT0iMjAiIHI9IjkiIGZpbGw9IiNhMzZhMjAiLz48cGF0aCBkPSJNOCA0NGMwLTkuOTQgNy42Mi0xOCAxNy0xOHMxNyA4LjA2IDE3IDE4IiBmaWxsPSIjYTM2YTIwIi8+PC9zdmc+';

const NODE_WIDTH = 200;
const NODE_HEIGHT_BASE = 90;
const NODE_HEIGHT_SPOUSE = 140;
const SEARCH_ZOOM = 1.2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isGenNode = (id: string) => /^Generation_\d+$/i.test(id);

/**
 * Compute generation number (0-indexed) purely from tree depth.
 * Roots (no parent, or parent is a Generation_X placeholder) = 0.
 * Each level of children adds 1.
 */
function computeGenerations(people: Person[]): Map<string, number> {
  const visible = people.filter((p) => !isGenNode(p.id));
  const visibleIds = new Set(visible.map((p) => p.id));

  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];

  for (const p of visible) {
    const parentIsVisible = p.parent_id && visibleIds.has(p.parent_id);
    if (parentIsVisible) {
      const arr = childrenOf.get(p.parent_id!) ?? [];
      arr.push(p.id);
      childrenOf.set(p.parent_id!, arr);
    } else {
      roots.push(p.id);
    }
  }

  // Build a lookup so we can check parent_ids for roots
  const personById = new Map(visible.map((p) => [p.id, p]));

  const genMap = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = roots.map((id) => {
    // If this root's parent is a Generation_X placeholder, seed its depth
    // from the number in that id (e.g. Generation_4 → depth 3, i.e. Gen 4)
    const parentId = personById.get(id)?.parent_id ?? '';
    const genMatch = parentId.match(/^Generation_(\d+)$/i);
    const startDepth = genMatch ? parseInt(genMatch[1]) - 1 : 0;
    return { id, depth: startDepth };
  });

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    genMap.set(id, depth);
    for (const childId of childrenOf.get(id) ?? []) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }

  return genMap;
}

// ─── Tree data builder ────────────────────────────────────────────────────────

interface TreeNode extends RawNodeDatum {
  attributes: { personId: string; generation: number; hasSpouse: boolean; highlighted: boolean };
  children?: TreeNode[];
}

function buildTreeData(
  people: Person[],
  spouseMap: Map<string, Spouse>,
  genMap: Map<string, number>,
  highlightedId: string | null
): TreeNode[] {
  const visible = people.filter((p) => !isGenNode(p.id));
  const visibleIds = new Set(visible.map((p) => p.id));
  const nodeMap = new Map<string, TreeNode>();

  for (const p of visible) {
    nodeMap.set(p.id, {
      name: p.full_name,
      attributes: {
        personId: p.id,
        generation: genMap.get(p.id) ?? 0,
        hasSpouse: spouseMap.has(p.id),
        highlighted: p.id === highlightedId,
      },
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const p of visible) {
    const node = nodeMap.get(p.id)!;
    if (p.parent_id && visibleIds.has(p.parent_id)) {
      nodeMap.get(p.parent_id)?.children?.push(node);
    } else {
      roots.push(node);
    }
  }

  if (roots.length === 0) return [];
  if (roots.length === 1) return [roots[0]];

  return [
    {
      name: 'Family',
      attributes: { personId: '__root__', generation: -1, hasSpouse: false, highlighted: false },
      children: roots,
    },
  ];
}

// ─── CSS keyframes ────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes highlightPulse {
    0%, 100% { box-shadow: 0 0 0 3px #f59e0b, 0 0 20px 6px #f59e0baa; }
    50%       { box-shadow: 0 0 0 5px #f59e0b, 0 0 32px 12px #f59e0b88; }
  }
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
`;

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  person: Person;
  spouse: Spouse | undefined;
  links: Link[];
  genLabel: string;
  onClose: () => void;
}

function DetailPanel({ person, spouse, links, genLabel, onClose }: DetailPanelProps) {
  const personImg = person.image_url?.trim() ? person.image_url : PLACEHOLDER;
  const spouseImg = spouse?.image_url?.trim() ? spouse.image_url : PLACEHOLDER;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 30,
          background: 'rgba(0,0,0,0.25)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: '320px',
          background: 'white', zIndex: 31, overflowY: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          animation: 'slideIn 0.22s ease-out',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>
            {genLabel}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8', lineHeight: 1, padding: '2px 4px' }}
            title="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px 16px', flex: 1 }}>
          {/* Person photo + name */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 20 }}>
            <img
              src={personImg}
              alt={person.full_name}
              width={96} height={96}
              style={{ borderRadius: '50%', objectFit: 'cover', border: '3px solid #e2e8f0', marginBottom: 12 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
            />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
              {person.full_name}
            </h2>
            {person.alt_name?.trim() && (
              <div style={{ marginTop: 4, fontSize: 13, fontStyle: 'italic', color: '#64748b' }}>
                ({person.alt_name.trim()})
              </div>
            )}
          </div>

          {/* Spouse */}
          {spouse && (
            <div style={{
              background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10,
              padding: '12px 14px', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <img
                src={spouseImg}
                alt={spouse.full_name}
                width={48} height={48}
                style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #e11d48', flexShrink: 0 }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
              />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#e11d48', marginBottom: 2 }}>
                  ♥ Spouse
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#881337' }}>
                  {spouse.full_name}
                </div>
                {spouse.alt_name?.trim() && (
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: '#be185d', marginTop: 2 }}>
                    ({spouse.alt_name.trim()})
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Links */}
          {links.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 10 }}>
                Links & Resources
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {links.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                      padding: '10px 12px', textDecoration: 'none',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.background = '#eff6ff';
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = '#93c5fd';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.background = '#f8fafc';
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = '#e2e8f0';
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>🔗</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e40af', lineHeight: 1.3 }}>
                        {link.description || 'View link'}
                      </div>
                      {link.display_html && (
                        <div
                          style={{ fontSize: 11, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}
                          dangerouslySetInnerHTML={{ __html: link.display_html }}
                        />
                      )}
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, wordBreak: 'break-all' }}>
                        {link.url}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!spouse && links.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 20 }}>
              No additional information recorded yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FamilyTree({ people, spouses, links }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(0.5);
  const [translate, setTranslate] = useState({ x: 0, y: 60 });
  const [search, setSearch] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const highlightedPosRef = useRef<{ x: number; y: number } | null>(null);

  const INITIAL_ZOOM = 0.5;

  const spouseMap = new Map(spouses.map((s) => [s.person_id, s]));
  const linksMap = new Map<string, Link[]>();
  for (const link of links) {
    const arr = linksMap.get(link.person_id) ?? [];
    arr.push(link);
    linksMap.set(link.person_id, arr);
  }

  const genMap = computeGenerations(people);
  const treeData = buildTreeData(people, spouseMap, genMap, highlightedId);

  const presentGenerations = new Set<number>();
  for (const p of people) {
    if (!isGenNode(p.id)) {
      const g = genMap.get(p.id);
      if (g !== undefined) presentGenerations.add(g % GEN_COLORS.length);
    }
  }

  useEffect(() => {
    setMounted(true);
    if (containerRef.current) {
      setTranslate({ x: containerRef.current.clientWidth / 2, y: 60 });
    }
  }, []);

  // Pan & zoom to highlighted node
  useEffect(() => {
    if (!highlightedId || !containerRef.current) return;
    const timer = setTimeout(() => {
      const pos = highlightedPosRef.current;
      if (!pos) return;
      const cw = containerRef.current!.clientWidth;
      const ch = containerRef.current!.clientHeight;
      setZoom(SEARCH_ZOOM);
      setTranslate({
        x: cw / 2 - pos.x * SEARCH_ZOOM,
        y: ch / 2 - pos.y * SEARCH_ZOOM,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  function handleReset() {
    setZoom(INITIAL_ZOOM);
    setTranslate({ x: (containerRef.current?.clientWidth ?? 800) / 2, y: 60 });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term) { setHighlightedId(null); return; }
    const match = people.find(
      (p) => !isGenNode(p.id) && (
        p.full_name.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term)
      )
    );
    if (match) {
      highlightedPosRef.current = null;
      setHighlightedId(match.id);
    } else {
      setHighlightedId(null);
      alert(`No person found matching "${search}"`);
    }
  }

  // ── Custom node renderer ──────────────────────────────────────────────────

  function renderNode({ nodeDatum, toggleNode, hierarchyPointNode }: CustomNodeElementProps): JSX.Element {
    const personId = (nodeDatum.attributes?.personId as string) ?? '';

    if (personId === '__root__') {
      return (
        <g>
          <circle r={1} fill="transparent" stroke="transparent" onClick={toggleNode} style={{ cursor: 'pointer' }} />
        </g>
      );
    }

    const generation = (nodeDatum.attributes?.generation as number) ?? 0;
    const colors = getGenColor(generation);
    const spouse = spouseMap.get(personId);
    const nodeHeight = spouse ? NODE_HEIGHT_SPOUSE : NODE_HEIGHT_BASE;
    const isHighlighted = (nodeDatum.attributes?.highlighted as boolean) ?? false;

    if (isHighlighted && hierarchyPointNode) {
      highlightedPosRef.current = { x: hierarchyPointNode.x, y: hierarchyPointNode.y };
    }

    const rd3t = (nodeDatum as unknown as { __rd3t?: { collapsed?: boolean } }).__rd3t;
    const isCollapsed = !!(rd3t?.collapsed);
    const childCount = nodeDatum.children?.length ?? 0;
    const hasHiddenChildren = isCollapsed && childCount > 0;

    const person = people.find((p) => p.id === personId);
    const personImg = person?.image_url?.trim() ? person.image_url : PLACEHOLDER;
    const spouseImg = spouse?.image_url?.trim() ? spouse.image_url : PLACEHOLDER;
    const altName = person?.alt_name?.trim() ?? '';

    const personLinks = linksMap.get(personId) ?? [];
    const hasDetails = !!(spouse || personLinks.length > 0);

    return (
      <g>
        <foreignObject
          x={-NODE_WIDTH / 2}
          y={-nodeHeight / 2}
          width={NODE_WIDTH}
          height={nodeHeight + (hasHiddenChildren ? 30 : 10)}
          style={{ overflow: 'visible' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${NODE_WIDTH}px` }}>
            {/* Main card */}
            <div
              onClick={toggleNode}
              style={{
                background: isHighlighted ? '#fef3c7' : colors.bg,
                border: isHighlighted ? '2px solid #f59e0b' : `1px solid ${colors.border}`,
                borderLeft: isHighlighted ? '5px solid #f59e0b' : `4px solid ${colors.border}`,
                borderRadius: '10px',
                padding: '8px 10px 8px 12px',
                width: `${NODE_WIDTH}px`,
                boxSizing: 'border-box',
                cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
                position: 'relative',
                animation: isHighlighted ? 'highlightPulse 1.4s ease-in-out infinite' : 'none',
                boxShadow: isHighlighted
                  ? '0 0 0 3px #f59e0b, 0 0 20px 6px #f59e0baa'
                  : '0 1px 4px rgba(0,0,0,0.12)',
              }}
            >
              {/* "Found" badge */}
              {isHighlighted && (
                <div style={{
                  position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)',
                  background: '#f59e0b', color: 'white', fontSize: '9px', fontWeight: 800,
                  padding: '2px 8px', borderRadius: '99px', letterSpacing: '0.1em',
                  textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }}>
                  ★ Found
                </div>
              )}

              {/* Gen badge */}
              <div style={{
                position: 'absolute', top: '5px', right: '8px',
                fontSize: '9px', fontWeight: 700, color: isHighlighted ? '#92400e' : colors.border,
                letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.8,
              }}>
                {colors.label}
              </div>

              {/* Info button — only if there's something to show */}
              {hasDetails && (
                <div
                  onClick={(e) => { e.stopPropagation(); setSelectedPersonId(personId); }}
                  title="View details"
                  style={{
                    position: 'absolute', bottom: '6px', right: '8px',
                    width: 18, height: 18, borderRadius: '50%',
                    background: colors.border, color: 'white',
                    fontSize: '10px', fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0, lineHeight: 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    userSelect: 'none',
                  }}
                >
                  i
                </div>
              )}

              {/* Person row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <img
                  src={personImg}
                  alt={nodeDatum.name}
                  width={40} height={40}
                  style={{
                    borderRadius: '50%', objectFit: 'cover',
                    border: isHighlighted ? '2px solid #f59e0b' : `2px solid ${colors.border}`,
                    flexShrink: 0,
                  }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
                />
                <div style={{ minWidth: 0, paddingRight: hasDetails ? '20px' : '0' }}>
                  <div style={{
                    fontWeight: 700, fontSize: '12px',
                    color: isHighlighted ? '#78350f' : colors.text,
                    wordBreak: 'break-word', lineHeight: 1.3,
                  }}>
                    {nodeDatum.name}
                  </div>
                  {altName && (
                    <div style={{
                      fontSize: '10px', fontStyle: 'italic',
                      color: isHighlighted ? '#a16207' : colors.border,
                      opacity: 0.85, marginTop: '1px', lineHeight: 1.2,
                    }}>
                      ({altName})
                    </div>
                  )}
                </div>
              </div>

              {/* Spouse row */}
              {spouse && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '6px', borderTop: `1px dashed ${isHighlighted ? '#f59e0b88' : colors.border + '66'}` }}>
                  <span style={{ fontSize: '13px', color: '#e11d48', flexShrink: 0 }}>♥</span>
                  <img
                    src={spouseImg}
                    alt={spouse.full_name}
                    width={32} height={32}
                    style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #e11d48', flexShrink: 0 }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
                  />
                  <div>
                    <div style={{ fontSize: '11px', fontStyle: 'italic', color: '#be185d', wordBreak: 'break-word', lineHeight: 1.3 }}>
                      {spouse.full_name}
                    </div>
                    {spouse.alt_name?.trim() && (
                      <div style={{ fontSize: '9px', color: '#e11d48', opacity: 0.75, lineHeight: 1.2 }}>
                        ({spouse.alt_name.trim()})
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Collapsed children badge */}
            {hasHiddenChildren && (
              <div
                onClick={toggleNode}
                style={{
                  marginTop: '4px',
                  background: colors.border,
                  color: 'white',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '99px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  letterSpacing: '0.03em',
                }}
              >
                <span style={{ fontSize: '8px' }}>▼</span>
                {childCount} {childCount === 1 ? 'child' : 'children'} hidden
              </div>
            )}
          </div>
        </foreignObject>
      </g>
    );
  }

  // ── Detail panel data ─────────────────────────────────────────────────────

  const selectedPerson = selectedPersonId
    ? people.find((p) => p.id === selectedPersonId) ?? null
    : null;
  const selectedGenIndex = selectedPersonId ? (genMap.get(selectedPersonId) ?? 0) : 0;
  const selectedGenLabel = GEN_COLORS[selectedGenIndex % GEN_COLORS.length]?.label ?? '';

  // ── Legend ────────────────────────────────────────────────────────────────

  const legendItems = GEN_COLORS.filter((_, i) => presentGenerations.has(i));

  return (
    <div className="w-full">
      <style>{GLOBAL_STYLES}</style>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4 max-w-sm">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 border border-tan-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
        />
        <button type="submit" className="bg-accent-600 hover:bg-accent-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
          Find
        </button>
        {highlightedId && (
          <button type="button" onClick={() => { setHighlightedId(null); setSearch(''); }} className="text-sm text-tan-400 hover:text-tan-600 px-2">
            ✕
          </button>
        )}
      </form>

      {/* Tree container */}
      <div
        ref={containerRef}
        className="w-full rounded-xl border border-tan-200 bg-white shadow-sm overflow-hidden"
        style={{ height: '80vh', minHeight: '500px', position: 'relative' }}
      >
        {/* Spinner */}
        {!mounted && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', zIndex: 10 }}>
            <div style={{ width: 40, height: 40, border: '4px solid #e2e8f0', borderTop: '4px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ marginLeft: 12, fontSize: 14, color: '#94a3b8' }}>Loading tree…</span>
          </div>
        )}

        {/* Zoom controls */}
        {mounted && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { label: '+', action: () => setZoom((z) => Math.min(z + 0.15, 3)) },
              { label: '−', action: () => setZoom((z) => Math.max(z - 0.15, 0.05)) },
              { label: '⌂', action: handleReset },
            ].map(({ label, action }) => (
              <button key={label} onClick={action}
                title={label === '⌂' ? 'Reset view' : label === '+' ? 'Zoom in' : 'Zoom out'}
                style={{ width: 32, height: 32, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: label === '⌂' ? 16 : 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', color: '#374151' }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Legend */}
        {mounted && legendItems.length > 0 && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, background: 'rgba(255,255,255,0.95)', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', minWidth: 140 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 6 }}>
              Generations
            </div>
            {legendItems.map((g, i) => (
              <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < legendItems.length - 1 ? 5 : 0 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: g.bg, border: `2px solid ${g.border}`, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: g.text, fontWeight: 600 }}>{g.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tree */}
        {mounted && treeData.length > 0 && (
          <Tree
            data={treeData[0]}
            orientation="vertical"
            renderCustomNodeElement={renderNode}
            nodeSize={{ x: 220, y: 200 }}
            separation={{ siblings: 1.1, nonSiblings: 1.5 }}
            zoom={zoom}
            translate={translate}
            onUpdate={({ zoom: z, translate: t }) => {
              setZoom(z as number);
              setTranslate(t as { x: number; y: number });
            }}
            pathFunc="step"
            enableLegacyTransitions={false}
          />
        )}

        {/* Empty state */}
        {mounted && people.filter((p) => !isGenNode(p.id)).length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <span style={{ fontSize: 48, marginBottom: 12 }}>🌳</span>
            <p style={{ margin: 0 }}>No family members yet.</p>
          </div>
        )}

        {/* Detail panel (rendered inside the tree container so it overlays the tree) */}
        {mounted && selectedPerson && (
          <DetailPanel
            person={selectedPerson}
            spouse={spouseMap.get(selectedPerson.id)}
            links={linksMap.get(selectedPerson.id) ?? []}
            genLabel={selectedGenLabel}
            onClose={() => setSelectedPersonId(null)}
          />
        )}
      </div>
    </div>
  );
}
