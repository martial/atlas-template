import { useMemo, useRef, useState, useEffect } from "react";
import {
  IconButton,
  Tooltip,
  Button,
  Switch,
  FormControlLabel,
} from "@mui/material";
import {
  Add,
  Remove,
  CenterFocusWeak,
  OpenInFull,
  CloseFullscreen,
  HubOutlined,
} from "@mui/icons-material";
import { groups } from "../data";
import type { Asset, Point, MapSnapshot } from "../types";

export default function MapView({
  assets,
  snapshot,
  selected,
  matches,
  lens,
  onSelect,
}: {
  assets: Asset[];
  snapshot: MapSnapshot;
  selected?: string;
  matches: Set<string>;
  lens: string;
  onSelect: (a: Asset) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [links, setLinks] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState<Asset | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const points = snapshot.points;
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const connected = useMemo(() => {
    const byPoint = new Map(points.map((p) => [p.id, p]));
    return snapshot.edges.flatMap(([a, b]) =>
      byPoint.has(a) && byPoint.has(b)
        ? [[byPoint.get(a)!, byPoint.get(b)!] as [Point, Point]]
        : [],
    );
  }, [snapshot]);
  const thumbnails = useMemo(
    () =>
      assets
        .filter(
          (a) =>
            a.image &&
            a.status === "indexed" &&
            points.some((p) => p.asset === a.id),
        )
        .slice(0, 8)
        .map((a, i) => ({
          a,
          point: points.find((p) => p.asset === a.id)!,
          dx: i % 2 === 0 ? -25 : 15,
        })),
    [assets, points],
  );
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({
        ...v,
        z: Math.max(0.6, Math.min(2.8, v.z * (e.deltaY < 0 ? 1.07 : 0.93))),
      }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === canvas.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const pick = (id: string) => {
    if (drag.current?.moved) return;
    const a = byId.get(id);
    if (a && matches.has(id)) onSelect(a);
  };
  const zoom = (delta: number) =>
    setView((v) => ({ ...v, z: Math.max(0.6, Math.min(2.8, v.z + delta)) }));
  return (
    <div className="map-surface" ref={canvas}>
      <div className="map-corner-label">
        <HubOutlined sx={{ fontSize: 15 }} />
        <span>Similarity map</span>
        <span className="quiet-dot" />
        {points.length} moments & passages
      </div>
      <svg
        ref={svg}
        viewBox="0 0 1000 740"
        className="map-svg"
        aria-label="Interactive similarity map. Use the Files tab for a keyboard-accessible list."
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-point]")) return;
          svg.current?.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            ox: view.x,
            oy: view.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !svg.current) return;
          const d = drag.current;
          const scale = 1000 / svg.current.getBoundingClientRect().width;
          d.moved ||= Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4;
          setView((v) => ({
            ...v,
            x: d.ox + (e.clientX - d.x) * scale,
            y: d.oy + (e.clientY - d.y) * scale,
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern
            id="dots"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".8" fill="#d9e0e3" />
          </pattern>
        </defs>
        <rect width="1000" height="740" fill="url(#dots)" />
        <g
          transform={`translate(${view.x + 500 * (1 - view.z)} ${view.y + 370 * (1 - view.z)}) scale(${view.z})`}
        >
          {links &&
            connected.map(([p, q]) => (
              <line
                key={`${p.id}-${q.id}`}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke={groups[p.group].color}
                strokeWidth=".7"
                opacity={
                  matches.has(p.asset) && matches.has(q.asset) ? 0.23 : 0.045
                }
              />
            ))}
          {points.map((p) => (
            <g
              key={p.id}
              data-point="true"
              role="button"
              tabIndex={matches.has(p.asset) ? 0 : -1}
              aria-label={`${byId.get(p.asset)?.name}, part ${p.part + 1}`}
              onClick={() => pick(p.asset)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(p.asset);
                }
              }}
              onMouseEnter={() => setHovered(byId.get(p.asset) ?? null)}
              onMouseLeave={() => setHovered(null)}
              opacity={matches.has(p.asset) ? 1 : 0.12}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={p.asset === selected ? 9 : 8}
                fill="transparent"
              />
              {p.asset === selected && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="10"
                  fill="white"
                  stroke={groups[p.group].color}
                  strokeWidth="1.5"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={p.part === 0 ? 4.7 : 3.2}
                fill={groups[p.group].color}
              />
            </g>
          ))}
          {thumbnails.map(({ a, point, dx }) => (
            <g
              key={a.id}
              data-point="true"
              className="map-thumbnail"
              role="button"
              tabIndex={matches.has(a.id) ? 0 : -1}
              aria-label={`Preview ${a.name}`}
              onClick={() => pick(a.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(a.id);
                }
              }}
              onMouseEnter={() => setHovered(a)}
              onMouseLeave={() => setHovered(null)}
              opacity={matches.has(a.id) ? 1 : 0.12}
              transform={`translate(${point.x + dx} ${point.y - 20})`}
            >
              <rect
                x="-3"
                y="-3"
                width="82"
                height="59"
                rx="6"
                fill="white"
                stroke={selected === a.id ? "#176f63" : "#d4dce0"}
                strokeWidth={selected === a.id ? 2 : 1}
              />
              <image
                href={a.image}
                width="76"
                height="53"
                preserveAspectRatio="xMidYMid slice"
              />
              {a.kind === "video" && (
                <g>
                  <rect
                    x="48"
                    y="35"
                    width="23"
                    height="14"
                    rx="3"
                    fill="#152a32"
                    opacity=".8"
                  />
                  <path d="M57 39l6 3-6 3z" fill="white" />
                </g>
              )}
            </g>
          ))}
        </g>
      </svg>
      {hovered && (
        <div className="map-hover">
          <span
            className="legend-dot"
            style={{ background: groups[hovered.group].color }}
          />
          {hovered.name}
        </div>
      )}
      <div className="map-legend">
        {groups.map((g) => (
          <span key={g.name}>
            <i style={{ background: g.color }} />
            {g.name}
          </span>
        ))}
      </div>
      <div className="map-bottom">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={links}
              onChange={(e) => setLinks(e.target.checked)}
            />
          }
          label="Connections"
        />
        <span>{snapshot.method} · Drag to pan, scroll to zoom</span>
      </div>
      <div className="map-controls">
        <Tooltip title="Zoom in">
          <IconButton
            size="small"
            aria-label="Zoom in"
            onClick={() => zoom(0.15)}
          >
            <Add fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton
            size="small"
            aria-label="Zoom out"
            onClick={() => zoom(-0.15)}
          >
            <Remove fontSize="small" />
          </IconButton>
        </Tooltip>
        <span className="control-divider" />
        <Tooltip title="Fit to view">
          <IconButton
            size="small"
            aria-label="Fit map to view"
            onClick={() => setView({ x: 0, y: 0, z: 1 })}
          >
            <CenterFocusWeak fontSize="small" />
          </IconButton>
        </Tooltip>
        {document.fullscreenEnabled && (
          <Tooltip title="Full screen">
            <IconButton
              size="small"
              aria-label="Toggle full screen"
              onClick={() => {
                if (fullscreen) void document.exitFullscreen();
                else void canvas.current?.requestFullscreen();
              }}
            >
              {fullscreen ? (
                <CloseFullscreen fontSize="small" />
              ) : (
                <OpenInFull fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </div>
      {points.length === 0 && (
        <div className="empty-map">
          <HubOutlined sx={{ fontSize: 44 }} />
          <h2>Your collection starts here</h2>
          <p>Add files to start building a map of their connections.</p>
          <Button
            onClick={() => window.dispatchEvent(new Event("atlas-upload"))}
            variant="contained"
          >
            Upload files
          </Button>
        </div>
      )}
    </div>
  );
}
