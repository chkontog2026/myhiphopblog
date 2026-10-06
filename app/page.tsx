import { getCmsContent } from "../db/cms";
import { youtubeEmbedUrl } from "../db/youtube";
import NewsletterForm from "./NewsletterForm";

export const dynamic = "force-dynamic";

const greekDate = new Intl.DateTimeFormat("el-GR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const greekMonth = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" });

export default async function Home() {
  const { settings, releases } = await getCmsContent();
  const archive = [...new Set(releases.map((release) => release.publishDate.slice(0, 7)))].map((month) => ({
    month,
    label: greekMonth.format(new Date(`${month}-02T12:00:00`)),
    count: releases.filter((release) => release.publishDate.startsWith(month)).length,
  }));

  const headerStyle: React.CSSProperties = {
    backgroundColor: settings.headerColor,
    ...(settings.headerImageUrl
      ? { backgroundImage: `linear-gradient(rgba(20,20,20,.25), rgba(20,20,20,.25)), url("${settings.headerImageUrl}")` }
      : {}),
  };

  return (
    <><div className="blog-utility">
      <button className="theme-toggle" type="button" data-theme-toggle aria-label="Ενεργοποίηση σκοτεινής εμφάνισης" aria-pressed="false">
        <span className="theme-toggle-icon" aria-hidden="true">☾</span>
        <span data-theme-label>Dark</span>
      </button>
    </div><div className="page-shell" id="top">
      <header className={`blog-header${settings.headerImageUrl ? " has-image" : ""}`} style={headerStyle}>
        <h1><a href="/" aria-label="Αρχική"><img className="blog-title-logo" src="/my-hip-hop-blog-logo.png?v=1" alt={settings.blogTitle} /></a></h1>
        <p>{settings.tagline}</p>
      </header>

      <nav className="top-nav" aria-label="Κύρια πλοήγηση">
        <a href="#top">{settings.homeLabel}</a>
        <a href="#releases">{settings.releasesLabel}</a>
        <a href="#about">{settings.aboutLabel}</a>
        <a href="#newsletter">Newsletter</a>
        <a href={`mailto:${settings.contactEmail}`}>{settings.contactLabel}</a>
      </nav>

      <div className="content-layout">
        <main className="posts" id="releases">
          {releases.map((release) => {
            const embedUrl = youtubeEmbedUrl(release.youtubeUrl);
            const hasReleaseDetails = Boolean(release.coverUrl || release.tracks.length);
            return (
            <article className={`post${!hasReleaseDetails && embedUrl ? " video-only-post" : ""}`} id={release.slug} key={release.id}>
              <p className="post-date">{greekDate.format(new Date(`${release.publishDate}T12:00:00`))}</p>
              <h2>{release.artist} — {release.title}{release.releaseDate ? ` (${release.releaseDate})` : ""}</h2>
              {hasReleaseDetails ? <div className="post-body">
                {release.coverUrl ? (
                  <img src={release.coverUrl} alt={`Εξώφυλλο του ${release.title}`} />
                ) : (
                  <div className="cover-placeholder">Χωρίς εξώφυλλο</div>
                )}
                <div className="post-info">
                  <p className="post-note">{release.description}</p>
                  <h3>Tracklist</h3>
                  <ol>
                    {release.tracks.map((track) => <li key={track}>{track}</li>)}
                  </ol>
                  {!embedUrl && <a
                      className="download-link"
                      href={release.downloadUrl || `mailto:${settings.contactEmail}?subject=Download — ${encodeURIComponent(release.title)}`}
                      {...(release.downloadUrl.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    >Download</a>}
                </div>
              </div> : release.description ? <p className="post-note">{release.description}</p> : null}
              {embedUrl && (
                <div className="post-video-block">
                  <div className="post-video">
                    <iframe
                      src={embedUrl}
                      title={`${release.artist} — ${release.title} στο YouTube`}
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  {release.downloadUrl && <a
                    className="download-link post-video-download"
                    href={release.downloadUrl}
                    {...(release.downloadUrl.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                  >Download</a>}
                </div>
              )}
              <footer className="post-footer">
                Αναρτήθηκε από <b>{settings.blogTitle}</b> · <a href={`#${release.slug}`}>Μόνιμος σύνδεσμος</a>
              </footer>
            </article>
          )})}
          {releases.length === 0 && <p className="empty-blog">Δεν υπάρχουν ακόμη αναρτήσεις.</p>}
        </main>

        <aside className="sidebar">
          <section className="newsletter" id="newsletter">
            <h2>Newsletter</h2>
            <p>Εγγράψου στο Newsletter, για να λαμβάνεις ειδοποιήσεις.</p>
            <NewsletterForm />
          </section>

          <section id="about">
            <h2>{settings.aboutTitle}</h2>
            <p>{settings.aboutText}</p>
          </section>

          <section>
            <h2>{settings.archiveTitle}</h2>
            <ul>
              {archive.map((item) => (
                <li key={item.month}><a href="#releases">{item.label} ({item.count})</a></li>
              ))}
            </ul>
          </section>

          <section>
            <h2>{settings.linksTitle}</h2>
            <ul>
              <li><a href={`mailto:${settings.contactEmail}`}>Στείλε μουσική</a></li>
              {settings.instagramUrl && <li><a href={settings.instagramUrl} target="_blank" rel="noreferrer">Instagram</a></li>}
              {settings.soundcloudUrl && <li><a href={settings.soundcloudUrl} target="_blank" rel="noreferrer">SoundCloud</a></li>}
            </ul>
          </section>
        </aside>
      </div>

      <footer className="site-footer">
        {settings.footerText}
      </footer>
    </div></>
  );
}
