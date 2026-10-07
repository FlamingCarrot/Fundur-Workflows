export default function AccessDenied() {
  return (
    <main className="page" style={{ maxWidth: 680, margin: "8vh auto" }}>
      <section className="card" style={{ padding: "2.5rem" }}>
        <h1 className="display-m">Access unavailable</h1>
        <p className="muted" style={{ margin: "1rem 0" }}>
          Your account or workspace access has been deactivated. Contact your
          workspace administrator.
        </p>
        <a className="btn btn-secondary" href="/auth/logout">
          Sign out
        </a>
      </section>
    </main>
  );
}
