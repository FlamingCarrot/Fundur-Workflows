"use client";

import React from "react";
import { X } from "lucide-react";

/**
 * Every keyboard and mouse shortcut in the plan editor, in one place (Revit's
 * Keyboard Shortcuts list).
 */

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const GROUPS = (mod: string): { title: string; rows: [string, string][] }[] => [
  {
    title: "Selecting",
    rows: [
      ["Click", "Select one thing"],
      ["Shift + click", "Add anything to the selection, or take it out"],
      [`${mod} + drag left to right`, "Select what is wholly inside the box"],
      [`${mod} + drag right to left`, "Select what the box touches"],
      ["Esc", "Clear the selection, or stop drawing"],
      ["Click a distance label", "Type the distance to move it to"],
    ],
  },
  {
    title: "Changing what is selected",
    rows: [
      ["Drag", "Move it (selected furniture moves together)"],
      ["Alt + drag", "Copy it; the original stays and is marked"],
      ["Arrow keys", "Nudge 10 mm"],
      ["Shift + arrow keys", "Nudge 100 mm"],
      ["Space", "Turn it 90°"],
      [`${mod}+D`, "Copy it, set a little to one side"],
      [`${mod}+C / ${mod}+V`, "Copy, then paste here or in the same place on another floor"],
      ["Delete or Backspace", "Remove it"],
      [`${mod}+Z / ${mod}+Shift+Z`, "Undo / redo"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      ["Type a number, then Enter", "A wall of that length, in mm, towards the pointer"],
      ["Alt while drawing or dragging", "Any angle, and no snapping"],
      ["Double-click or Esc", "Stop drawing walls"],
      ["Backspace", "Take back the last corner of an outline or a measure"],
      ["Space while placing furniture", "Turn it before it goes down"],
    ],
  },
  {
    title: "Looking around",
    rows: [
      ["Drag empty space", "Move around the plan"],
      ["Scroll or pinch", "Zoom in and out about the pointer"],
      ["F", "Fit the floor to the screen"],
      ["Page Up / Page Down", "The floor above or below"],
      ["1 / 3 / 7 in 3D", "Front, right and top views (Shift for the opposite side)"],
      ["5 / 0 in 3D", "Perspective or parallel / the 3D overview"],
      ["?", "This list"],
    ],
  },
];

export function ShortcutsSheet({
  onClose,
  tools,
}: {
  onClose: () => void;
  tools: { key: string; label: string }[];
}) {
  const mod = isMac() ? "⌘" : "Ctrl";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet plan-shortcuts"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "?") onClose();
        }}
      >
        <div className="row-between" style={{ marginBottom: "0.75rem" }}>
          <h2 className="display-s">Keyboard shortcuts</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <X size={18} />
          </button>
        </div>
        <div className="plan-shortcut-groups">
          <section>
            <h3 className="eyebrow">Tools</h3>
            <dl className="plan-keys">
              {tools.map((t) => (
                <React.Fragment key={t.key}>
                  <dt><kbd>{t.key}</kbd></dt>
                  <dd>{t.label}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
          {GROUPS(mod).map((g) => (
            <section key={g.title}>
              <h3 className="eyebrow">{g.title}</h3>
              <dl className="plan-keys">
                {g.rows.map(([keys, what]) => (
                  <React.Fragment key={keys}>
                    <dt><kbd>{keys}</kbd></dt>
                    <dd>{what}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
