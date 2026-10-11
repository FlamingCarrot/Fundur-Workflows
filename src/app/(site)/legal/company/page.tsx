import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink, Fact } from "@/components/site/Fact";
import { siteUrl } from "@/lib/site/company";

export const metadata: Metadata = {
  title: "Company information",
  description: "Information about the business behind Fundur, as section 43 of the Electronic Communications and Transactions Act requires.",
};

export default function CompanyPage() {
  const rows: [string, React.ReactNode][] = [
    ["Trading name", <Fact key="t" k="tradingName" />],
    ["Full legal name", <Fact key="n" k="legalName" />],
    ["Legal status", <Fact key="s" k="legalStatus" />],
    ["Registration number", <Fact key="r" k="registrationNumber" />],
    ["Place of registration", <Fact key="p" k="placeOfRegistration" />],
    ["Directors or office bearers", <Fact key="o" k="officeBearers" />],
    ["VAT number", <Fact key="v" k="vatNumber" />],
    ["Physical address (also for service of legal documents)", <Fact key="a" k="physicalAddress" />],
    ["Postal address", <Fact key="pa" k="postalAddress" />],
    ["Telephone", <Fact key="ph" k="phone" />],
    ["Email", <EmailLink key="e" />],
    ["Website", siteUrl().host],
    ["Self-regulatory or accreditation bodies", <Fact key="m" k="memberships" />],
    ["Codes of conduct", <Fact key="c" k="codesOfConduct" />],
  ];
  return (
    <LegalDoc
      path="/legal/company"
      title="Company information"
      intro="Section 43 of the Electronic Communications and Transactions Act 25 of 2002 (ECTA) asks businesses that offer services online to publish who they are and how they trade. Here it is."
    >
      <h2>The business</h2>
      <div className="prose-table">
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The service</h2>
      <ul>
        <li>
          <strong>What it is:</strong> Fundur, an online platform for running multi-phase projects through workflows, with
          AI assistance. See <Link href="/features">Features</Link>.
        </li>
        <li>
          <strong>Price:</strong> free during the beta. No payment is taken and no payment details are collected. Paid plans, when they launch, will be billed
          through Whop. See{" "}
          <Link href="/pricing">Pricing</Link>.
        </li>
        <li>
          <strong>When it is provided:</strong> straight away, once you create an account.
        </li>
        <li>
          <strong>Duration:</strong> there is no minimum term. You can stop using Fundur and close your account at any
          time.
        </li>
        <li>
          <strong>Terms:</strong> our <Link href="/legal/terms">terms of service</Link>, which you can read, save and
          print from this website at any time.
        </li>
        <li>
          <strong>Your records:</strong> your projects and files stay available in your account while it is open, and you
          can ask us for a copy of your information.
        </li>
        <li>
          <strong>Refunds and cooling-off:</strong> nothing is paid during the beta, so no refund applies. When paid plans
          launch, your cooling-off rights under section 44 of ECTA and your rights under the Consumer Protection Act will
          apply where relevant.
        </li>
        <li>
          <strong>Security and privacy:</strong> see our <Link href="/legal/privacy">privacy policy</Link>. No payment
          information is processed during the beta; when paid plans launch, payments will be handled by Whop and we will
          not store full card details.
        </li>
        <li>
          <strong>Disputes:</strong> contact us first at <EmailLink />. Consumer complaints may be referred to the Consumer
          Goods and Services Ombud or the National Consumer Commission where the Consumer Protection Act applies.
        </li>
      </ul>
    </LegalDoc>
  );
}
