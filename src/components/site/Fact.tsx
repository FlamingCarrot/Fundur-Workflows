import { COMPANY, FACT_LABELS, type CompanyFacts } from "@/lib/site/company";

/** A fact about the business, or a clearly marked gap where it has not been supplied yet. */
export function Fact({ k }: { k: keyof CompanyFacts }) {
  const value = COMPANY[k];
  if (value) return <>{value}</>;
  return <mark className="site-todo">To be added: {FACT_LABELS[k]}</mark>;
}

/** The contact email as a link, or its placeholder. */
export function EmailLink({ k = "email" }: { k?: "email" | "informationOfficerEmail" }) {
  const value = COMPANY[k] ?? (k === "informationOfficerEmail" ? COMPANY.email : null);
  if (value) return <a href={`mailto:${value}`}>{value}</a>;
  return <Fact k={k} />;
}
