import type { Metadata } from "next";
import Link from "next/link";
import styles from "./marketing.module.css";
import {
  latestPublicRelease,
  releaseFileSize,
} from "@/lib/release/latest-release";

export const metadata: Metadata = {
  title: "Nazraa Live — Go Live. Find Your Crowd.",
  description:
    "Nazraa is a live social entertainment app for rooms, conversations, communities, virtual gifts, and games.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Nazraa Live — Go Live. Find Your Crowd.",
    description:
      "Live rooms, real conversations, communities, and social entertainment.",
    images: [{ url: "/nazraa-logo.jpg", width: 128, height: 128 }],
  },
};

const features = [
  ["◉", "Live Face Rooms", "Watch, host, and share the moment live."],
  ["◌", "Voice Rooms", "Join your crowd in lively Party conversations."],
  ["✦", "Meet People", "Find communities and people who match your vibe."],
  ["◈", "Live Chat", "Keep the room moving with fast conversation."],
  ["♡", "Virtual Gifts", "Celebrate your favourite Hosts and friends."],
  ["▣", "Social Games", "Enjoy room-friendly games and shared reactions."],
] as const;

export default function Home() {
  const release = latestPublicRelease;
  const downloadHref = release.apkUrl ?? "/download#download";
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Nazraa Live home">
          <img src="/nazraa-logo.jpg" alt="Nazraa Live" />
          <span>Nazraa Live</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Primary navigation">
          <a href="#experience">Experience</a>
          <Link href="/download">Download</Link>
          <Link href="/support">Support</Link>
        </nav>
        <Link className={styles.navDownload} href="/download">
          Get Android app
        </Link>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Live social entertainment</span>
          <h1>
            Go Live. <span>Find Your Crowd.</span>
          </h1>
          <p>
            Join Face and Voice Rooms, meet people, chat in the moment, send
            virtual gifts, and enjoy social games together.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primary} href={downloadHref}>
              Download Nazraa
            </a>
            <Link className={styles.secondary} href="/download">
              Latest version {release.version}
            </Link>
          </div>
          <div className={styles.availability}>
            <b>✓</b> Available for Android
          </div>
        </div>
        <div
          className={styles.phoneStage}
          aria-label="Nazraa Live room preview"
        >
          <div className={styles.orb} />
          <div className={styles.phone}>
            <div className={styles.phoneScreen}>
              <div className={styles.phoneTop}>
                <span>9:41</span>
                <span className={styles.livePill}>● LIVE</span>
              </div>
              <div className={styles.liveAvatar} />
              <div className={styles.hostName}>Nazraa Live Room</div>
              <div className={styles.hostTag}>
                Talk · play · celebrate together
              </div>
              <div className={styles.chatLines}>
                <i style={{ "--width": "79%" } as React.CSSProperties} />
                <i style={{ "--width": "66%" } as React.CSSProperties} />
                <i style={{ "--width": "84%" } as React.CSSProperties} />
              </div>
              <div className={styles.phoneBottom}>
                <b />
                <b />
                <b />
                <b />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="experience">
        <div className={styles.sectionIntro}>
          <h2>Every room has a reason to stay.</h2>
          <p>
            Nazraa brings together live conversation, community and
            entertainment in one original social experience.
          </p>
        </div>
        <div className={styles.featureGrid}>
          {features.map(([icon, title, copy]) => (
            <article className={styles.feature} key={title}>
              <div className={styles.featureIcon}>{icon}</div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.release} id="download">
        <div className={styles.releaseCard}>
          <div>
            <h2>Nazraa for Android</h2>
            <p>
              Get the latest approved Nazraa release directly from the official
              download page.
            </p>
            <div className={styles.releaseMeta}>
              <span>Version {release.version}</span>
              <span>Build {release.build}</span>
              <span>{releaseFileSize(release.apkSizeBytes)}</span>
              <span>{release.minimumAndroidVersion}</span>
            </div>
          </div>
          {release.apkUrl ? (
            <a className={styles.downloadButton} href={release.apkUrl}>
              Download APK
            </a>
          ) : (
            <Link className={styles.downloadButton} href="/download">
              View release details
            </Link>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>© 2026 Nazraa Live</span>
        <nav className={styles.footerLinks} aria-label="Legal and support">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/community-guidelines">Guidelines</Link>
          <Link href="/child-safety">Child Safety</Link>
          <Link href="/support">Support</Link>
        </nav>
      </footer>
    </main>
  );
}
