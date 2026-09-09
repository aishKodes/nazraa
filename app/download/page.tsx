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
    "Download the latest official Nazraa Android APK and verify its SHA-256 checksum.",
  robots: { index: true, follow: true },
};

export default function DownloadPage() {
  const release = latestPublicRelease;
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <img src="/nazraa-logo.jpg" alt="Nazraa Live" />
          <span>Nazraa Live</span>
        </Link>
        <Link className={styles.navDownload} href="/">
          Back to Nazraa
        </Link>
      </header>
      <section className={styles.section}>
        <div className={styles.sectionIntro}>
          <span className={styles.eyebrow}>Official Android release</span>
          <h2 style={{ marginTop: 18 }}>Download Nazraa</h2>
          <p>
            Install the current official Android release. Your browser may ask
            for permission to install apps from this source; that is normal for
            a direct APK download.
          </p>
        </div>
        <div
          className={styles.releaseCard}
          style={{ marginTop: 34 }}
          id="download"
        >
          <div>
            <h2>Version {release.version}</h2>
            <p>
              Build {release.build} · released{" "}
              {new Intl.DateTimeFormat("en", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${release.releaseDate}T00:00:00Z`))}
            </p>
            <div className={styles.releaseMeta}>
              <span>{releaseFileSize(release.apkSizeBytes)}</span>
              <span>{release.minimumAndroidVersion}</span>
            </div>
          </div>
          {release.apkUrl ? (
            <a className={styles.downloadButton} href={release.apkUrl}>
              Download APK
            </a>
          ) : (
            <span className={styles.downloadButton} aria-disabled="true">
              Release link preparing
            </span>
          )}
        </div>
        <div className={styles.featureGrid} style={{ marginTop: 22 }}>
          <article className={styles.feature}>
            <div className={styles.featureIcon}>1</div>
            <h3>Download</h3>
            <p>
              Use the official Download APK button when the release link is
              published.
            </p>
          </article>
          <article className={styles.feature}>
            <div className={styles.featureIcon}>2</div>
            <h3>Install</h3>
            <p>
              Open the downloaded file and follow Android&apos;s installation
              prompt.
            </p>
          </article>
          <article className={styles.feature}>
            <div className={styles.featureIcon}>3</div>
            <h3>Verify</h3>
            <p>
              For extra assurance, compare the file checksum below with the
              downloaded APK.
            </p>
          </article>
        </div>
        <section className={styles.section} style={{ paddingBottom: 20 }}>
          <div className={styles.sectionIntro}>
            <h2 style={{ fontSize: 28 }}>Release notes</h2>
          </div>
          <div className={styles.featureGrid}>
            {release.releaseNotes.map((note, index) => (
              <article className={styles.feature} key={note}>
                <div className={styles.featureIcon}>0{index + 1}</div>
                <p style={{ marginTop: 16 }}>{note}</p>
              </article>
            ))}
          </div>
          <p
            className={styles.checksum}
            style={{ marginTop: 32, color: "#625775", fontSize: 12 }}
          >
            <strong>SHA-256</strong>
            <br />
            {release.sha256}
          </p>
        </section>
      </section>
      <footer className={styles.footer}>
        <span>
          Need help? <Link href="/support">Contact Nazraa Support</Link>.
        </span>
        <nav className={styles.footerLinks}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/community-guidelines">Guidelines</Link>
        </nav>
      </footer>
    </main>
  );
}
