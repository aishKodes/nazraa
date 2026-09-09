import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicRequestForm } from "@/components/public-request-form";

type Section = { heading: string; paragraphs?: string[]; bullets?: string[] };
type Page = { title: string; intro: string; sections: Section[]; form?: "support" | "deletion" };

const pages: Record<string, Page> = {
  privacy: {
    title: "Privacy Policy",
    intro: "This policy explains how Nazraa Live collects, uses, protects, retains, and deletes information when you use our social, Live, Party, messaging, Agency, rewards, games, and purchase features.",
    sections: [
      { heading: "Information we collect", bullets: ["Account identifiers and profile data, including name, email, phone number where supplied, date of birth, gender, country, language, profile text, and profile images.", "Verification selfies and, for Agency applications, submitted identity documents such as Aadhaar images where the application flow requests them. These files are private, encrypted, and available only to authorized reviewers.", "User-generated content and activity, including Find posts and images, messages, room chat, Live audio/video, room participation, reports, blocks, gifts, followers, and moderation events.", "Coins, Diamonds, purchases, rewards, exchanges, transaction history, and historic payout/bank or UPI records retained from earlier functionality.", "Device identifiers used for session security and device restrictions, IP address, security logs, diagnostics, notification tokens, and support communications."] },
      { heading: "How we use information", paragraphs: ["We use information to create and secure accounts, provide Live and social features, process virtual purchases and rewards, operate Agencies, review verification, prevent abuse and fraud, investigate reports, provide support, meet legal obligations, and improve reliability. Host reward decisions are made server-side from the configured rule and qualifying session facts; the app cannot alter a completed payout decision."] },
      { heading: "Processors and sharing", paragraphs: ["Nazraa uses service providers only as needed to operate the service. Current flows include Google for sign-in, Play Billing, notifications and Android services; ZEGO for real-time audio/video; hosting, database, storage and network providers for the Nazraa backend and encrypted files; and diagnostic providers included in the released app. We may disclose information when lawfully required, to protect users, or during a business reorganization. We do not sell verification selfies or private messages."] },
      { heading: "Live audio and video", paragraphs: ["Live streams and Party audio are transmitted to room participants through ZEGO and Nazraa infrastructure. Stream and room history may be retained for safety, audit, and service integrity. Nazraa does not promise that other users will not record public content using their devices."] },
      { heading: "Security and retention", paragraphs: ["Data is encrypted in transit. Sensitive verification and Agency documents are encrypted at rest and are not exposed through public storage URLs. We retain account and content data while needed to provide the service. We remove or anonymize public/profile data after a valid deletion request, while retaining limited transaction, fraud, security, moderation, and legally required financial audit records for their applicable retention periods."] },
      { heading: "Your choices and rights", paragraphs: ["You can edit profile data, report or block users, request access or correction through Support, and delete your account in the app or initiate deletion on the web. Rights vary by location. We verify requests before disclosing or deleting account data."] },
      { heading: "Contact", paragraphs: ["Nazraa Live is the developer and service name. Send privacy requests through the monitored Nazraa Support page. Child-safety emergencies should use the Child Safety category so they enter the priority moderation queue."] },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "These Terms govern use of Nazraa Live. By creating an account or participating in user-generated content, you agree to the current Terms and Community Guidelines.",
    sections: [
      { heading: "Eligibility and accounts", paragraphs: ["Nazraa is an adult-oriented social service and is not directed to children. You must meet the minimum age shown in the app and be legally able to accept these Terms. Keep account credentials secure, provide accurate information, and do not transfer or impersonate accounts."] },
      { heading: "Conduct and content", paragraphs: ["You are responsible for content you upload, stream, send, or say. You grant Nazraa a limited, worldwide licence to host, transmit, display, moderate, and technically process that content solely to operate and promote the service. You keep your ownership rights. Prohibited conduct is detailed in the Community Guidelines."] },
      { heading: "Coins, Diamonds, gifts and cosmetics", paragraphs: ["Coins are virtual in-app currency purchased through the authorized Play flow or provided by Nazraa. Diamonds are virtual creator/reward points. Neither is cash, a deposit, legal tender, or guaranteed to have monetary value. Virtual gifts, VIP benefits, frames, effects, and other cosmetics are digital experiences, may expire where disclosed, and may be changed or removed for safety, legal, or technical reasons."] },
      { heading: "Games", paragraphs: ["Nazraa games use virtual Coins and server-authoritative outcomes. They do not offer cash prizes in the Play v1 product. Chance and simulated game outcomes are entertainment features, not a way to earn guaranteed income. Rules, odds/RTP configuration, and limits may be managed remotely."] },
      { heading: "Live, Hosts and Agencies", paragraphs: ["Hosts and Agency Owners remain responsible for their Live content and room conduct. Live eligibility, time windows, verification, Agency authorization, moderation restrictions, and virtual reward rules are server-authoritative. Rewards are not salary or guaranteed earnings. Agency participation does not create employment, partnership, or a guaranteed payment entitlement."] },
      { heading: "Purchases and refunds", paragraphs: ["Play-distributed Coin purchases use Google Play Billing. Prices and product availability appear before purchase. Refund requests are governed by applicable law and Google Play processes described on the Refunds page. Duplicate or invalid callbacks do not create duplicate Coins."] },
      { heading: "Moderation and termination", paragraphs: ["Nazraa may warn users, remove content, restrict Live access temporarily, ban accounts, or restrict devices when reasonably needed to enforce these Terms, protect users, prevent fraud, or comply with law. Appeals and support requests may be submitted through Support. Users can delete their account through Settings or the web deletion page."] },
      { heading: "Disclaimers and liability", paragraphs: ["The service is provided on an as-available basis to the extent permitted by applicable law. Live and user-generated content comes from users and may not reflect Nazraa's views. Nothing in these Terms excludes rights or liability that cannot legally be excluded. The governing law and jurisdiction are those applicable to the verified Play-listed developer and the user; Nazraa does not fabricate a jurisdiction where one has not been configured."] },
    ],
  },
  "community-guidelines": {
    title: "Community Guidelines",
    intro: "Nazraa is built for social connection. These rules apply to profiles, Live, Party, messages, Find posts, images, games, gifts, usernames, and Agency activity.",
    sections: [
      { heading: "Not allowed", bullets: ["Nudity, explicit sexual content, sexual solicitation, non-consensual intimate imagery, or sexual exploitation.", "Child sexual abuse or exploitation, CSAM, grooming, trafficking, or any exploitation of minors.", "Harassment, bullying, credible threats, hate or dehumanizing attacks, doxxing, privacy abuse, or encouragement of violence or extremist activity.", "Scams, fraud, impersonation, misleading financial claims, illegal goods or activity, spam, coordinated manipulation, or evasion of enforcement.", "Copyright infringement or uploading/streaming material you do not have the right to use."] },
      { heading: "Reporting and blocking", paragraphs: ["Use the clearly labelled Report User, Report Host, Report Room, Report Content, or Report controls in Nazraa. Use Block User to stop relevant direct interactions. Child-safety reports enter a critical-priority queue. Reports include the relevant account, room, content or message reference so trained reviewers can investigate."] },
      { heading: "Consequences", paragraphs: ["Nazraa may remove content, issue warnings, impose a temporary Live restriction, suspend or ban an account, and apply a device restriction. Actions are permission-controlled and audited. Temporary Live blocks expire automatically at their configured time; global Live hours remain a separate rule."] },
    ],
  },
  "child-safety": {
    title: "Child Safety Standards",
    intro: "Nazraa has zero tolerance for child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM). Nazraa is an adult-oriented Social app and does not target children.",
    sections: [
      { heading: "Prohibited conduct", bullets: ["Creating, uploading, streaming, requesting, possessing, sharing, or attempting to obtain CSAM.", "Grooming, sexualizing, coercing, trafficking, sextorting, or otherwise exploiting a minor.", "Using Nazraa to arrange sexual contact with a minor or to normalize or facilitate child abuse."] },
      { heading: "How to report", paragraphs: ["In the app, choose Report and select Child safety. On the web, use the Support form below and select Child Safety. Include the Nazraa user ID, room/content reference, time, and a concise description. Do not download, copy, or redistribute suspected CSAM to document a report."] },
      { heading: "Our response", paragraphs: ["Child-safety reports are prioritized as critical. Nazraa may preserve evidence, remove content, terminate Live sessions, restrict accounts/devices, and report apparent violations to competent authorities or designated child-safety organizations where required by applicable law. Nazraa complies with applicable child-safety reporting and preservation obligations."] },
      { heading: "Monitored contact", paragraphs: ["The Child Safety category on Nazraa Support is the monitored escalation route. If a child is in immediate danger, contact local emergency services first."] },
    ],
    form: "support",
  },
  "account-deletion": {
    title: "Delete Your Nazraa Account",
    intro: "In the app, go to Profile → Settings → Account → Delete Account. If you cannot access the app, initiate a deletion request below using the email and Nazraa ID associated with the account.",
    sections: [
      { heading: "What deletion does", paragraphs: ["Authenticated in-app deletion revokes sessions and removes or anonymizes sign-in identifiers, public profile data, profile image, public Find content, private verification selfie, and message text associated with the account. Deletion is not a ban, freeze, or temporary deactivation."] },
      { heading: "Limited retained records", paragraphs: ["Nazraa retains opaque account references and limited wallet, transaction, gift, purchase, moderation, fraud/security, and legally required financial audit records where necessary. These retained records are not used to recreate a public profile. Web requests require identity review before processing to prevent unauthorized deletion."] },
    ],
    form: "deletion",
  },
  support: {
    title: "Nazraa Support",
    intro: "Send a request to the monitored Nazraa Support queue. Choose the category that best matches your issue so it reaches the right reviewers.",
    sections: [
      { heading: "We can help with", bullets: ["Account and sign-in support", "Photo verification and Agency application support", "Google Play purchase support", "Safety reports and urgent child-safety escalation", "Privacy/data requests and account deletion", "Copyright complaints"] },
      { heading: "What to include", paragraphs: ["Include your Nazraa ID where relevant, the approximate time, and the room, content, message, or Google Play order reference. Never send passwords, OTPs, full bank details, or unredacted identity documents through this form."] },
    ],
    form: "support",
  },
  refunds: {
    title: "Refund Policy",
    intro: "Coin purchases in the Google Play version of Nazraa are processed by Google Play Billing.",
    sections: [
      { heading: "Requesting a refund", paragraphs: ["Use Google Play's purchase history and refund request process for eligible Play purchases. Eligibility and timing are determined by Google Play policies and applicable consumer law. Nazraa Support can investigate missing Coins or duplicate delivery using the Play order reference, but does not promise a refund the platform cannot issue."] },
      { heading: "Virtual items", paragraphs: ["Consumed Coins, sent gifts, claimed digital benefits, VIP access, and cosmetics generally cannot be reversed after delivery except where required by law or where Nazraa confirms a delivery error. The Play mobile app does not advertise external recharge methods."] },
    ],
  },
  copyright: {
    title: "Copyright Complaints",
    intro: "Report copyrighted profile images, Find posts/media, or Live content through Nazraa Support.",
    sections: [
      { heading: "Required information", bullets: ["Your name and monitored contact email.", "A clear description of the copyrighted work and why you are authorized to report it.", "The Nazraa user ID, room ID, post reference, profile, and approximate time needed to locate the material.", "A good-faith statement that the disputed use is not authorized, and confirmation that the information supplied is accurate."] },
      { heading: "Review process", paragraphs: ["Nazraa may request additional information, preserve relevant evidence, remove or restrict content, and notify the affected user where appropriate. Repeat infringement may lead to account restrictions. Nazraa does not claim a formal DMCA process or jurisdiction unless that process is applicable to the verified legal entity and complaint."] },
    ],
    form: "support",
  },
};

export function generateStaticParams() { return Object.keys(pages).map((policy) => ({ policy })); }

export async function generateMetadata({ params }: { params: Promise<{ policy: string }> }): Promise<Metadata> {
  const { policy } = await params;
  const page = pages[policy];
  return page ? { title: `${page.title} | Nazraa Live`, description: page.intro, robots: { index: true, follow: true } } : {};
}

export default async function PublicPolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  const page = pages[policy];
  if (!page) notFound();
  return <article className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-300">Nazraa Live · Last updated 6 September 2026</p>
    <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">{page.title}</h1>
    <p className="mt-6 text-lg leading-8 text-slate-300">{page.intro}</p>
    <div className="mt-10 space-y-9">
      {page.sections.map((section) => <section key={section.heading} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <h2 className="text-xl font-semibold text-white">{section.heading}</h2>
        {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-3 leading-7 text-slate-300">{paragraph}</p>)}
        {section.bullets && <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-300">{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>)}
    </div>
    {page.form && <div className="mt-10"><PublicRequestForm mode={page.form} defaultCategory={policy === "child-safety" ? "CHILD_SAFETY" : policy === "copyright" ? "COPYRIGHT" : undefined} /></div>}
  </article>;
}
