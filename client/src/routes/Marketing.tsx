import { useEffect, useState } from "react";
import { ChladniVisual } from "./ChladniVisual";
import { MarketingChrome } from "./MarketingChrome";

// each still already carries its claim as the frame's own typography, so the
// caption gives the other half of the pair: the sentence it was rendered from
const STRIP = [
  {
    id: "accumulation",
    title: "Area under a curve",
    sentence: "“Show me how adding up rectangles becomes the integral.”",
    alt: "A lesson frame titled “The estimate stops being an estimate.”: the area under a curve, shaded, above the identity area equals the integral of f.",
  },
  {
    id: "rotation",
    title: "A circle becomes a wave",
    sentence:
      "“Show me why a sine wave is just something going round a circle.”",
    alt: "A lesson frame titled “A rotation casts a wave.”: a hand turning on a circle beside the sine wave its height traces.",
  },
  {
    id: "slope",
    title: "The meaning of a derivative",
    sentence: "“Show me what the derivative means at one point.”",
    alt: "A lesson frame titled “That line's steepness is the derivative.”: a parabola with a tangent line touching at a marked point.",
  },
] as const;

export default function Marketing() {
  const [selectedLesson, setSelectedLesson] = useState<(typeof STRIP)[number]>(STRIP[0]);
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
      {/* 1 — hero: one plain-language promise and one large mathematical
             visual. A vibrating plate turns disorder into standing-wave
             geometry, showing the product's purpose before we explain it. */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1 id="hero-title">Turn ideas into beautiful animations.</h1>
            <p className="hero-lede">
              Explain a concept with a video made for it. Describe your idea,
              watch it take shape, and draw on any frame to refine it.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/studio">
                Create a lesson
              </a>
              <a className="text-link" href="#watch">
                Watch an example &rarr;
              </a>
            </div>
            <p className="hero-note">Your first generation is free. No card needed.</p>
          </div>

          <ChladniVisual />
        </div>
      </section>

      <section className="how-it-works" id="how-it-works" aria-label="How Orune works">
        <ol>
          <li><span className="step-number">01</span><div><h2>Describe it.</h2><p>A concept, an audience, a little direction.</p></div></li>
          <li><span className="step-number">02</span><div><h2>Make it yours.</h2><p>Review the video. Draw on a frame to request a change.</p></div></li>
          <li><span className="step-number">03</span><div><h2>Press play.</h2><p>Download your video, ready to teach or share.</p></div></li>
        </ol>
      </section>

      {/* 2 — watch one: a full-bleed lesson between two hairlines */}
      <section className="watch" id="watch" aria-label="Watch one lesson">
        <div className="watch-frame">
          <div className="watch-heading"><span className="kicker">See it in motion</span><h2>{selectedLesson.title}</h2></div>
          <video
            key={selectedLesson.id}
            className="watch-video"
            controls
            muted
            loop
            playsInline
            preload="metadata"
            poster={`/showcase/${selectedLesson.id}.jpg`}
            src={`/showcase/${selectedLesson.id}.mp4`}
            aria-label={`Watch ${selectedLesson.title}`}
          />
        </div>
        <p className="watch-note">
          A short sample lesson. Press play to explore it.
        </p>
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
                width={1440}
                height={810}
                loading="lazy"
                decoding="async"
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
            Your marked frame and note guide the next revision.
          </p>
        </div>
      </section>

      {/* 4 — three lessons: a contact strip, whitespace-separated */}
      <section className="strip" id="examples" aria-labelledby="strip-title">
        <span className="kicker strip-kicker">Three lessons</span>
        <h2 className="strip-title" id="strip-title">
          Every one of these was a sentence first.
        </h2>
        {/* on small screens this row scrolls, so it must be keyboard-reachable */}
        <div
          className="strip-row"
          data-reveal
          role="region"
          aria-label="Three rendered lessons"
          tabIndex={0}
        >
          {STRIP.map((lesson) => (
            <figure
              className="strip-item"
              key={lesson.id}
              id={`lesson-${lesson.id}`}
            >
              <a className="strip-preview" href="#watch" onClick={() => setSelectedLesson(lesson)} aria-label={`Watch ${lesson.title}`}>
                <img src={`/showcase/${lesson.id}.jpg`} alt={lesson.alt} width={1440} height={810} loading="lazy" decoding="async" />
                <span className="strip-play" aria-hidden="true">Play lesson <span>↗</span></span>
              </a>
              <figcaption>{lesson.sentence}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 5 — close: the one sunken band, type only */}
      <section className="close" aria-labelledby="close-title">
        <div className="close-inner" data-reveal>
          <h2 id="close-title">
            Give a difficult idea a <em>clearer explanation.</em>
          </h2>
          <p>
            Start with the concept you want to teach. Shape the explanation,
            review the details, and make something worth watching.
          </p>
          <div className="hero-actions close-actions">
            <a className="button button-primary" href="/studio">
              Create your first lesson
            </a>
            <a className="text-link" href="/pricing">
              See the plans &rarr;
            </a>
          </div>
          <p className="close-note">
            One generation credit free each month. No card required.
          </p>
        </div>
      </section>
    </MarketingChrome>
  );
}
