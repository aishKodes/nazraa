import type { Metadata } from "next";
import Link from "next/link";
import styles from "../marketing.module.css";
import {
  latestPublicRelease,
  releaseFileSize,
} from "@/lib/release/latest-release";

export const metadata: Metadata = {
  title: "Download Nazraa for Android",
  description:
    "Download the latest official Nazraa Android APK, review its release notes, and verify its SHA-256 checksum.",
  robots: { index: true, follow: true },
};

const installSteps = [
  ["01", "Download the APK", "Use the official button below. Your browser will save the Nazraa APK to Downloads."],
  ["02", "Open the file", "Tap the finished download and follow Android’s installation prompt."],
  ["03", "Join Nazraa", "Open Nazraa, sign in or create an account, then find a room that fits your mood."],
] as const;

export default function DownloadPage() {
  const release = latestPublicRelease;
  const releaseDate = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${release.releaseDate}T00:00:00Z`));

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Nazraa Live home">
          <img src="/nazraa-logo.jpg" alt="Nazraa Live" />
          <span>Nazraa <em>Live</em></span>
        </Link>
        <Link className={styles.navDownload} href="/">
          <span aria-hidden="true">←</span> Back to Nazraa
        </Link>
      </header>

      <section className={styles.downloadHero}>
        <div>
          <span className={styles.eyebrow}><i aria-hidden="true" /> Official Android release</span>
          <h1>Download Nazraa<br /><span>with confidence.</span></h1>
          <p>
            This page always points to the current official Nazraa Android
            release and provides the information you need to verify it.
          </p>
          <div className={styles.downloadTrust}>
            <span><b>✓</b> Official release source</span>
            <span><b>✓</b> SHA-256 published</span>
            <span><b>✓</b> Android 7.0+</span>
          </div>
        </div>
        <aside className={styles.versionCard} id="download">
          <div className={styles.versionIcon} aria-hidden="true">N</div>
          <span className={styles.versionLabel}>CURRENT RELEASE</span>
          <h2>v{release.version}</h2>
          <p>Build {release.build} · {releaseDate}</p>
          <div className={styles.versionSpecs}>
            <span>{releaseFileSize(release.apkSizeBytes)}</span>
            <span>{release.minimumAndroidVersion}</span>
          </div>
          {release.apkUrl ? (
            <a className={styles.downloadButton} href={release.apkUrl}>Download APK <span aria-hidden="true">↓</span></a>
          ) : (
            <span className={styles.downloadButton} aria-disabled="true">Release link preparing</span>
          )}
          <small>Published release file · not an in-app update</small>
        </aside>
      </section>

      <section className={styles.downloadSection}>
        <div className={styles.sectionIntro}>
          <span className={styles.sectionKicker}>THREE SIMPLE STEPS</span>
          <h2>From download to first room.</h2>
        </div>
        <div className={styles.installGrid}>
          {installSteps.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span><h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.releaseNotes}>
        <div className={styles.notesHeading}>
          <span className={styles.sectionKicker}>WHAT&apos;S IN THIS RELEASE</span>
          <h2>Built for a smoother room.</h2>
          <p>Released {releaseDate}</p>
        </div>
        <ol>
          {release.releaseNotes.map((note, index) => (
            <li key={note}><span>0{index + 1}</span><p>{note}</p></li>
          ))}
        </ol>
      </section>

      <section className={styles.verifySection}>
        <div>
          <span className={styles.sectionKicker}>OPTIONAL FILE CHECK</span>
          <h2>Verify the download.</h2>
          <p>
            If you use a checksum tool, compare the downloaded APK’s SHA-256
            value with the official value below. They must match exactly.
          </p>
        </div>
        <code className={styles.checksum}>{release.sha256}</code>
      </section>

      <section className={styles.helpStrip}>
        <div><span>Need a hand?</span><h2>We&apos;re here to help.</h2></div>
        <p>For installation, account, verification, safety, or privacy questions, contact Nazraa Support.</p>
        <Link className={styles.helpLink} href="/support">Visit support <span aria-hidden="true">→</span></Link>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}>
          <img src="/nazraa-logo.jpg" alt="" /> <span>Nazraa <em>Live</em></span>
        </Link>
        <p>© 2026 Nazraa Live. Built for live social entertainment.</p>
        <nav className={styles.footerLinks} aria-label="Legal and support">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/community-guidelines">Guidelines</Link>
          <Link href="/support">Support</Link>
        </nav>
      </footer>
    </main>
  );
}
