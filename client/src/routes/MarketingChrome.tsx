import type { ReactNode } from "react";
import { CONTACT_EMAIL } from "../lib/studio";

export function SiteNav({ links }: { links?: ReactNode }) {
  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <a className="wordmark" href="/">
          Orune
        </a>
        <nav aria-label="Site">
          <span className="site-nav-links">
            {links ?? (
              <>
                <a href="/#examples">Examples</a>
                <a href="/#how-it-works">How it works</a>
                <a href="/pricing">Pricing</a>
              </>
            )}
          </span>
          <a className="text-link" href="/studio">
            Sign in
          </a>
          <a className="button button-primary" href="/studio">
            Start free
          </a>
        </nav>
        <details className="mobile-site-menu" onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false;
        }} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary>Menu</summary>
          <nav aria-label="Mobile site">
            {links ?? <><a href="/#examples">Examples</a><a href="/#how-it-works">How it works</a><a href="/pricing">Pricing</a></>}
          </nav>
        </details>
      </div>
    </header>
  );
}

export function MarketingChrome({
  children,
  nav,
  className,
}: {
  children: ReactNode;
  nav?: ReactNode;
  className?: string;
}) {
  return (
    <main className={`marketing-shell ${className || ""}`}>
      <SiteNav links={nav} />
      {children}
      <footer className="site-footer">
        <div className="site-footer-inner">
          <span className="wordmark">Orune</span>
          <a href="/pricing">Pricing</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          <span className="site-footer-note">
            &copy; {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </main>
  );
}
