/**
 * Facts about the business that the public site and legal pages quote.
 *
 * A null value has not been supplied yet: pages show it as a marked
 * placeholder ("To be added: ...") rather than a made-up value, so filling
 * one in here updates every page that mentions it.
 */

export interface CompanyFacts {
  /** The name people know the product by. */
  tradingName: string;
  /** Registered legal name, e.g. "Example (Pty) Ltd". */
  legalName: string | null;
  /** Legal form, e.g. "Private company" or "Sole proprietor". */
  legalStatus: string | null;
  /** CIPC registration number. */
  registrationNumber: string | null;
  /** Where the business is registered. */
  placeOfRegistration: string;
  /** Directors or other office bearers. */
  officeBearers: string | null;
  /** VAT number, or a note that the business is not VAT registered. */
  vatNumber: string | null;
  /** Physical address, which is also the address for service of legal documents. */
  physicalAddress: string | null;
  postalAddress: string | null;
  phone: string | null;
  email: string | null;
  /** POPIA Information Officer (by default the head of the business). */
  informationOfficer: string | null;
  informationOfficerEmail: string | null;
  /** Self-regulatory bodies the business belongs to, or "None". */
  memberships: string | null;
  /** Codes of conduct the business subscribes to, or "None". */
  codesOfConduct: string | null;
  /** Who builds the product, as named on the About page. */
  founder: string;
}

export const COMPANY: CompanyFacts = {
  tradingName: "Fundur",
  legalName: null,
  legalStatus: null,
  registrationNumber: null,
  placeOfRegistration: "Republic of South Africa",
  officeBearers: null,
  vatNumber: null,
  physicalAddress: null,
  postalAddress: null,
  phone: null,
  email: null,
  informationOfficer: null,
  informationOfficerEmail: null,
  memberships: null,
  codesOfConduct: null,
  founder: "Andre Swanepoel",
};

/** Labels used when a fact is still missing. */
export const FACT_LABELS: Record<keyof CompanyFacts, string> = {
  tradingName: "trading name",
  legalName: "registered company name",
  legalStatus: "legal status (for example private company)",
  registrationNumber: "CIPC registration number",
  placeOfRegistration: "place of registration",
  officeBearers: "directors or office bearers",
  vatNumber: "VAT number (or “not VAT registered”)",
  physicalAddress: "physical address",
  postalAddress: "postal address",
  phone: "telephone number",
  email: "contact email",
  informationOfficer: "Information Officer’s name",
  informationOfficerEmail: "Information Officer’s email",
  memberships: "self-regulatory bodies (or “none”)",
  codesOfConduct: "codes of conduct (or “none”)",
  founder: "founder",
};

/** The date the legal pages were last changed. */
export const LEGAL_UPDATED = "7 October 2026";

/** The site's public address, for links in metadata, the sitemap and robots.txt. */
export function siteUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.AUTH0_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  try {
    return new URL(configured || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
