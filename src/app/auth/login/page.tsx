import React from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, Key, Lock, Globe, ExternalLink } from "lucide-react";

export default function Auth0LoginPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "var(--bg, #0f1115)",
        color: "var(--fg, #e6e8ec)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "32rem",
          width: "100%",
          padding: "2rem",
          background: "var(--card-bg, #181a20)",
          borderRadius: "1rem",
          border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div
            style={{
              width: "2.5rem",
              height: "2.5rem",
              borderRadius: "0.5rem",
              background: "rgba(234, 88, 12, 0.15)",
              color: "#ea580c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldAlert size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Auth0 Tenant Configuration Required</h1>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.7 }}>Live authentication boundary is active</p>
          </div>
        </div>

        <p style={{ fontSize: "0.9rem", lineHeight: 1.5, opacity: 0.9, marginBottom: "1.25rem" }}>
          Mock authentication and demo content have been disabled. To complete sign-in with your real account, your live Auth0 credentials must be configured in <code>.env.local</code>.
        </p>

        <div
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            borderRadius: "0.5rem",
            padding: "1rem",
            fontSize: "0.82rem",
            fontFamily: "monospace",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", color: "#a5b4fc" }}>
            <Globe size={14} /> AUTH0_DOMAIN=&quot;your-tenant.us.auth0.com&quot;
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", color: "#a5b4fc" }}>
            <Key size={14} /> AUTH0_CLIENT_ID=&quot;&lt;your-client-id&gt;&quot;
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", color: "#a5b4fc" }}>
            <Lock size={14} /> AUTH0_CLIENT_SECRET=&quot;&lt;your-client-secret&gt;&quot;
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#a5b4fc" }}>
            <Lock size={14} /> AUTH0_SECRET=&quot;&lt;32-byte-hex-session-secret&gt;&quot;
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.6rem 1rem",
              borderRadius: "0.5rem",
              background: "rgba(255, 255, 255, 0.08)",
              color: "inherit",
              textDecoration: "none",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            <ArrowLeft size={16} /> Return to Studio
          </Link>
          <a
            href="https://manage.auth0.com"
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.6rem 1rem",
              borderRadius: "0.5rem",
              background: "#ea580c",
              color: "#fff",
              textDecoration: "none",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            Auth0 Dashboard <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </main>
  );
}
