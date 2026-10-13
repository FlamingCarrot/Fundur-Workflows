"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Plan, PlanCamera, PlanItem, Point, Slice, ViewStyle } from "@/lib/plan/geometry";
import { buildScene, type SceneOptions } from "@/lib/plan/scene";
import { STANDARD, type Resolver } from "@/lib/blueprints/resolve";
import { cutFill, disposeObject, edgesFor, geometryFor, materialFor } from "./three/build";

/** Where the camera looks from. Axis views look straight at a side; iso views from a corner, above. */
export type ViewPreset = "iso" | "top" | "bottom" | "front" | "back" | "left" | "right" | "iso-ne" | "iso-nw" | "iso-se" | "iso-sw";
export type Projection = "perspective" | "orthographic";

/** Direct handles on the selected parts in the blueprint editor: move, turn about the vertical, or size. */
export type TransformMode = "translate" | "rotate" | "scale";
/** What a handle drag did, in the plan's terms: millimetres (x across, y back, z up), degrees anticlockwise, and size factors. */
export interface PartTransform {
  move: { x: number; y: number; z: number };
  turn: number;
  scale: { x: number; y: number; z: number };
}
/** A point in millimetres: x across, y back, z up, as the plan measures. */
export interface PointMm {
  x: number;
  y: number;
  z: number;
}
/** Editing a mesh's points in the 3D view: where they are, which are picked, and what to do with a tap or a drag. */
export interface PointEditing {
  at: PointMm[];
  edges: [number, number][];
  selected: number[];
  /** The grid moves snap to (mm); 0 for none. */
  snap: number;
  /** Other points a dragged point snaps onto (other parts' corners). */
  targets: PointMm[];
  onPick: (point: number | null, additive: boolean) => void;
  onMove: (points: number[], by: PointMm) => void;
}
/** Kept for screens that still pass the old camera names. */
export type CameraView = ViewPreset;

export const VIEW_PRESETS: { key: ViewPreset; label: string; short: string }[] = [
  { key: "iso", label: "3D view", short: "3D" },
  { key: "top", label: "Top", short: "Top" },
  { key: "front", label: "Front", short: "Front" },
  { key: "back", label: "Back", short: "Back" },
  { key: "left", label: "Left", short: "Left" },
  { key: "right", label: "Right", short: "Right" },
  { key: "bottom", label: "Bottom", short: "Bottom" },
  { key: "iso-sw", label: "From the south-west", short: "SW" },
  { key: "iso-se", label: "From the south-east", short: "SE" },
  { key: "iso-nw", label: "From the north-west", short: "NW" },
  { key: "iso-ne", label: "From the north-east", short: "NE" },
];

/** In three.js y is up and the plan's y runs along -z. */
const DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  iso: [1, 0.9, 1],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  "iso-se": [1, 0.8, 1],
  "iso-sw": [-1, 0.8, 1],
  "iso-ne": [1, 0.8, -1],
  "iso-nw": [-1, 0.8, -1],
};
const isAxisView = (v: ViewPreset) => !v.startsWith("iso");

export interface Pose {
  /** Plan mm; z is the absolute height above the ground floor. */
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  projection: Projection;
}

export interface CaptureOptions {
  width: number;
  height: number;
  style?: ViewStyle;
  /** Leaves out the grid and the section handles; on by default. */
  clean?: boolean;
  mime?: "image/png" | "image/jpeg";
}

export interface Plan3DApi {
  capture(options: CaptureOptions): string;
  pose(): Pose | null;
  /** Looks from a placed camera. */
  lookFrom(camera: Pick<PlanCamera, "eye" | "target" | "fov" | "projection">, elevation: number): void;
}

interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  model: THREE.Group;
  gizmos: THREE.Group;
  grid: THREE.GridHelper | null;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  bounds: THREE.Box3;
  width: number;
  height: number;
  origin?: Point;
  clipping: THREE.Plane[];
  environment: THREE.Texture | null;
  invalidate: () => void;
}

/** Turns a slice into a three.js clipping plane; points on its negative side are cut away. */
function planeFor(slice: Slice, origin: Point, plane = new THREE.Plane()): THREE.Plane {
  const k = slice.flip ? -1 : 1;
  if (slice.axis === "x") plane.set(new THREE.Vector3(-k, 0, 0), (k * (slice.at - origin.x)) / 1_000);
  else if (slice.axis === "y") plane.set(new THREE.Vector3(0, 0, k), (k * (slice.at - origin.y)) / 1_000);
  else plane.set(new THREE.Vector3(0, -k, 0), (k * slice.at) / 1_000);
  return plane;
}

function fit(runtime: Runtime, view: ViewPreset, projection: Projection) {
  const { bounds, width, height } = runtime;
  const box = bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5)) : bounds;
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const aspect = width / Math.max(height, 1);
  const direction = new THREE.Vector3(...DIRECTIONS[view]).normalize();
  // The model's corners seen along the view, so it fills the frame however long or flat it is.
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre),
  );
  const aim = (camera: Runtime["camera"]) => {
    if (view === "top" || view === "bottom") camera.up.set(0, 0, -1);
    camera.position.copy(centre).add(direction);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    return corners.map((c) => ({ x: c.dot(right), y: c.dot(up), z: c.dot(direction) }));
  };
  const margin = 1.08;
  let camera: Runtime["camera"];
  if (projection === "perspective") {
    camera = new THREE.PerspectiveCamera(42, aspect, Math.max(radius / 10_000, 0.001), radius * 200);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * aspect;
    const seen = aim(camera);
    const distance = Math.max(...seen.map((c) => c.z + Math.max(Math.abs(c.x) / tanH, Math.abs(c.y) / tanV) * margin), radius * 0.2);
    camera.position.copy(centre).addScaledVector(direction, distance);
  } else {
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, radius * 200);
    const seen = aim(camera);
    const half = Math.max(Math.max(...seen.map((c) => Math.abs(c.y))), Math.max(...seen.map((c) => Math.abs(c.x))) / aspect, 0.25) * margin;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    camera.position.copy(centre).addScaledVector(direction, radius * 4);
  }
  camera.lookAt(centre);
  applyCamera(runtime, camera, centre, radius, isAxisView(view) && projection === "orthographic");
}

function applyCamera(runtime: Runtime, camera: Runtime["camera"], target: THREE.Vector3, radius: number, flat: boolean) {
  const { controls } = runtime;
  runtime.camera = camera;
  controls.object = camera;
  controls.target.copy(target);
  // Flat drawings pan with one finger like the 2D plan; turning them stays on the right button.
  controls.mouseButtons.LEFT = flat ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = flat ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE = flat ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.minDistance = Math.max(radius / 200, 0.05);
  controls.maxDistance = radius * 40;
  controls.maxPolarAngle = Math.PI;
  controls.update();
  runtime.invalidate();
}

function highlight(state: Runtime, selection: PlanItem | null, selectionIds: string[], parts?: string[]) {
  state.model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.cutFill) return;
    const target = object.userData.target as PlanItem | undefined;
    if (!target) return;
    const path = object.userData.path as string[] | undefined;
    const picked = parts?.length
      ? !!path && parts.includes(path[0])
      : (selection?.kind === target.kind && selection.id === target.id) || (target.kind === "item" && selectionIds.includes(target.id));
    const material = object.material as THREE.Material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(picked ? "#678943" : "#000000");
      material.emissiveIntensity = picked ? 0.45 : 0;
    } else if (material instanceof THREE.MeshBasicMaterial && !material.transparent) material.color.set(picked ? "#d6e6c4" : "#ffffff");
    const edge = object.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | undefined;
    if (edge) {
      edge.material.color.set(picked ? "#548127" : edge.userData.baseColor ?? edge.material.color.getStyle());
      edge.userData.baseColor ??= edge.material.color.getStyle();
      edge.material.opacity = picked ? 1 : (edge.userData.baseOpacity ?? edge.material.opacity);
      edge.userData.baseOpacity ??= edge.material.opacity;
    }
  });
  state.invalidate();
}

function moveOrigin(state: Runtime, origin: Point) {
  if (state.origin) {
    const shift = new THREE.Vector3((state.origin.x - origin.x) / 1_000, 0, (origin.y - state.origin.y) / 1_000);
    state.camera.position.add(shift);
    state.controls.target.add(shift);
    state.controls.update();
  }
  state.origin = origin;
}

const AXIS_COLORS = { x: "#c4553b", y: "#3f7fb1", z: "#5d8f3a" } as const;

/** A see-through sheet where each section cuts, with a handle to drag it. */
function drawGizmos(state: Runtime, slices: Slice[], active: string | null) {
  disposeObject(state.gizmos);
  state.gizmos.clear();
  if (!state.origin || state.bounds.isEmpty()) return;
  const b = state.bounds;
  const size = b.getSize(new THREE.Vector3()).multiplyScalar(1.15);
  const centre = b.getCenter(new THREE.Vector3());
  for (const slice of slices.filter((s) => s.enabled)) {
    const color = AXIS_COLORS[slice.axis];
    const group = new THREE.Group();
    group.userData.sliceId = slice.id;
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: slice.id === active ? 0.16 : 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
    const handle = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    handle.renderOrder = 10;
    handle.userData.sliceHandle = slice.id;
    sheet.raycast = () => {};
    frame.raycast = () => {};
    const r = Math.max(size.length() * 0.012, 0.06);
    handle.scale.setScalar(r);
    const at = slice.axis === "x" ? (slice.at - state.origin.x) / 1_000 : slice.axis === "y" ? -(slice.at - state.origin.y) / 1_000 : slice.at / 1_000;
    if (slice.axis === "x") {
      sheet.scale.set(size.z, size.y, 1);
      sheet.rotation.y = Math.PI / 2;
      sheet.position.set(at, centre.y, centre.z);
      handle.position.set(at, b.max.y + r * 3, centre.z);
    } else if (slice.axis === "y") {
      sheet.scale.set(size.x, size.y, 1);
      sheet.position.set(centre.x, centre.y, at);
      handle.position.set(centre.x, b.max.y + r * 3, at);
    } else {
      sheet.scale.set(size.x, size.z, 1);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(centre.x, at, centre.z);
      handle.position.set(b.max.x + r * 3, at, b.max.z + r * 3);
    }
    frame.scale.copy(sheet.scale);
    frame.rotation.copy(sheet.rotation);
    frame.position.copy(sheet.position);
    group.add(sheet, frame, handle);
    state.gizmos.add(group);
  }
}

export default function Plan3D({
  plan,
  options,
  lib = STANDARD,
  view,
  projection = "perspective",
  style = "realistic",
  shadows = true,
  slices = [],
  onSlices,
  selection,
  selectionIds = [],
  selectedParts,
  onSelect,
  onPart,
  onBack,
  fitSignal,
  apiRef,
  hint = true,
  showGrid = true,
  transform,
  points,
}: {
  plan: Plan;
  options: SceneOptions;
  lib?: Resolver;
  view: ViewPreset;
  projection?: Projection;
  style?: ViewStyle;
  shadows?: boolean;
  slices?: Slice[];
  onSlices?: (slices: Slice[]) => void;
  selection: PlanItem | null;
  selectionIds?: string[];
  /** In the blueprint editor: the parts picked, by their id at the top level. */
  selectedParts?: string[];
  onSelect: (target: PlanItem | null, levelId?: string, additive?: boolean) => void;
  /** In the blueprint editor: the top-level part tapped. */
  onPart?: (partId: string | null, additive: boolean) => void;
  onBack: () => void;
  fitSignal: number;
  apiRef?: Ref<Plan3DApi | null>;
  hint?: boolean;
  showGrid?: boolean;
  /** In the blueprint editor: handles on the selected parts, and what to do when a drag ends. */
  transform?: { mode: TransformMode; onCommit: (parts: string[], change: PartTransform) => void };
  /** In the blueprint editor: a mesh part's points to pick and drag. */
  points?: PointEditing;
}) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const callbacks = useRef({ onSelect, onPart, onSlices, slices });
  const transformRef = useRef(transform);
  const pointsRef = useRef(points);
  useEffect(() => {
    transformRef.current = transform;
    pointsRef.current = points;
  }, [transform, points]);
  const [unavailable, setUnavailable] = useState(false);
  const [activeSlice, setActiveSlice] = useState<string | null>(null);
  const model = useMemo(() => buildScene(plan, options, lib), [plan, options, lib]);
  const scope = `${options.allLevels ? "all" : options.levelId}.${options.separated}.${options.cutWalls}`;
  const enabledSlices = slices.filter((s) => s.enabled);
  const sliceCount = enabledSlices.length;
  useEffect(() => {
    callbacks.current = { onSelect, onPart, onSlices, slices };
  }, [onSelect, onPart, onSlices, slices]);

  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    let unavailableFrame = 0;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    } catch {
      unavailableFrame = requestAnimationFrame(() => setUnavailable(true));
      return () => cancelAnimationFrame(unavailableFrame);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "3D model. Drag to orbit, use two fingers or the mouse wheel to pan and zoom. Tap an object to select it.");
    canvas.tabIndex = 0;
    host.prepend(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eeede7");
    scene.add(new THREE.HemisphereLight("#ffffff", "#929b8e", 1.6));
    const sun = new THREE.DirectionalLight("#fff3dc", 2.4);
    sun.position.set(10, 20, 12);
    sun.shadow.mapSize.set(2_048, 2_048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const group = new THREE.Group();
    const gizmos = new THREE.Group();
    scene.add(group, gizmos);
    const camera = new THREE.PerspectiveCamera();
    const controls = new OrbitControls(camera, canvas);
    controls.screenSpacePanning = true;
    controls.enableDamping = false;
    controls.zoomToCursor = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    let frame: number | null = null;
    const invalidate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        renderer.render(scene, state.camera);
      });
    };
    let environment: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      environment = null;
    }
    const state: Runtime = {
      renderer,
      scene,
      model: group,
      gizmos,
      grid: null,
      camera,
      controls,
      sun,
      bounds: new THREE.Box3(),
      width: Math.max(host.clientWidth, 1),
      height: Math.max(host.clientHeight, 1),
      clipping: [],
      environment,
      invalidate,
    };
    runtime.current = state;
    controls.addEventListener("change", invalidate);
    const resize = new ResizeObserver(() => {
      const oldAspect = state.width / state.height;
      state.width = Math.max(host.clientWidth, 1);
      state.height = Math.max(host.clientHeight, 1);
      renderer.setSize(state.width, state.height);
      const aspect = state.width / state.height;
      if (state.camera instanceof THREE.PerspectiveCamera) state.camera.aspect = aspect;
      else {
        const centre = (state.camera.left + state.camera.right) / 2;
        const half = (((state.camera.right - state.camera.left) / 2) * aspect) / oldAspect;
        state.camera.left = centre - half;
        state.camera.right = centre + half;
      }
      state.camera.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(host);
    const raycaster = new THREE.Raycaster();
    const starts = new Map<number, { x: number; y: number }>();
    let moved = false;
    let drag: { id: string; axis: Slice["axis"]; plane: THREE.Plane; startAt: number; startHit: THREE.Vector3; pointer: number } | null = null;
    const ndc = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, (-(event.clientY - rect.top) / rect.height) * 2 + 1);
    };
    // The handle under the pointer, if any, as the transform handles report it.
    const gizmoHit = (_event: PointerEvent) => !!canvas.dataset.gizmoAxis;
    const axisVector = (axis: Slice["axis"]) => (axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0));
    const down = (event: PointerEvent) => {
      if (starts.size === 0) moved = false;
      starts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (starts.size > 1) moved = true;
      // A section handle under the pointer is dragged instead of turning the view.
      raycaster.setFromCamera(ndc(event), state.camera);
      const handles: THREE.Object3D[] = [];
      state.gizmos.traverse((o) => o.userData.sliceHandle && handles.push(o));
      const hit = raycaster.intersectObjects(handles, false)[0];
      if (hit && starts.size === 1) {
        const id = hit.object.userData.sliceHandle as string;
        const slice = callbacks.current.slices.find((s) => s.id === id);
        if (!slice) return;
        const axis = axisVector(slice.axis);
        // Drag on the plane that holds the slice's axis and faces the camera most.
        const view = state.camera.getWorldDirection(new THREE.Vector3());
        const side = new THREE.Vector3().crossVectors(axis, view).normalize();
        const normal = new THREE.Vector3().crossVectors(side, axis).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
        drag = { id, axis: slice.axis, plane, startAt: slice.at, startHit: hit.point.clone(), pointer: event.pointerId };
        controls.enabled = false;
        canvas.setPointerCapture(event.pointerId);
        setActiveSlice(id);
        event.stopPropagation();
      }
    };
    let pending: number | null = null;
    const move = (event: PointerEvent) => {
      const start = starts.get(event.pointerId);
      if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6) moved = true;
      if (!drag || drag.pointer !== event.pointerId) return;
      raycaster.setFromCamera(ndc(event), state.camera);
      const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!point) return;
      const along = point.sub(drag.startHit).dot(axisVector(drag.axis)) * 1_000;
      const at = Math.round(drag.startAt + along);
      if (pending !== null) cancelAnimationFrame(pending);
      const { id } = drag;
      pending = requestAnimationFrame(() => {
        pending = null;
        const { slices: list, onSlices: change } = callbacks.current;
        change?.(list.map((s) => (s.id === id ? { ...s, at } : s)));
      });
    };
    const up = (event: PointerEvent) => {
      const start = starts.get(event.pointerId);
      starts.delete(event.pointerId);
      if (drag && drag.pointer === event.pointerId) {
        drag = null;
        controls.enabled = true;
        setActiveSlice(null);
        return;
      }
      if (!start || moved || event.button !== 0 || starts.size) return;
      // A tap on a handle is the handle's, not a pick.
      if (gizmoHit(event)) return;
      raycaster.setFromCamera(ndc(event), state.camera);
      // Only solid faces are pickable; outlines, fills and the grid never steal a tap.
      const hits = raycaster.intersectObjects(state.model.children, true).filter((h) => h.object.userData.target);
      // A cut-away part of a solid cannot be picked.
      const hit = hits.find((h) => state.clipping.every((p) => p.distanceToPoint(h.point) >= -1e-4));
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      // Editing points: the nearest point on screen within a finger's reach is picked.
      const pointEdit = pointsRef.current;
      if (pointEdit && state.origin) {
        const rect = canvas.getBoundingClientRect();
        const reach = event.pointerType === "touch" ? 28 : 16;
        let best = -1;
        let bestD = reach;
        pointEdit.at.forEach((p, i) => {
          const v = new THREE.Vector3((p.x - state.origin!.x) / 1_000, p.z / 1_000, -(p.y - state.origin!.y) / 1_000).project(state.camera);
          if (v.z > 1) return;
          const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - event.clientX, ((1 - v.y) / 2) * rect.height + rect.top - event.clientY);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0) {
          pointEdit.onPick(best, additive);
          canvas.focus({ preventScroll: true });
          return;
        }
        if (!hit && !additive) {
          pointEdit.onPick(null, false);
          return;
        }
      }
      if (callbacks.current.onPart) callbacks.current.onPart(hit ? ((hit.object.userData.path as string[] | undefined)?.[0] ?? null) : null, additive);
      else callbacks.current.onSelect(hit ? hit.object.userData.target : null, hit?.object.userData.levelId, additive);
      canvas.focus({ preventScroll: true });
    };
    const cancel = (event: PointerEvent) => {
      starts.delete(event.pointerId);
      moved = true;
      if (drag?.pointer === event.pointerId) {
        drag = null;
        controls.enabled = true;
        setActiveSlice(null);
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      unavailableFrame = requestAnimationFrame(() => setUnavailable(true));
    };
    // Capture observes gestures before OrbitControls removes its pointer-up listener.
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", up, true);
    canvas.addEventListener("pointercancel", cancel, true);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      resize.disconnect();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", cancel, true);
      canvas.removeEventListener("webglcontextlost", lost);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      if (pending !== null) cancelAnimationFrame(pending);
      cancelAnimationFrame(unavailableFrame);
      disposeObject(group);
      disposeObject(gizmos);
      if (state.grid) disposeObject(state.grid);
      environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      runtime.current = null;
    };
  }, []);

  // The model, rebuilt when the plan, the look or the number of sections changes.
  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    moveOrigin(state, model.origin);
    disposeObject(state.model);
    state.model.clear();
    state.clipping.length = 0;
    for (let i = 0; i < sliceCount; i++) state.clipping.push(new THREE.Plane());
    const look = { style, lib, clipping: state.clipping, onTexture: state.invalidate };
    const realistic = style === "realistic";
    for (const [index, solid] of model.solids.entries()) {
      const geometry = geometryFor(solid);
      const mesh = new THREE.Mesh(geometry, materialFor(solid, look));
      mesh.position.set(...solid.at);
      mesh.rotation.y = solid.rotation;
      mesh.userData = { target: solid.target, levelId: solid.levelId, path: solid.path, solid: index };
      mesh.castShadow = realistic && shadows && !solid.glass && solid.shape !== "floor";
      mesh.receiveShadow = realistic && shadows;
      const edges = edgesFor(geometry, style, state.clipping);
      mesh.add(edges);
      if (sliceCount && !solid.glass) mesh.add(cutFill(geometry, state.clipping, style));
      state.model.add(mesh);
    }
    state.bounds.setFromObject(state.model);
    state.renderer.shadowMap.enabled = realistic && shadows;
    state.scene.environment = realistic ? state.environment : null;
    state.scene.environmentIntensity = 0.55;
    state.scene.background = new THREE.Color(style === "lines" ? "#ffffff" : "#eeede7");
    // The sun's shadow covers the model.
    if (!state.bounds.isEmpty()) {
      const centre = state.bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(state.bounds.getSize(new THREE.Vector3()).length() / 2, 1);
      state.sun.position.copy(centre).add(new THREE.Vector3(0.45, 1, 0.6).normalize().multiplyScalar(radius * 2));
      state.sun.target.position.copy(centre);
      const cam = state.sun.shadow.camera;
      cam.left = cam.bottom = -radius;
      cam.right = cam.top = radius;
      cam.near = 0.1;
      cam.far = radius * 5;
      cam.updateProjectionMatrix();
    }
    if (state.grid) {
      state.scene.remove(state.grid);
      disposeObject(state.grid);
      state.grid = null;
    }
    if (showGrid) {
      const size = state.bounds.isEmpty() ? 20 : Math.max(state.bounds.max.x - state.bounds.min.x, state.bounds.max.z - state.bounds.min.z, 10) * 1.4;
      state.grid = new THREE.GridHelper(size, 20, "#bec4bc", "#d9ddd5");
      const centre = state.bounds.isEmpty() ? new THREE.Vector3() : state.bounds.getCenter(new THREE.Vector3());
      state.grid.position.set(centre.x, state.bounds.isEmpty() ? -0.07 : state.bounds.min.y - 0.01, centre.z);
      state.grid.visible = style !== "lines";
      state.scene.add(state.grid);
    }
    state.invalidate();
  }, [model, style, lib, shadows, sliceCount, showGrid]);

  // Section planes move without rebuilding the model.
  const sliceKey = JSON.stringify(enabledSlices);
  useEffect(() => {
    const state = runtime.current;
    if (!state || !state.origin) return;
    enabledSlices.forEach((s, i) => state.clipping[i] && planeFor(s, state.origin!, state.clipping[i]));
    drawGizmos(state, enabledSlices, activeSlice);
    state.invalidate();
  }, [sliceKey, model, style, sliceCount, activeSlice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const state = runtime.current;
    if (state) fit(state, view, projection);
  }, [fitSignal, view, projection, scope]);

  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    highlight(state, selection, selectionIds, selectedParts);
  }, [selection, selectionIds, selectedParts, model, style, sliceCount, lib, shadows]);

  // Handles on the selected parts: the parts follow the handle while it is dragged, and the change is kept when it is let go.
  const transformMode = transform?.mode;
  const partKey = (selectedParts ?? []).join(",");
  useEffect(() => {
    const state = runtime.current;
    if (!state || !transformMode || !partKey) return;
    const ids = partKey.split(",");
    const meshes = state.model.children.filter((o) => ids.includes((o.userData.path as string[] | undefined)?.[0] ?? ""));
    if (!meshes.length) return;
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    const pivot = new THREE.Object3D();
    box.getCenter(pivot.position);
    pivot.position.y = box.min.y;
    state.scene.add(pivot);
    const tc = new TransformControls(state.camera, state.renderer.domElement);
    tc.setMode(transformMode);
    tc.setSpace(transformMode === "translate" ? "world" : "local");
    tc.setTranslationSnap(0.01);
    tc.setRotationSnap(Math.PI / 24);
    tc.setScaleSnap(0.05);
    tc.setSize(0.85);
    if (transformMode === "rotate") {
      tc.showX = false;
      tc.showZ = false;
    }
    tc.attach(pivot);
    const helper = tc.getHelper();
    state.gizmos.add(helper);
    let start: { position: THREE.Vector3; rotation: number; scale: THREE.Vector3 } | null = null;
    const followers: { mesh: THREE.Object3D; parent: THREE.Object3D }[] = [];
    const onDragging = (e: { value: unknown }) => {
      state.controls.enabled = !e.value;
      if (e.value) {
        start = { position: pivot.position.clone(), rotation: pivot.rotation.y, scale: pivot.scale.clone() };
        // The parts ride on the handle while it moves.
        for (const m of meshes) {
          followers.push({ mesh: m, parent: m.parent! });
          pivot.attach(m);
        }
        return;
      }
      for (const f of followers.splice(0)) f.parent.attach(f.mesh);
      if (!start) return;
      const d = pivot.position.clone().sub(start.position);
      const change: PartTransform = {
        // Three's z points to the plan's front; its y is up.
        move: { x: Math.round(d.x * 1_000), y: Math.round(-d.z * 1_000), z: Math.round(d.y * 1_000) },
        turn: Math.round((((pivot.rotation.y - start.rotation) * 180) / Math.PI) * 10) / 10,
        scale: { x: pivot.scale.x / start.scale.x, y: pivot.scale.z / start.scale.z, z: pivot.scale.y / start.scale.y },
      };
      start = null;
      const nothing = !change.move.x && !change.move.y && !change.move.z && !change.turn && [change.scale.x, change.scale.y, change.scale.z].every((k) => Math.abs(k - 1) < 1e-3);
      if (!nothing) transformRef.current?.onCommit(ids, change);
    };
    const onChange = () => state.invalidate();
    const onAxis = (e: { value: unknown }) => {
      if (e.value) state.renderer.domElement.dataset.gizmoAxis = String(e.value);
      else delete state.renderer.domElement.dataset.gizmoAxis;
    };
    tc.addEventListener("axis-changed", onAxis as never);
    tc.addEventListener("dragging-changed", onDragging as never);
    tc.addEventListener("change", onChange);
    state.invalidate();
    return () => {
      tc.removeEventListener("axis-changed", onAxis as never);
      tc.removeEventListener("dragging-changed", onDragging as never);
      delete state.renderer.domElement.dataset.gizmoAxis;
      tc.removeEventListener("change", onChange);
      for (const f of followers.splice(0)) f.parent.attach(f.mesh);
      tc.detach();
      state.gizmos.remove(helper);
      tc.dispose();
      state.scene.remove(pivot);
      state.controls.enabled = true;
      state.invalidate();
    };
  }, [transformMode, partKey, model, style, sliceCount, lib, shadows, view, projection]);

  // A mesh's points and edges over the model; the picked points get a handle, snapping to the grid and to other points.
  const pointAt = points?.at;
  const pointEdges = points?.edges;
  const pickedKey = (points?.selected ?? []).join(",");
  const pointSnap = points?.snap ?? 0;
  const pointTargets = points?.targets;
  useEffect(() => {
    const state = runtime.current;
    if (!state || !state.origin || !pointAt || !pointEdges) return;
    const origin = state.origin;
    const toThree = (p: PointMm) => new THREE.Vector3((p.x - origin.x) / 1_000, p.z / 1_000, -(p.y - origin.y) / 1_000);
    const picked = pickedKey ? pickedKey.split(",").map(Number).filter((i) => i >= 0 && i < pointAt.length) : [];
    const pickedSet = new Set(picked);
    const base = pointAt.map(toThree);
    const now = base.map((v) => v.clone());
    const overlay = new THREE.Group();
    overlay.renderOrder = 20;
    const edgeGeo = new THREE.BufferGeometry();
    const edgePos = new Float32Array(pointEdges.length * 6);
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    const edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: "#3a86ff", transparent: true, opacity: 0.85, depthTest: false }));
    edgeLines.renderOrder = 20;
    const dotGeo = new THREE.BufferGeometry();
    const dotPos = new Float32Array(pointAt.length * 3);
    const dotCol = new Float32Array(pointAt.length * 3);
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute("color", new THREE.BufferAttribute(dotCol, 3));
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: coarse ? 14 : 10, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    dots.renderOrder = 21;
    const colour = new THREE.Color();
    const draw = () => {
      pointEdges.forEach(([a, b], k) => {
        if (!now[a] || !now[b]) return;
        edgePos.set([now[a].x, now[a].y, now[a].z, now[b].x, now[b].y, now[b].z], k * 6);
      });
      now.forEach((v, i) => {
        dotPos.set([v.x, v.y, v.z], i * 3);
        colour.set(pickedSet.has(i) ? "#ff7a00" : "#1f4fd1");
        dotCol.set([colour.r, colour.g, colour.b], i * 3);
      });
      edgeGeo.attributes.position.needsUpdate = true;
      dotGeo.attributes.position.needsUpdate = true;
      dotGeo.attributes.color.needsUpdate = true;
      edgeGeo.computeBoundingSphere();
      dotGeo.computeBoundingSphere();
    };
    draw();
    overlay.add(edgeLines, dots);
    state.gizmos.add(overlay);

    // A guide through the dragged point along the axis it moves on, a ring where it snaps, and a label with the move in mm.
    const guideGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const guide = new THREE.Line(guideGeo, new THREE.LineDashedMaterial({ color: "#e63946", dashSize: 0.04, gapSize: 0.03, depthTest: false }));
    guide.renderOrder = 22;
    guide.visible = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 24), new THREE.MeshBasicMaterial({ color: "#e63946", depthTest: false, side: THREE.DoubleSide }));
    ring.renderOrder = 23;
    ring.visible = false;
    overlay.add(guide, ring);
    const label = document.createElement("div");
    label.className = "plan-3d-measure";
    label.hidden = true;
    container.current?.append(label);

    let cleanupHandle = () => {};
    if (picked.length) {
      const pivot = new THREE.Object3D();
      picked.forEach((i) => pivot.position.add(base[i]));
      pivot.position.divideScalar(picked.length);
      state.scene.add(pivot);
      const tc = new TransformControls(state.camera, state.renderer.domElement);
      tc.setMode("translate");
      tc.setSpace("world");
      if (pointSnap > 0) tc.setTranslationSnap(pointSnap / 1_000);
      tc.setSize(coarse ? 1.15 : 0.8);
      tc.attach(pivot);
      const helper = tc.getHelper();
      state.gizmos.add(helper);
      const start = pivot.position.clone();
      const lead = picked[0];
      const others = [...base.filter((_, i) => !pickedSet.has(i)), ...(pointTargets ?? []).map(toThree)];
      const screen = (v: THREE.Vector3) => {
        const p = v.clone().project(state.camera);
        return { x: ((p.x + 1) / 2) * state.width, y: ((1 - p.y) / 2) * state.height, behind: p.z > 1 };
      };
      const onObjectChange = () => {
        const delta = pivot.position.clone().sub(start);
        // Onto another point when the dragged one comes within reach of it on screen, along the axes being moved.
        const axis = String(tc.axis ?? "XYZ");
        const leadAt = base[lead].clone().add(delta);
        const s = screen(leadAt);
        let snapped: THREE.Vector3 | null = null;
        let bestD = coarse ? 22 : 12;
        for (const t of others) {
          const q = screen(t);
          if (q.behind) continue;
          const d = Math.hypot(q.x - s.x, q.y - s.y);
          if (d < bestD) {
            bestD = d;
            snapped = t;
          }
        }
        if (snapped) {
          const want = snapped.clone().sub(base[lead]);
          if (axis.includes("X")) delta.x = want.x;
          if (axis.includes("Y")) delta.y = want.y;
          if (axis.includes("Z")) delta.z = want.z;
          pivot.position.copy(start).add(delta);
          ring.position.copy(snapped);
          ring.quaternion.copy(state.camera.quaternion);
          ring.scale.setScalar(Math.max(0.004, state.camera.position.distanceTo(snapped) * 0.012));
        }
        ring.visible = !!snapped;
        picked.forEach((i) => now[i].copy(base[i]).add(delta));
        draw();
        // The guide runs along the axis being dragged, through where the point started.
        const dir = axis === "X" ? new THREE.Vector3(1, 0, 0) : axis === "Y" ? new THREE.Vector3(0, 1, 0) : axis === "Z" ? new THREE.Vector3(0, 0, 1) : null;
        guide.visible = !!dir;
        if (dir) {
          const far = Math.max(2, state.bounds.getSize(new THREE.Vector3()).length());
          guideGeo.setFromPoints([base[lead].clone().addScaledVector(dir, -far), base[lead].clone().addScaledVector(dir, far)]);
          guide.computeLineDistances();
        }
        const mm = { x: Math.round(delta.x * 10_000) / 10, y: Math.round(-delta.z * 10_000) / 10, z: Math.round(delta.y * 10_000) / 10 };
        const at = pointAt[lead];
        label.hidden = false;
        label.textContent = `Δ ${mm.x} · ${mm.y} · ${mm.z} mm  →  ${Math.round((at.x + mm.x) * 10) / 10}, ${Math.round((at.y + mm.y) * 10) / 10}, ${Math.round((at.z + mm.z) * 10) / 10}${snapped ? "  ⊙ snapped" : ""}`;
        const ls = screen(now[lead]);
        label.style.left = `${Math.min(Math.max(ls.x + 16, 8), state.width - 200)}px`;
        label.style.top = `${Math.min(Math.max(ls.y - 36, 8), state.height - 30)}px`;
        state.invalidate();
      };
      const onDragging = (e: { value: unknown }) => {
        state.controls.enabled = !e.value;
        if (e.value) return;
        guide.visible = false;
        ring.visible = false;
        label.hidden = true;
        const d = pivot.position.clone().sub(start);
        const by = { x: Math.round(d.x * 10_000) / 10, y: Math.round(-d.z * 10_000) / 10, z: Math.round(d.y * 10_000) / 10 };
        if (by.x || by.y || by.z) pointsRef.current?.onMove(picked, by);
        state.invalidate();
      };
      const onAxis = (e: { value: unknown }) => {
        if (e.value) state.renderer.domElement.dataset.gizmoAxis = String(e.value);
        else delete state.renderer.domElement.dataset.gizmoAxis;
      };
      const onChange = () => state.invalidate();
      tc.addEventListener("objectChange", onObjectChange);
      tc.addEventListener("dragging-changed", onDragging as never);
      tc.addEventListener("axis-changed", onAxis as never);
      tc.addEventListener("change", onChange);
      cleanupHandle = () => {
        tc.removeEventListener("objectChange", onObjectChange);
        tc.removeEventListener("dragging-changed", onDragging as never);
        tc.removeEventListener("axis-changed", onAxis as never);
        tc.removeEventListener("change", onChange);
        delete state.renderer.domElement.dataset.gizmoAxis;
        tc.detach();
        state.gizmos.remove(helper);
        tc.dispose();
        state.scene.remove(pivot);
        state.controls.enabled = true;
      };
    }
    state.invalidate();
    return () => {
      cleanupHandle();
      state.gizmos.remove(overlay);
      disposeObject(overlay);
      label.remove();
      state.invalidate();
    };
  }, [pointAt, pointEdges, pickedKey, pointSnap, pointTargets, model, style, sliceCount, lib, shadows, view, projection]);

  useImperativeHandle(
    apiRef,
    () => ({
      capture({ width, height, style: captureStyle, clean = true, mime = "image/png" }) {
        const state = runtime.current;
        if (!state) throw new Error("The 3D view is not ready.");
        const gl = state.renderer.getContext();
        const max = Math.min(4_096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
        const k = Math.min(1, max / Math.max(width, height));
        const w = Math.max(16, Math.round(width * k));
        const h = Math.max(16, Math.round(height * k));
        const ratio = state.renderer.getPixelRatio();
        const swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
        if (captureStyle && captureStyle !== style) {
          const look = { style: captureStyle, lib, clipping: state.clipping, onTexture: () => {} };
          state.model.traverse((o) => {
            if (o instanceof THREE.Mesh && o.userData.target && !o.userData.cutFill) {
              swapped.push({ mesh: o, material: o.material });
              const solid = model.solids[o.userData.solid as number];
              if (solid) o.material = materialFor(solid, look);
            }
          });
        }
        const gridVisible = state.grid?.visible ?? false;
        if (clean) {
          if (state.grid) state.grid.visible = false;
          state.gizmos.visible = false;
        }
        const camera = state.camera.clone() as Runtime["camera"];
        if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
        else {
          const cx = (camera.left + camera.right) / 2;
          const cy = (camera.top + camera.bottom) / 2;
          const halfH = (camera.top - camera.bottom) / 2;
          camera.left = cx - halfH * (w / h);
          camera.right = cx + halfH * (w / h);
          camera.top = cy + halfH;
          camera.bottom = cy - halfH;
        }
        camera.updateProjectionMatrix();
        state.renderer.setPixelRatio(1);
        state.renderer.setSize(w, h, false);
        state.renderer.render(state.scene, camera);
        const url = state.renderer.domElement.toDataURL(mime, 0.92);
        for (const s of swapped) {
          (s.mesh.material as THREE.Material).dispose();
          s.mesh.material = s.material;
        }
        if (state.grid) state.grid.visible = gridVisible;
        state.gizmos.visible = true;
        state.renderer.setPixelRatio(ratio);
        state.renderer.setSize(state.width, state.height, false);
        state.renderer.render(state.scene, state.camera);
        return url;
      },
      pose() {
        const state = runtime.current;
        if (!state?.origin) return null;
        const toPlan = (v: THREE.Vector3) => ({ x: Math.round(v.x * 1_000 + state.origin!.x), y: Math.round(-v.z * 1_000 + state.origin!.y), z: Math.round(v.y * 1_000) });
        const cam = state.camera;
        return {
          eye: toPlan(cam.position),
          target: toPlan(state.controls.target),
          fov: cam instanceof THREE.PerspectiveCamera ? cam.fov : Math.round(((cam.top - cam.bottom) / cam.zoom) * 1_000),
          projection: cam instanceof THREE.PerspectiveCamera ? "perspective" : "orthographic",
        };
      },
      lookFrom(placed, elevation) {
        const state = runtime.current;
        if (!state?.origin) return;
        const toThree = (p: { x: number; y: number; z: number }) => new THREE.Vector3((p.x - state.origin!.x) / 1_000, (p.z + elevation) / 1_000, -(p.y - state.origin!.y) / 1_000);
        const eye = toThree(placed.eye);
        const target = toThree(placed.target);
        const aspect = state.width / Math.max(state.height, 1);
        const radius = Math.max(eye.distanceTo(target), 1);
        let camera: Runtime["camera"];
        if (placed.projection === "perspective") camera = new THREE.PerspectiveCamera(Math.min(Math.max(placed.fov, 10), 120), aspect, 0.01, radius * 400);
        else {
          const half = placed.fov / 2_000;
          camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.001, radius * 400);
        }
        camera.position.copy(eye);
        camera.lookAt(target);
        applyCamera(state, camera, target, radius, false);
      },
    }),
    [model, style, lib],
  );

  return (
    <div ref={container} className="plan-3d" data-solids={model.solids.length} data-style={style}>
      {unavailable ? (
        <div className="plan-3d-fallback" role="alert">
          <p className="small">3D is unavailable in this browser. The saved plan is still available in 2D.</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Open the 2D plan
          </button>
        </div>
      ) : hint ? (
        <div className="plan-3d-hint tiny">
          {isAxisView(view) && projection === "orthographic" ? "Drag to pan · Pinch to zoom · Right-drag to turn" : "Drag to orbit · Two fingers to pan and zoom"}
          {onSlices && slices.some((s) => s.enabled) ? <span>Drag a coloured handle to move its section</span> : <span>Tap an object to select it</span>}
        </div>
      ) : null}
    </div>
  );
}
