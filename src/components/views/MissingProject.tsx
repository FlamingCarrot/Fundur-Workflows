import Link from "next/link";
import { SearchX } from "lucide-react";

export function MissingProject() {
  return (
    <div className="card" style={{ padding: "3rem 1.5rem", textAlign: "center", maxWidth: 520, margin: "4rem auto" }}>
      <span className="dropzone-icon" style={{ margin: "0 auto 1rem" }}>
        <SearchX size={22} />
      </span>
      <h1 className="display-s" style={{ marginBottom: "0.4rem" }}>We couldn&apos;t find that project</h1>
      <p className="small muted" style={{ marginBottom: "1.5rem" }}>It may have been removed, or the link is out of date.</p>
      <Link href="/projects" className="btn btn-primary">See all projects</Link>
    </div>
  );
}
