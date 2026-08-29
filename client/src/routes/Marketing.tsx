import { useEffect } from "react";
import { MarketingChrome } from "./MarketingChrome";

export default function Marketing() {
  useEffect(() => {
    const elements = document.querySelectorAll("[data-reveal]");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <MarketingChrome>
      <section className="hero">
        <h1>
          Learn <em>whatever way</em> you want.
        </h1>
        <p>
          Describe the lesson you want to teach and watch it become a clear,
          editable video.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="/studio">
            Create your first lesson
          </a>
          <a className="text-link" href="#how-it-works">
            See how it works &rarr;
          </a>
        </div>
      </section>

      <section className="reel" aria-label="Product preview" data-reveal>
        <video
          className="reel-video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/lesson-studio-reel-poster.jpg"
          src="/lesson-studio-reel.mp4"
        >
          <track
            kind="captions"
            src="/lesson-studio-reel.vtt"
            srcLang="en"
            label="English"
          />
        </video>
      </section>

      <section className="how-section" id="how-it-works" data-reveal>
        <div>
          <span className="step-number">01</span>
          <strong>Say what you mean</strong>
          <p>
            Describe the idea, the audience, and the feeling you want the
            lesson to have.
          </p>
        </div>
        <div>
          <span className="step-number">02</span>
          <strong>See it take shape</strong>
          <p>
            Watch one thought become a visual explanation built around how you
            understand.
          </p>
        </div>
        <div>
          <span className="step-number">03</span>
          <strong>Make it yours</strong>
          <p>
            Pause any frame, draw directly on it, and ask for the exact change
            you imagined.
          </p>
        </div>
      </section>

      <section className="closing" data-reveal>
        <h2>Understanding is personal. So the explanation should be too.</h2>
        <div className="hero-actions">
          <a className="button button-primary" href="/studio">
            Create your first lesson
          </a>
          <a className="text-link" href="/pricing">
            Compare plans
          </a>
        </div>
      </section>
    </MarketingChrome>
  );
}
