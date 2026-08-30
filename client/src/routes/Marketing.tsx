import { useEffect } from "react";
import { ChladniVisual } from "./ChladniVisual";
import { GravitationalLensVisual } from "./GravitationalLensVisual";
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
      { threshold: 0.06 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <MarketingChrome>
      {/* 1 — hero: one plain-language promise and one cinematic physical idea.
             A source crosses behind a gravitational lens, turning two bent
             paths of light into an Einstein ring. */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1 id="hero-title">Turn ideas into beautiful animations.</h1>
            <p className="hero-lede">
              Describe what you want to explain. Orune turns it into a narrated
              visual story.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/studio">
                Create a lesson
              </a>
              <a className="text-link" href="#examples">
                Watch an example &rarr;
              </a>
            </div>
          </div>

          <GravitationalLensVisual />
        </div>
      </section>

      {/* 2 — a small gallery, not a feature list: three different ideas in
             motion, staggered like an editorial contact sheet. */}
      <section className="showcase" id="examples" aria-labelledby="showcase-title">
        <div className="showcase-head">
          <span className="kicker">A few ideas, made visible</span>
          <h2 id="showcase-title">Watch the idea unfold.</h2>
        </div>
        <div className="showcase-grid" data-reveal>
          <figure className="showcase-item">
            <ChladniVisual className="showcase-media" id="showcase-chladni" />
            <figcaption>Sound turns scattered grains into geometry.</figcaption>
          </figure>
          <figure className="showcase-item showcase-item-offset">
            <video
              className="showcase-media"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/showcase/frag-rotation.jpg"
              src="/showcase/frag-rotation.mp4"
              aria-label="A rotating radius casting its height into a sine wave."
            />
            <figcaption>A rotation casts a wave.</figcaption>
          </figure>
          <figure className="showcase-item">
            <video
              className="showcase-media"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/showcase/frag-accumulation.jpg"
              src="/showcase/frag-accumulation.mp4"
              aria-label="Rectangles narrowing beneath a curve until their area becomes an integral."
            />
            <figcaption>An estimate becomes an integral.</figcaption>
          </figure>
        </div>
      </section>

      {/* 3 — the pen: the only annotated frame on the page */}
      <section className="pen" aria-labelledby="pen-title">
        <div className="pen-inner" data-reveal>
          <span className="kicker">The pen</span>
          <h2 className="pen-title" id="pen-title">
            Correct it like a page proof.
          </h2>
          <div className="pen-figure">
            {/* the overlay maps onto the image alone, so the note must live
                outside this frame */}
            <div className="pen-frame">
              <img
                src="/showcase/slope.jpg"
                alt="A lesson frame: a parabola with a sienna tangent line touching at a marked point."
              />
              <svg
                className="pen-annotation"
                viewBox="0 0 1440 810"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                {/* the circle around the tangent point */}
                <path
                  className="pen-stroke"
                  d="M 752,562 C 758,504 846,476 928,501 C 990,520 1004,576 960,614 C 912,655 800,657 760,613 C 735,586 740,553 760,530"
                />
                {/* the connector out to the margin note, stopping just short
                    of the circle */}
                <path
                  className="pen-stroke pen-connector"
                  d="M 1502,398 C 1400,386 1160,408 1010,480"
                />
              </svg>
            </div>
            <p className="pen-margin-note">let the tangent settle slower</p>
          </div>
          <p className="pen-body">
            Pause any frame, draw on what is wrong, and say what you want.
            Orune re-renders only the scenes you touched.
          </p>
        </div>
      </section>

      {/* 4 — close: the one sunken band, type only */}
      <section className="close" aria-labelledby="close-title">
        <div className="close-inner" data-reveal>
          <h2 id="close-title">
            Every diagram is <em>computed</em>, not drawn.
          </h2>
          <p>
            A curve is its function sampled along its own domain, and a tangent
            sits where the derivative puts it. Pick the idea you never quite
            got, and watch it get built.
          </p>
          <div className="hero-actions close-actions">
            <a className="button button-primary" href="/studio">
              Start with one free lesson
            </a>
            <a className="text-link" href="/pricing">
              See the plans &rarr;
            </a>
          </div>
          <p className="close-note">
            One lesson free, no card. Paid plans start at $20 a month.
          </p>
        </div>
      </section>
    </MarketingChrome>
  );
}
