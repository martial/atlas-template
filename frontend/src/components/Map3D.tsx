import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  FormControlLabel,
  IconButton,
  Switch,
  Tooltip,
} from "@mui/material";
import {
  Add,
  CenterFocusWeak,
  OpenInFull,
  Remove,
  ViewInArOutlined,
} from "@mui/icons-material";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { groups } from "../data";
import type { Asset, MapSnapshot } from "../types";

interface Props {
  assets: Asset[];
  snapshot: MapSnapshot;
  selected?: string;
  matches: Set<string>;
  lens: string;
  onSelect: (a: Asset) => void;
  onFallback: () => void;
}

export default function Map3D(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const pictures = useRef<(HTMLButtonElement | null)[]>([]);
  const [links, setLinks] = useState(true);
  const [error, setError] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [orbiting, setOrbiting] = useState(false);
  const live = useRef({ ...props, links });
  live.current = { ...props, links };
  const commands = useRef({
    zoom: (_amount: number) => {},
    reset: () => {},
    redraw: () => {},
  });
  // Selection and filters only update rendering; they must not reset the user's camera.
  const points = props.snapshot.points;
  const images = props.assets
    .filter(
      (a) =>
        a.image &&
        a.status === "indexed" &&
        points.some((p) => p.asset === a.id),
    )
    .slice(0, 8);
  const imageSignature = images.map((a) => a.id).join("|");

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(true);
      return;
    }
    setError(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#fafcfb", 1);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D collection map. Drag to orbit, scroll to zoom, or use Files for keyboard navigation.",
    );
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.tabIndex = 0;
    parent.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    const start = new THREE.Vector3(4.5, 3.2, 15.5);
    camera.position.copy(start);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 5;
    controls.maxDistance = 32;
    controls.target.set(0, 0, 0);
    controls.update();

    const positions = points.map(
      (p) => new THREE.Vector3((p.x - 500) / 60, (360 - p.y) / 60, p.z ?? 0),
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        positions.flatMap((p) => p.toArray()),
        3,
      ),
    );
    const colorArray = new Float32Array(points.length * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
    const disc = document.createElement("canvas");
    disc.width = 64;
    disc.height = 64;
    const ctx = disc.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(disc);
    const material = new THREE.PointsMaterial({
      size: 0.23,
      vertexColors: true,
      map: texture,
      transparent: true,
      alphaTest: 0.2,
      depthWrite: true,
    });
    const cloud = new THREE.Points(geometry, material);
    scene.add(cloud);
    const indices = new Map(points.map((p, i) => [p.id, i]));
    const edges: [number, number][] = props.snapshot.edges.flatMap(([a, b]) =>
      indices.has(a) && indices.has(b)
        ? [[indices.get(a)!, indices.get(b)!] as [number, number]]
        : [],
    );
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        edges.flatMap(([a, b]) => [
          ...positions[a].toArray(),
          ...positions[b].toArray(),
        ]),
        3,
      ),
    );
    const edgeColors = new Float32Array(edges.length * 6);
    lineGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(edgeColors, 3),
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);
    const markerGeometry = new THREE.SphereGeometry(0.14, 20, 12);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: "#176f63",
      wireframe: true,
      transparent: true,
      opacity: 0.65,
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    scene.add(marker);
    const grid = new THREE.GridHelper(20, 20, "#d9e3de", "#eaf0ec");
    grid.position.y = -4.5;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    scene.add(grid);
    const color = new THREE.Color();
    const muted = new THREE.Color("#e2e8e5");
    let width = 1,
      height = 1,
      active = true;
    function project(position: THREE.Vector3, el: HTMLElement | null) {
      if (!el) return;
      const p = position.clone().project(camera);
      el.style.transform = `translate(${(p.x * 0.5 + 0.5) * width}px, ${(-p.y * 0.5 + 0.5) * height}px) translate(-50%,-50%)`;
      el.style.visibility = p.z < 1 && p.z > -1 ? "visible" : "hidden";
      el.style.zIndex = String(Math.round((1 - p.z) * 1000));
    }
    function render() {
      if (!active) return;
      points.forEach((p, i) => {
        color.set(groups[p.group].color);
        if (!live.current.matches.has(p.asset)) color.lerp(muted, 0.86);
        color.toArray(colorArray, i * 3);
      });
      geometry.attributes.color.needsUpdate = true;
      edges.forEach(([a, b], i) => {
        color.set(groups[points[a].group].color);
        if (
          !live.current.matches.has(points[a].asset) ||
          !live.current.matches.has(points[b].asset)
        )
          color.copy(muted);
        color.toArray(edgeColors, i * 6);
        color.toArray(edgeColors, i * 6 + 3);
      });
      lineGeometry.attributes.color.needsUpdate = true;
      lines.visible = live.current.links;
      const selected = points.findIndex(
        (p) => p.asset === live.current.selected,
      );
      marker.visible =
        selected >= 0 && live.current.matches.has(live.current.selected ?? "");
      if (selected >= 0) marker.position.copy(positions[selected]);
      renderer.render(scene, camera);
      images.forEach((a, i) => {
        const pi = points.findIndex((p) => p.asset === a.id);
        if (pi >= 0) project(positions[pi], pictures.current[i]);
      });
    }
    const resize = () => {
      width = parent.clientWidth;
      height = parent.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.fov = THREE.MathUtils.radToDeg(
        2 *
          Math.atan(
            Math.tan(THREE.MathUtils.degToRad(43 / 2)) *
              Math.max(1, 1.25 / camera.aspect),
          ),
      );
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.15;
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    function hit(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const result = raycaster
        .intersectObject(cloud)
        .find(
          (h) =>
            h.index !== undefined &&
            live.current.matches.has(points[h.index].asset),
        );
      return result?.index === undefined
        ? undefined
        : live.current.assets.find((a) => a.id === points[result.index!].asset);
    }
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      setOrbiting(true);
    };
    const pointerUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const a = hit(e);
        if (a) live.current.onSelect(a);
      }
      down = null;
      setOrbiting(false);
    };
    const pointerCancel = () => {
      down = null;
      setOrbiting(false);
    };
    const pointerMove = (e: PointerEvent) => {
      if (down) return;
      const a = hit(e);
      renderer.domElement.style.cursor = a ? "pointer" : "grab";
      setHovered(a?.name ?? null);
    };
    const leave = () => {
      setHovered(null);
    };
    const keydown = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const offset = camera.position.clone().sub(controls.target);
        const s = new THREE.Spherical().setFromVector3(offset);
        if (e.key === "ArrowLeft") s.theta -= 0.12;
        if (e.key === "ArrowRight") s.theta += 0.12;
        if (e.key === "ArrowUp") s.phi = Math.max(0.1, s.phi - 0.12);
        if (e.key === "ArrowDown")
          s.phi = Math.min(Math.PI - 0.1, s.phi + 0.12);
        camera.position
          .copy(controls.target)
          .add(new THREE.Vector3().setFromSpherical(s));
        controls.update();
        render();
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("keydown", keydown);
    controls.addEventListener("change", render);
    commands.current = {
      reset: () => {
        controls.target.set(0, 0, 0);
        camera.position.copy(start);
        controls.update();
        render();
      },
      zoom: (amount: number) => {
        const d = camera.position.clone().sub(controls.target);
        const length = Math.max(
          controls.minDistance,
          Math.min(controls.maxDistance, d.length() * amount),
        );
        camera.position.copy(controls.target).add(d.setLength(length));
        controls.update();
        render();
      },
      redraw: render,
    };
    const lost = (e: Event) => {
      e.preventDefault();
      setError(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    resize();
    return () => {
      active = false;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("keydown", keydown);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      parent.replaceChildren();
      commands.current = { zoom: () => {}, reset: () => {}, redraw: () => {} };
    };
  }, [points, imageSignature, props.snapshot.version]);
  useEffect(() => {
    commands.current.redraw();
  }, [props.selected, props.matches, links]);

  return (
    <div
      className={`map-surface map-3d ${orbiting ? "is-orbiting" : ""}`}
      ref={surface}
    >
      <div className="map-corner-label">
        <ViewInArOutlined sx={{ fontSize: 15 }} />
        <span>3D similarity space</span>
        <span className="quiet-dot" />
        {points.length} moments & passages
      </div>
      <div className="three-host" ref={host} />
      {!error && (
        <div className="three-annotations">
          {images.map((a, i) => (
            <button
              key={a.id}
              ref={(el) => {
                pictures.current[i] = el;
              }}
              className={`three-thumbnail ${a.id === props.selected ? "selected" : ""}`}
              style={{ opacity: props.matches.has(a.id) ? 1 : 0.12 }}
              disabled={!props.matches.has(a.id)}
              aria-label={`Select ${a.name} in 3D`}
              onClick={() => props.onSelect(a)}
            >
              <img src={a.image} alt="" />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}
      {hovered && <div className="map-hover">{hovered}</div>}
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
        <span>{props.snapshot.method} · Drag to orbit · Shift-drag to pan</span>
      </div>
      <div className="map-controls">
        <Tooltip title="Zoom in">
          <IconButton
            size="small"
            aria-label="Zoom in 3D"
            onClick={() => commands.current.zoom(0.85)}
          >
            <Add fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton
            size="small"
            aria-label="Zoom out 3D"
            onClick={() => commands.current.zoom(1.15)}
          >
            <Remove fontSize="small" />
          </IconButton>
        </Tooltip>
        <span className="control-divider" />
        <Tooltip title="Reset view">
          <IconButton
            size="small"
            aria-label="Reset 3D view"
            onClick={() => commands.current.reset()}
          >
            <CenterFocusWeak fontSize="small" />
          </IconButton>
        </Tooltip>
        {document.fullscreenEnabled && (
          <Tooltip title="Full screen">
            <IconButton
              size="small"
              aria-label="Toggle 3D full screen"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void surface.current?.requestFullscreen();
              }}
            >
              <OpenInFull fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {error && (
        <div className="three-error">
          <Alert severity="info">
            3D rendering is unavailable in this browser. The 2D map contains the
            same files and connections.
          </Alert>
          <Button variant="outlined" onClick={props.onFallback}>
            Use the 2D map
          </Button>
        </div>
      )}
      {points.length === 0 && !error && (
        <div className="empty-map">
          <ViewInArOutlined sx={{ fontSize: 44 }} />
          <h2>Your collection starts here</h2>
          <p>Indexed files will appear in this space.</p>
          <Button
            variant="contained"
            onClick={() => window.dispatchEvent(new Event("atlas-upload"))}
          >
            Upload files
          </Button>
        </div>
      )}
    </div>
  );
}
