"use client";

import React from "react";
import { X } from "lucide-react";

/**
 * Every keyboard and mouse shortcut in the plan editor, in one place (Revit's
 * Keyboard Shortcuts list), with the arrow-key step, which is remembered.
 */

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const GROUPS = (nudge: number, mod: string): { title: string; rows: [string, string][] }[] => [
  {
    title: "Selecting",
    rows: [
      ["Click", "Select one thing"],
      [`${mod} or Shift + click`, "Add it to the selection, or take it out"],
      [`${mod} or Shift + drag left to right`, "Select what is wholly inside the box"],
      [`${mod} or Shift + drag right to left`, "Select whatever the box touches"],
      [`${mod}+A`, "Select everything shown on this floor"],
      ["Esc", "Clear the selection, or stop drawing"],
      ["Enter", "Go to the first field of what is selected"],
      ["Esc in a field", "Leave the field without changing it"],
    ],
  },
  {
    title: "Changing what is selected",
    rows: [
      ["Drag", "Move it (several selected move together)"],
      ["Alt + drag", "Copy it; the original stays and is marked"],
      ["Arrow keys", `Nudge ${nudge} mm`],
      ["Shift + arrow keys", `Nudge ${nudge * 10} mm`],
      ["Space / Shift+Space", "Turn 90° one way or the other"],
      ["Shift+H / Shift+V", "Mirror left to right / top to bottom"],
      [`${mod}+D`, "Copy it, set a little to one side"],
      [`${mod}+C, ${mod}+X, ${mod}+V`, "Copy, cut, and put down at the pointer, on any floor"],
      ["Delete or Backspace", "Remove it"],
      [`${mod}+Z / ${mod}+Shift+Z`, "Undo / redo"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      ["Type a number, then Enter", "A wall of that length, in mm, towards the pointer"],
      ["Alt while drawing", "Any angle, not just 45° steps"],
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
      ["?", "This list"],
    ],
  },
];

export function ShortcutsSheet({
  nudge,
  nudges,
  onNudge,
  onClose,
  tools,
}: {
  nudge: number;
  nudges: number[];
  onNudge: (n: number) => void;
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
        <div className="stack" style={{ gap: "0.4rem", marginBottom: "1.25rem" }}>
          <span className="field-label">Arrow keys move things by</span>
          <div className="segmented" role="group" aria-label="Arrow keys move things by">
            {nudges.map((n) => (
              <button key={n} type="button" aria-pressed={nudge === n} onClick={() => onNudge(n)}>
                {n} mm
              </button>
            ))}
          </div>
          <span className="tiny muted">Shift moves ten times as far. Kept for next time.</span>
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
          {GROUPS(nudge, mod).map((g) => (
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
