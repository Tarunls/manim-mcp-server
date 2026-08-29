import type { ReactNode } from "react";
import { CONTACT_EMAIL } from "../lib/studio";

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
      <header className="site-nav">
        <div className="site-nav-inner">
          <a className="wordmark" href="/">
            Lesson Studio
          </a>
          <nav aria-label="Site">
            {nav ?? (
              <>
                <a href="/#how-it-works">How it works</a>
                <a href="/pricing">Pricing</a>
              </>
            )}
            <a className="button button-primary" href="/studio">
              Open studio
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <span>Lesson Studio</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
      </footer>
    </main>
  );
}
