"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Plan, PlanItem, Point } from "@/lib/plan/geometry";
import { buildScene, type SceneOptions, type Solid } from "@/lib/plan/scene";

export type CameraView = "perspective" | "top" | "front" | "right";
interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  model: THREE.Group;
  grid: THREE.GridHelper | null;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  bounds: THREE.Box3;
  width: number;
  height: number;
  fitted: boolean;
  origin?: Point;
  invalidate: () => void;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        material.dispose();
    }
  });
}

function makeSolid(solid: Solid): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  if (solid.shape === "floor") {
    const shape = new THREE.Shape();
    solid.points!.forEach(([x, y], i) =>
      i ? shape.lineTo(x, y) : shape.moveTo(x, y),
    );
    shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: solid.size[1],
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
  } else if (solid.shape === "cylinder") {
    geometry = new THREE.CylinderGeometry(
      solid.size[0] / 2,
      solid.size[0] / 2,
      solid.size[1],
      24,
    );
    geometry.scale(1, 1, solid.size[2] / solid.size[0]);
  } else geometry = new THREE.BoxGeometry(...solid.size);
  const material = new THREE.MeshStandardMaterial({
    color: solid.color,
    roughness: 0.82,
    transparent: !!solid.glass,
    opacity: solid.glass ? 0.35 : 1,
    depthWrite: !solid.glass,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...solid.at);
  mesh.rotation.y = solid.rotation;
  mesh.userData = { target: solid.target, levelId: solid.levelId };
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({
      color: "#5e655f",
      transparent: true,
      opacity: 0.24,
    }),
  );
  mesh.add(edge);
  return mesh;
}

function fit(runtime: Runtime, view: CameraView) {
  const { bounds, controls, width, height } = runtime;
  const centre = bounds.isEmpty()
    ? new THREE.Vector3()
    : bounds.getCenter(new THREE.Vector3());
  const size = bounds.isEmpty()
    ? new THREE.Vector3(10, 3, 10)
    : bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1);
  const aspect = width / Math.max(height, 1);
  const direction =
    view === "top"
      ? new THREE.Vector3(0, 1, 0.0001)
      : view === "front"
        ? new THREE.Vector3(0, 0, 1)
        : view === "right"
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(1, 0.9, 1).normalize();
  let camera: Runtime["camera"];
  if (view === "perspective") {
    camera = new THREE.PerspectiveCamera(
      42,
      aspect,
      Math.max(radius / 10_000, 0.001),
      radius * 100,
    );
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const limitingAngle = Math.min(
      fov / 2,
      Math.atan(Math.tan(fov / 2) * aspect),
    );
    camera.position
      .copy(centre)
      .addScaledVector(direction, (radius / Math.sin(limitingAngle)) * 1.12);
  } else {
    const half = radius * 1.15 * Math.max(1, 1 / aspect);
    camera = new THREE.OrthographicCamera(
      -half * aspect,
      half * aspect,
      half,
      -half,
      0.001,
      radius * 100,
    );
    camera.position.copy(centre).addScaledVector(direction, radius * 4);
  }
  runtime.camera = camera;
  controls.object = camera;
  controls.target.copy(centre);
  controls.enableRotate = view === "perspective";
  controls.mouseButtons.LEFT =
    view === "perspective" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE =
    view === "perspective" ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
  controls.minDistance = Math.max(radius / 100, 0.05);
  controls.maxDistance = radius * 30;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.update();
  runtime.fitted = true;
  runtime.invalidate();
}

/** Three.js owns these mutable objects; they are separate from React state. */
function highlight(state: Runtime, selection: PlanItem | null, selectionIds: string[]) {
  for (const object of state.model.children) {
    const mesh = object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    const target = mesh.userData.target as PlanItem;
    const picked =
      selection?.kind === target.kind && selection.id === target.id || target.kind === "item" && selectionIds.includes(target.id);
    mesh.material.emissive.set(picked ? "#678943" : "#000000");
    mesh.material.emissiveIntensity = picked ? 0.35 : 0;
    const edge = mesh.children[0] as THREE.LineSegments<
      THREE.EdgesGeometry,
      THREE.LineBasicMaterial
    >;
    edge.material.color.set(picked ? "#548127" : "#5e655f");
    edge.material.opacity = picked ? 1 : 0.24;
  }
  state.invalidate();
}

function moveOrigin(state: Runtime, origin: Point) {
  if (state.origin) {
    const shift = new THREE.Vector3(
      (state.origin.x - origin.x) / 1_000,
      0,
      (origin.y - state.origin.y) / 1_000,
    );
    state.camera.position.add(shift);
    state.controls.target.add(shift);
    state.controls.update();
  }
  state.origin = origin;
}

export default function Plan3D({
  plan,
  options,
  view,
  selection,
  selectionIds = [],
  onSelect,
  onBack,
  fitSignal,
}: {
  plan: Plan;
  options: SceneOptions;
  view: CameraView;
  selection: PlanItem | null;
  selectionIds?: string[];
  onSelect: (target: PlanItem | null, levelId?: string, additive?: boolean) => void;
  onBack: () => void;
  fitSignal: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const select = useRef(onSelect);
  const [unavailable, setUnavailable] = useState(false);
  const model = useMemo(() => buildScene(plan, options), [plan, options]);
  const scope = `${options.allLevels ? "all" : options.levelId}.${options.separated}.${options.cutWalls}`;
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    let unavailableFrame = 0;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      unavailableFrame = requestAnimationFrame(() => setUnavailable(true));
      return () => cancelAnimationFrame(unavailableFrame);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.setAttribute(
      "aria-label",
      "3D floor plan. Drag to orbit, use two fingers or the mouse wheel to pan and zoom. Tap an object to edit it.",
    );
    canvas.tabIndex = 0;
    host.prepend(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eeede7");
    scene.add(new THREE.HemisphereLight("#ffffff", "#929b8e", 2.7));
    const sunlight = new THREE.DirectionalLight("#fff3dc", 2.5);
    sunlight.position.set(10, 20, 12);
    scene.add(sunlight);
    const group = new THREE.Group();
    scene.add(group);
    const camera = new THREE.PerspectiveCamera();
    const controls = new OrbitControls(camera, canvas);
    controls.screenSpacePanning = true;
    controls.enableDamping = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    let frame: number | null = null;
    const invalidate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        renderer.render(scene, state.camera);
      });
    };
    const state: Runtime = {
      renderer,
      scene,
      model: group,
      grid: null,
      camera,
      controls,
      bounds: new THREE.Box3(),
      width: Math.max(host.clientWidth, 1),
      height: Math.max(host.clientHeight, 1),
      fitted: false,
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
      if (state.camera instanceof THREE.PerspectiveCamera)
        state.camera.aspect = aspect;
      else {
        const centre = (state.camera.left + state.camera.right) / 2;
        const half =
          (((state.camera.right - state.camera.left) / 2) * aspect) / oldAspect;
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
    const down = (event: PointerEvent) => {
      if (starts.size === 0) moved = false;
      starts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (starts.size > 1) moved = true;
    };
    const move = (event: PointerEvent) => {
      const start = starts.get(event.pointerId);
      if (
        start &&
        Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6
      )
        moved = true;
    };
    const up = (event: PointerEvent) => {
      const start = starts.get(event.pointerId);
      starts.delete(event.pointerId);
      if (!start || moved || event.button !== 0 || starts.size) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        state.camera,
      );
      // Only solid faces are pickable; the outlines and grid never steal a tap.
      const hit = raycaster.intersectObjects(state.model.children, false)[0];
      select.current(
        hit ? hit.object.userData.target : null,
        hit?.object.userData.levelId,
        event.ctrlKey || event.metaKey || event.shiftKey,
      );
      canvas.focus({ preventScroll: true });
    };
    const cancel = (event: PointerEvent) => {
      starts.delete(event.pointerId);
      moved = true;
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
      cancelAnimationFrame(unavailableFrame);
      disposeObject(group);
      if (state.grid) disposeObject(state.grid);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    moveOrigin(state, model.origin);
    disposeObject(state.model);
    state.model.clear();
    for (const solid of model.solids) state.model.add(makeSolid(solid));
    state.bounds.setFromObject(state.model);
    if (state.grid) {
      state.scene.remove(state.grid);
      disposeObject(state.grid);
    }
    const size = state.bounds.isEmpty()
      ? 20
      : Math.max(
          state.bounds.max.x - state.bounds.min.x,
          state.bounds.max.z - state.bounds.min.z,
          10,
        ) * 1.4;
    state.grid = new THREE.GridHelper(size, 20, "#bec4bc", "#d9ddd5");
    const centre = state.bounds.isEmpty()
      ? new THREE.Vector3()
      : state.bounds.getCenter(new THREE.Vector3());
    state.grid.position.set(
      centre.x,
      state.bounds.isEmpty() ? -0.07 : state.bounds.min.y - 0.01,
      centre.z,
    );
    state.scene.add(state.grid);
    state.invalidate();
  }, [model]);

  useEffect(() => {
    const state = runtime.current;
    if (state) fit(state, view);
  }, [fitSignal, view, scope]);

  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    highlight(state, selection, selectionIds);
  }, [selection, selectionIds, model]);

  return (
    <div ref={container} className="plan-3d" data-solids={model.solids.length}>
      {unavailable ? (
        <div className="plan-3d-fallback" role="alert">
          <p className="small">
            3D is unavailable in this browser. The saved plan is still available
            in 2D.
          </p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Open the 2D plan
          </button>
        </div>
      ) : (
        <div className="plan-3d-hint tiny">
          {view === "perspective"
            ? "Drag to orbit · Two fingers to pan and zoom"
            : "Drag to pan · Pinch to zoom"}
          <span>
            Tap an object to edit · Furniture shown as dimensioned placeholders
          </span>
        </div>
      )}
    </div>
  );
}
