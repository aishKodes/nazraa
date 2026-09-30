import type { Metadata } from "next";
import Link from "next/link";
import styles from "./marketing.module.css";
import {
  latestPublicRelease,
  releaseFileSize,
} from "@/lib/release/latest-release";

export const metadata: Metadata = {
  title: "Nazraa Live — Meet in the Moment",
  description:
    "Nazraa is a live social entertainment app for Face Rooms, Party audio rooms, conversations, virtual gifts, and games.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Nazraa Live — Meet in the Moment",
    description:
      "Face Rooms, Party audio rooms, communities, virtual gifts, and social games in one original live experience.",
    images: [{ url: "/og.png", width: 1731, height: 909 }],
  },
};

const features = [
  ["01", "Face Rooms", "Go live or drop into a room where the conversation is already happening."],
  ["02", "Party Audio", "Find your people in lively voice rooms built for talking, listening, and taking a seat."],
  ["03", "Live Chat", "Follow the moment with quick room chat, entries, reactions, and shared updates."],
  ["04", "Virtual Gifts", "Celebrate a great moment with gifts designed to feel part of the room — not a distraction."],
  ["05", "Social Games", "Open a game, play alongside the room, and keep the live energy moving."],
  ["06", "Your Space", "Build a profile, follow Hosts and communities, and return to the rooms you enjoy."],
] as const;

const roomMoments = [
  ["Face Live", "See the Host. Join the moment."],
  ["Party", "Take a seat or listen in."],
  ["Games", "Play without leaving the room."],
] as const;

export default function Home() {
  const release = latestPublicRelease;
  const downloadHref = release.apkUrl ?? "/download#download";

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Nazraa Live home">
          <img src="/nazraa-logo.jpg" alt="Nazraa Live" />
          <span>Nazraa <em>Live</em></span>
        </Link>
        <nav className={styles.navLinks} aria-label="Primary navigation">
          <a href="#experience">Experience</a>
          <a href="#how-it-works">How it works</a>
          <Link href="/support">Support</Link>
        </nav>
        <Link className={styles.navDownload} href="/download">
          Get the app <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <i aria-hidden="true" /> Live social entertainment
          </span>
          <h1 id="hero-heading">
            Find the room<br />
            <span>that feels like yours.</span>
          </h1>
          <p>
            Meet people through Face and Party rooms, talk in real time, share
            gifts, and make every room feel alive.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primary} href={downloadHref}>
              Download for Android <span aria-hidden="true">↓</span>
            </a>
            <a className={styles.secondary} href="#experience">
              Explore Nazraa <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className={styles.trustRow}>
            <div className={styles.stackAvatars} aria-hidden="true">
              <b />
              <b />
              <b />
            </div>
            <span>Made for live conversation, shared moments, and real communities.</span>
          </div>
        </div>

        <div className={styles.visualStage} aria-label="Nazraa Live room preview">
          <div className={styles.glowOne} aria-hidden="true" />
          <div className={styles.glowTwo} aria-hidden="true" />
          <div className={styles.roomPreview}>
            <div className={styles.previewTopbar}>
              <div className={styles.previewBack} aria-hidden="true">‹</div>
              <div className={styles.previewRoomTitle}>
                <strong>Chill &amp; Chat</strong>
                <span><i /> Live now</span>
              </div>
              <div className={styles.previewAudience}><b>2.4K</b> <span>◉</span></div>
            </div>
            <div className={styles.previewVideo}>
              <div className={styles.videoHalo} aria-hidden="true" />
              <div className={styles.hostPortrait} aria-hidden="true">
                <span className={styles.hair} />
                <span className={styles.face} />
                <span className={styles.top} />
              </div>
              <div className={styles.liveStamp}><i /> LIVE</div>
              <div className={styles.hostLabel}>
                <div className={styles.previewAvatar} aria-hidden="true" />
                <span><b>Priya</b><small>Host · Lv.24</small></span>
                <em>Follow</em>
              </div>
            </div>
            <div className={styles.previewFeed}>
              <p><b className={styles.levelBadge}>Lv.18</b><strong>Rahul</strong> You&apos;re looking amazing today ✨</p>
              <p className={styles.joinLine}><i /> Aisha joined the room</p>
              <p><b className={styles.levelBadge}>Lv.31</b><strong>Kabir</strong> sent <em>Royal Rose × 5</em></p>
            </div>
            <div className={styles.previewComposer}>
              <span>Say something nice…</span><b>☺</b><b>✦</b><b>🎁</b>
            </div>
          </div>
          <div className={styles.floatingGift} aria-hidden="true">
            <span>✦</span><p><b>Royal Rose</b><small>sent to Priya</small></p><em>×5</em>
          </div>
          <div className={styles.floatingParty} aria-hidden="true">
            <div><i /><i /><i /><i /><i /></div>
            <p><b>Party is live</b><small>Talk, listen, take a seat</small></p>
          </div>
        </div>
      </section>

      <section className={styles.momentStrip} aria-label="Nazraa room formats">
        {roomMoments.map(([title, copy], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <div><h2>{title}</h2><p>{copy}</p></div>
            <b aria-hidden="true">↗</b>
          </article>
        ))}
      </section>

      <section className={styles.section} id="experience">
        <div className={styles.sectionIntro}>
          <span className={styles.sectionKicker}>THE NAZRAA EXPERIENCE</span>
          <h2>One app. A lot more to share.</h2>
          <p>
            A room should feel immediate: clear people, quick conversation,
            responsive reactions, and a reason to stay a little longer.
          </p>
        </div>
        <div className={styles.featureGrid}>
          {features.map(([number, title, copy]) => (
            <article className={styles.feature} key={title}>
              <div className={styles.featureTop}><span>{number}</span><i aria-hidden="true">↗</i></div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.flow} id="how-it-works">
        <div className={styles.flowHeading}>
          <span className={styles.sectionKicker}>MAKE THE FIRST MOVE</span>
          <h2>Open Nazraa.<br /><span>Find your people.</span></h2>
        </div>
        <ol className={styles.flowSteps}>
          <li><span>01</span><div><h3>Choose a room</h3><p>Explore Face and Party rooms that fit your mood.</p></div></li>
          <li><span>02</span><div><h3>Join the moment</h3><p>Watch, listen, chat, or take a seat when you&apos;re ready.</p></div></li>
          <li><span>03</span><div><h3>Make it yours</h3><p>Follow people, send a gift, play together, and come back anytime.</p></div></li>
        </ol>
      </section>

      <section className={styles.release} id="download">
        <div className={styles.releaseFlare} aria-hidden="true" />
        <div className={styles.releaseCopy}>
          <span className={styles.releaseKicker}>OFFICIAL ANDROID RELEASE</span>
          <h2>The room is ready<br />when you are.</h2>
          <p>
            Download the current official Nazraa Android release directly from
            our verified release page.
          </p>
          <div className={styles.releaseMeta}>
            <span>v{release.version}</span>
            <span>Build {release.build}</span>
            <span>{releaseFileSize(release.apkSizeBytes)}</span>
            <span>{release.minimumAndroidVersion}</span>
          </div>
        </div>
        <div className={styles.releaseAction}>
          <a className={styles.downloadButton} href={downloadHref}>Download APK <span aria-hidden="true">↓</span></a>
          <Link href="/download">Release details &amp; verification <span aria-hidden="true">→</span></Link>
        </div>
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
          <Link href="/child-safety">Child Safety</Link>
          <Link href="/support">Support</Link>
        </nav>
      </footer>
    </main>
  );
}
