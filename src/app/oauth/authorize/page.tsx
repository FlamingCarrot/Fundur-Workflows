import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { readAuthorizeRequest } from "@/lib/mcp/oauth";
import { memberships } from "@/lib/workspaces/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Connect an AI app · Fundur" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page" style={{ maxWidth: 560, margin: "8vh auto" }}>
      <section className="card" style={{ padding: "2rem" }}>
        {children}
      </section>
    </main>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <Shell>
      <h1 className="display-m">Can&rsquo;t connect this app</h1>
      <p className="muted" style={{ margin: "1rem 0" }}>
        {text}
      </p>
      <a className="btn btn-secondary" href="/settings/connections">
        Connected AI apps
      </a>
    </Shell>
  );
}

/**
 * Where an AI app (Claude, ChatGPT, Cursor…) sends her to connect to Fundur's
 * MCP server. She is signed in by now (the proxy sees to that); she sees which
 * app it is and where it sends her back to, and allows or refuses it.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) {
    const body = (await ws.json().catch(() => null)) as { error?: string } | null;
    return <Problem text={body?.error ?? "Sign in to Fundur first."} />;
  }
  const read = await readAuthorizeRequest(ws.db, params);
  if ("pageError" in read) return <Problem text={read.pageError} />;
  if ("redirectError" in read) {
    const e = read.redirectError;
    const url = new URL(e.uri);
    url.searchParams.set("error", e.error);
    url.searchParams.set("error_description", e.description);
    if (e.state) url.searchParams.set("state", e.state);
    redirect(url.toString());
  }
  const { client, redirectUri, codeChallenge, state } = read.ok;
  const workspaces = await memberships(ws.db, ws.user.id);
  let returnsTo = redirectUri;
  try {
    const u = new URL(redirectUri);
    returnsTo = u.protocol === "https:" || u.protocol === "http:" ? u.host : `${u.protocol}//`;
  } catch {
    // shown as given
  }

  return (
    <Shell>
      <p className="eyebrow" style={{ marginBottom: "0.5rem" }}>
        Connect an AI app
      </p>
      <h1 className="display-m">Let {client.name} use Fundur as you?</h1>
      <p className="muted" style={{ margin: "1rem 0" }}>
        It gets every tool Fundur&rsquo;s own assistant has, with your rights: it can read your projects, briefs, plans and library, and make changes
        for you. Changes are versioned and show in each project&rsquo;s assistant chat with an Undo. Deleting things, completing phases and other big
        changes wait for you to confirm in Fundur.
      </p>
      <p className="small muted" style={{ marginBottom: "1.25rem" }}>
        Signed in as <strong>{ws.user.email ?? ws.user.name}</strong>. It sends you back to <strong>{returnsTo}</strong>.
      </p>
      <form method="post" action="/api/oauth/authorize" className="stack" style={{ gap: "1rem" }}>
        <input type="hidden" name="client_id" value={client.clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        {state != null && <input type="hidden" name="state" value={state} />}
        {workspaces.length > 1 ? (
          <label className="field">
            <span className="field-label">Workspace</span>
            <select className="input" name="workspace" defaultValue={ws.workspaceId}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="workspace" value={ws.workspaceId} />
        )}
        <label className="row small" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
          <input type="checkbox" name="can_confirm" style={{ marginTop: 3 }} />
          <span>
            Also let it confirm big changes for me (deletes, completing phases, new projects). Leave this off unless you trust the app to ask you
            first.
          </span>
        </label>
        <div className="row" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
          <button type="submit" name="decision" value="allow" className="btn btn-primary">
            Allow
          </button>
          <button type="submit" name="decision" value="deny" className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}
