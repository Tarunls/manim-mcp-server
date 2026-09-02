import { useEffect } from "react";
import { ChladniVisual } from "./ChladniVisual";
import { CircleTriangleVisual } from "./CircleTriangleVisual";
import { MarketingChrome } from "./MarketingChrome";
import { CausticVisual, CycloidVisual } from "./ShowcaseVisuals";

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
      {/* 1 — hero: concentric rings unwrap into a triangle, making the area
             of a circle visible with no labels or interface chrome. */}
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

          <CircleTriangleVisual />
        </div>
      </section>

      {/* 2 — three quiet, continuously moving mathematical objects. */}
      <section className="showcase" id="examples" aria-label="Animated mathematical ideas">
        <div className="showcase-grid" data-reveal>
          <figure className="showcase-item">
            <h3>Standing waves</h3>
            <ChladniVisual className="showcase-media" id="showcase-chladni" />
            <figcaption className="visually-hidden">
              A Chladni plate organizing grains into nodal lines.
            </figcaption>
          </figure>
          <figure className="showcase-item">
            <h3>Reflected light</h3>
            <CausticVisual />
            <figcaption className="visually-hidden">
              Reflections inside a circle forming a caustic curve.
            </figcaption>
          </figure>
          <figure className="showcase-item">
            <h3>A rolling point</h3>
            <CycloidVisual />
            <figcaption className="visually-hidden">
              A point on a rolling circle tracing a cycloid.
            </figcaption>
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

      {/* 4 — close: one memorable invitation, not another explanation. */}
      <section className="close" aria-labelledby="close-title">
        <div className="close-inner" data-reveal>
          <span className="kicker">One idea is enough</span>
          <h2 id="close-title">
            Make the hard thing <em>visible.</em>
          </h2>
          <p>
            Start with the concept that never quite clicked. Describe it in
            your own words, then watch Orune build the explanation.
          </p>
          <div className="hero-actions close-actions">
            <a className="button button-primary" href="/studio">
              Start with one free lesson
            </a>
            <a className="text-link" href="/pricing">
              See the plans &rarr;
            </a>
          </div>
        </div>
      </section>
    </MarketingChrome>
  );
}
