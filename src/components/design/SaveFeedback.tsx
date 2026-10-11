"use client";
import type { useDesign } from "./useDesign";
export function SaveFeedback({
  editor,
}: {
  editor: ReturnType<typeof useDesign>;
}) {
  return (
    <>
      {editor.error && (
        <div className="design-banner" role="alert">
          <p>{editor.error}</p>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() =>
              editor.data ? void editor.flush() : window.location.reload()
            }
          >
            {editor.data ? "Retry save" : "Reload project"}
          </button>
        </div>
      )}
      {editor.conflict && (
        <div className="design-banner" role="alert">
          <p>
            Another window saved this project. Your draft is kept here. Choosing
            your draft replaces that saved version.
          </p>
          <div className="row wrap">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => editor.resolve(true)}
            >
              Use saved version
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => editor.resolve(false)}
            >
              Save my draft instead
            </button>
          </div>
        </div>
      )}
      {!editor.data && !editor.error && (
        <p className="muted">Loading the project…</p>
      )}
    </>
  );
}
