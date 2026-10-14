import type { Pt } from "./geometry";
import { connector, frame, shape, sticky, text } from "./ops";
import { STICKY_COLORS, type BoardElement } from "./types";

/**
 * Ready-made layouts to drop on a board, as Miro and FigJam offer: each is
 * built around a point (the middle of the screen) with fresh ids, stacked on
 * top of what is there. Interior design ones first.
 */

export const TEMPLATES = [
  { key: "moodboard", name: "Mood board", note: "Frame with image spots, a palette and notes" },
  { key: "materials", name: "Material palette", note: "Swatches with names and where they go" },
  { key: "rooms", name: "Room by room", note: "A frame per room with stickies" },
  { key: "kanban", name: "Task board", note: "To do, doing, done" },
  { key: "mindmap", name: "Mind map", note: "An idea in the middle, branches around it" },
  { key: "retro", name: "Review", note: "Went well, to improve, actions" },
  { key: "timeline", name: "Timeline", note: "Phases along a line with milestones" },
  { key: "slides", name: "Presentation", note: "Three 16:9 slides to present from" },
] as const;
export type TemplateKey = (typeof TEMPLATES)[number]["key"];
export const isTemplate = (v: string): v is TemplateKey => TEMPLATES.some((t) => t.key === v);

export function template(key: TemplateKey, at: Pt, z0: number, labels: string[] = []): BoardElement[] {
  let z = z0;
  const out: BoardElement[] = [];
  const add = <T extends BoardElement>(e: T) => {
    out.push(e);
    return e;
  };
  const nextZ = () => z++;
  const columns = (titles: string[], w: number, h: number, colours: string[], notes: string[][] = []) => {
    const gap = 40;
    const left = at.x - (titles.length * w + (titles.length - 1) * gap) / 2;
    titles.forEach((title, i) => {
      add(frame({ x: left + i * (w + gap), y: at.y - h / 2, w, h }, nextZ(), { title }));
      (notes[i] ?? [""]).forEach((t, j) => add(sticky({ x: left + i * (w + gap) + w / 2, y: at.y - h / 2 + 150 + j * 220 }, nextZ(), { text: t, color: colours[i % colours.length] })));
    });
  };
  switch (key) {
    case "moodboard": {
      const w = 1500;
      const h = 960;
      const x = at.x - w / 2;
      const y = at.y - h / 2;
      add(frame({ x, y, w, h }, nextZ(), { title: labels[0] ?? "Mood board" }));
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 3; c++)
          add(shape("rounded", { x: x + 40 + c * 320, y: y + 60 + r * 420, w: 290, h: 380 }, nextZ(), { fill: "#f1efe8", stroke: "#c9c4b8", strokeWidth: 1, dash: true, text: "Drop an image", textColor: "#8a857a", fontSize: 18 }));
      add(text({ x: x + 1020, y: y + 60 }, nextZ(), { text: "Palette", fontSize: 26, bold: true }));
      ["#e8dccb", "#b98b62", "#5f6b4f", "#2f3a3a", "#d9c7b0"].forEach((fill, i) => add(shape("ellipse", { x: x + 1020 + (i % 3) * 140, y: y + 120 + Math.floor(i / 3) * 140, w: 110, h: 110 }, nextZ(), { fill, stroke: "none", strokeWidth: 0 })));
      add(sticky({ x: x + 1130, y: y + 520 }, nextZ(), { text: "Feeling and words", color: STICKY_COLORS[0] }));
      add(sticky({ x: x + 1350, y: y + 520 }, nextZ(), { text: "Must keep", color: STICKY_COLORS[4] }));
      add(sticky({ x: x + 1130, y: y + 760 }, nextZ(), { text: "Avoid", color: STICKY_COLORS[2] }));
      break;
    }
    case "materials": {
      const names = labels.length ? labels : ["Floor", "Walls", "Joinery", "Fabric", "Metal", "Stone"];
      const w = 260;
      const left = at.x - (Math.min(names.length, 3) * (w + 30)) / 2;
      const rows = Math.ceil(names.length / 3);
      add(frame({ x: left - 40, y: at.y - (rows * 400) / 2 - 80, w: Math.min(names.length, 3) * (w + 30) + 50, h: rows * 400 + 120 }, nextZ(), { title: "Material palette" }));
      names.forEach((n, i) => {
        const x = left + (i % 3) * (w + 30);
        const y = at.y - (rows * 400) / 2 + Math.floor(i / 3) * 400;
        add(shape("rounded", { x, y, w, h: 260 }, nextZ(), { fill: "#e9e4da", stroke: "#c9c4b8", strokeWidth: 1, text: "Drop a swatch", textColor: "#8a857a", fontSize: 16 }));
        add(text({ x, y: y + 270 }, nextZ(), { text: n, fontSize: 20, bold: true, w }));
        add(text({ x, y: y + 304 }, nextZ(), { text: "Supplier, code, finish", fontSize: 14, color: "#5c6560", w }));
      });
      break;
    }
    case "rooms": {
      const names = labels.length ? labels : ["Living", "Kitchen", "Main bedroom", "Bathroom"];
      const w = 520;
      const h = 620;
      const per = Math.min(names.length, 4);
      const left = at.x - (per * w + (per - 1) * 40) / 2;
      names.forEach((n, i) => {
        const x = left + (i % 4) * (w + 40);
        const y = at.y - h / 2 + Math.floor(i / 4) * (h + 40);
        add(frame({ x, y, w, h }, nextZ(), { title: n }));
        add(sticky({ x: x + 140, y: y + 160 }, nextZ(), { text: "Use and feel", color: STICKY_COLORS[0] }));
        add(sticky({ x: x + 380, y: y + 160 }, nextZ(), { text: "Furniture", color: STICKY_COLORS[4] }));
        add(sticky({ x: x + 140, y: y + 400 }, nextZ(), { text: "Finishes", color: STICKY_COLORS[1] }));
        add(sticky({ x: x + 380, y: y + 400 }, nextZ(), { text: "Lighting", color: STICKY_COLORS[3] }));
      });
      break;
    }
    case "kanban":
      columns(labels.length ? labels : ["To do", "Doing", "Done"], 460, 900, [STICKY_COLORS[0], STICKY_COLORS[4], STICKY_COLORS[5]], [["A task"], [""], [""]]);
      break;
    case "retro":
      columns(labels.length ? labels : ["Went well", "To improve", "Actions"], 460, 900, [STICKY_COLORS[5], STICKY_COLORS[2], STICKY_COLORS[4]]);
      break;
    case "mindmap": {
      const hub = add(shape("ellipse", { x: at.x - 160, y: at.y - 80, w: 320, h: 160 }, nextZ(), { fill: "#1f2421", stroke: "none", strokeWidth: 0, text: labels[0] ?? "The idea", textColor: "#ffffff", fontSize: 26 }));
      const branches = labels.length > 1 ? labels.slice(1) : ["Mood", "Colours", "Materials", "Furniture", "Lighting", "Budget"];
      branches.forEach((b, i) => {
        const a = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
        const p = { x: at.x + Math.cos(a) * 520, y: at.y + Math.sin(a) * 340 };
        const node = add(sticky(p, nextZ(), { text: b, color: STICKY_COLORS[i % STICKY_COLORS.length], w: 180, h: 120, x: p.x - 90, y: p.y - 60 }));
        add(connector({ id: hub.id, x: at.x, y: at.y }, { id: node.id, x: p.x, y: p.y }, nextZ(), { route: "curve", endArrow: false }));
      });
      break;
    }
    case "timeline": {
      const phases = labels.length ? labels : ["Brief", "Concept", "Design", "Documents", "Install"];
      const w = phases.length * 360;
      const x0 = at.x - w / 2;
      add(frame({ x: x0 - 60, y: at.y - 300, w: w + 120, h: 600 }, nextZ(), { title: "Timeline" }));
      add(shape("rect", { x: x0, y: at.y - 3, w, h: 6 }, nextZ(), { fill: "#1f2421", stroke: "none", strokeWidth: 0 }));
      phases.forEach((p, i) => {
        const cx = x0 + 180 + i * 360;
        add(shape("ellipse", { x: cx - 18, y: at.y - 18, w: 36, h: 36 }, nextZ(), { fill: "#ffffff", stroke: "#1f2421", strokeWidth: 3 }));
        add(text({ x: cx - 150, y: at.y - 90 }, nextZ(), { text: p, fontSize: 24, bold: true, align: "center", w: 300 }));
        add(sticky({ x: cx, y: at.y + 150 }, nextZ(), { text: "Milestone", color: STICKY_COLORS[i % STICKY_COLORS.length], w: 200, h: 140, x: cx - 100, y: at.y + 60 }));
      });
      break;
    }
    case "slides": {
      const w = 960;
      const h = 540;
      const titles = labels.length ? labels : ["Title", "The concept", "Next steps"];
      const left = at.x - (titles.length * w + (titles.length - 1) * 80) / 2;
      titles.forEach((t, i) => {
        const x = left + i * (w + 80);
        add(frame({ x, y: at.y - h / 2, w, h }, nextZ(), { title: `${i + 1}. ${t}` }));
        add(text({ x: x + 60, y: at.y - h / 2 + 60 }, nextZ(), { text: t, fontSize: 44, bold: true, w: w - 120, h: 60 }));
      });
      break;
    }
  }
  return out;
}
