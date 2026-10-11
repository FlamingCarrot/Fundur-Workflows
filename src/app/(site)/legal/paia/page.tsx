import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink, Fact } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "PAIA manual",
  description:
    "Fundur's manual under section 51 of the Promotion of Access to Information Act, including how to request records.",
};

export default function PaiaPage() {
  return (
    <LegalDoc
      path="/legal/paia"
      title="PAIA manual"
      intro="This manual is published under section 51 of the Promotion of Access to Information Act 2 of 2000 (PAIA). It explains what records we hold and how to ask for access to them."
    >
      <h2>1. Our details</h2>
      <ul>
        <li>
          Name: <Fact k="legalName" />, trading as Fundur
        </li>
        <li>
          Head of the body and Information Officer: <Fact k="informationOfficer" />
        </li>
        <li>
          Physical address: <Fact k="physicalAddress" />
        </li>
        <li>
          Postal address: <Fact k="postalAddress" />
        </li>
        <li>
          Telephone: <Fact k="phone" />
        </li>
        <li>
          Email: <EmailLink k="informationOfficerEmail" />
        </li>
      </ul>

      <h2>2. The Information Regulator&apos;s guide</h2>
      <p>
        The Information Regulator publishes a guide, in each official language, on how to use PAIA and POPIA. It is
        available from the Information Regulator at{" "}
        <a href="https://inforegulator.org.za" rel="noopener noreferrer" target="_blank">
          inforegulator.org.za
        </a>
        , and you may ask us for a copy.
      </p>

      <h2>3. Records available without a request</h2>
      <p>
        Everything published on this website, including our <Link href="/legal/terms">terms</Link>,{" "}
        <Link href="/legal/privacy">privacy policy</Link> and this manual, is available without a formal request.
      </p>

      <h2>4. Records kept under other laws</h2>
      <p>
        Where they apply to us, we keep records under laws including the Companies Act 71 of 2008, the Income Tax Act 58
        of 1962, the Value-Added Tax Act 89 of 1991, the Tax Administration Act 28 of 2011, the Basic Conditions of
        Employment Act 75 of 1997, the Labour Relations Act 66 of 1995, the Consumer Protection Act 68 of 2008, the
        Electronic Communications and Transactions Act 25 of 2002 and the Protection of Personal Information Act 4 of
        2013.
      </p>

      <h2>5. Records we hold</h2>
      <ul>
        <li>Company records: incorporation documents, registers, minutes and resolutions.</li>
        <li>Financial and tax records: accounts, invoices, banking and tax records.</li>
        <li>People records: contracts and records about anyone who works with us.</li>
        <li>Customer records: account details, workspace content, AI usage logs, app usage data and correspondence.</li>
        <li>Supplier records: agreements with service providers such as hosting, database, sign-in and AI providers.</li>
        <li>Technical records: security, access and backup logs.</li>
      </ul>

      <h2>6. Processing personal information</h2>
      <p>
        Our <Link href="/legal/privacy">privacy policy</Link> sets out the purposes for which we process personal
        information, the people it relates to and the categories of information, who we share it with, transfers outside
        South Africa and the security measures we use, as section 51(1)(c) of PAIA requires.
      </p>

      <h2>7. How to request access</h2>
      <ol>
        <li>Complete the prescribed request form (Form 2 under the PAIA regulations), available from the Information Regulator or from us.</li>
        <li>Send it to our Information Officer at the email or address above, with proof of identity.</li>
        <li>Say which record you want, how you want to receive it, and which right you are exercising or protecting.</li>
        <li>Pay any request and access fees prescribed in the PAIA regulations. You will be told the amount before any access fee is payable.</li>
      </ol>
      <p>
        We will decide on your request within 30 days, or tell you if we need the extension PAIA allows. We may refuse
        access only on the grounds in Chapter 4 of Part 3 of PAIA, and will give reasons. If you are unhappy with our
        decision, you may complain to the Information Regulator or apply to court.
      </p>
      <p>
        If you only want to see or correct your own personal information, it is usually quicker to email{" "}
        <EmailLink k="informationOfficerEmail" /> as our privacy policy explains.
      </p>

      <h2>8. Availability of this manual</h2>
      <p>
        This manual is available on this website and, on request, at our physical address. We may update it from time
        to time.
      </p>
    </LegalDoc>
  );
}
