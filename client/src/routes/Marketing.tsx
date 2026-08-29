import { Play } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { MarketingChrome } from "./MarketingChrome";

type Example = {
  id: string;
  label: string;
  title: string;
  blurb: string;
  badge: string;
  image: string;
  video?: string;
  alt: string;
};

const EXAMPLES: Example[] = [
  {
    id: "lesson",
    label: "A full lesson",
    title: "Integrals, start to finish",
    blurb: "Setup, Riemann sums, the limit, and the solid it sweeps out.",
    badge: "30s · rendered",
    image: "/showcase/lesson-integral.jpg",
    video: "/showcase/lesson-integral.mp4",
    alt: "Opening frame of a generated lesson about integrals.",
  },
  {
    id: "integral-1",
    label: "Integrals as accumulated area",
    title: "Integrals as accumulated area",
    blurb: "Rectangles get narrower until the sum stops being an estimate.",
    badge: "Manim · 2D",
    image: "/showcase/integral-1.jpg",
    alt: "A curve with Riemann rectangles beneath it and the sum formula beside it.",
  },
  {
    id: "integral-2",
    label: "Solids of revolution",
    title: "Area becomes volume",
    blurb: "The same region, spun around an axis, one disk at a time.",
    badge: "Manim · 3D",
    image: "/showcase/integral-2.jpg",
    alt: "A wireframe solid of revolution with one highlighted disk.",
  },
  {
    id: "fourier-1",
    label: "Fourier series",
    title: "Frequencies are rotations",
    blurb: "A steady turn around a circle, and the wave its shadow traces.",
    badge: "Manim · 2D",
    image: "/showcase/fourier-1.jpg",
    alt: "A rotating vector on a circle next to the wave it generates.",
  },
  {
    id: "fourier-2",
    label: "Frequency space",
    title: "The same signal, seen sideways",
    blurb: "Every rotation gets one bar, and the signal becomes a spectrum.",
    badge: "Manim · 2D",
    image: "/showcase/fourier-2.jpg",
    alt: "A frequency map of a signal drawn as a spectrum.",
  },
];

const FAQ = [
  {
    q: "What does it cost?",
    a: "Your first lesson is free and does not ask for a card. Paid plans start at $20 a month, and the only thing that changes between them is how many generation credits you get each month.",
  },
  {
    q: "How long does a render take?",
    a: "It depends on how long the lesson is and how much of it is 3D. You do not have to sit and watch: the studio streams progress scene by scene, and you can close the tab and come back to the finished file.",
  },
  {
    q: "Can I edit it after it renders?",
    a: "That is the point. Pause on any frame, draw on it, and describe the change. Orune re-renders the scenes you touched and keeps the previous version next to the new one.",
  },
  {
    q: "What subjects work best?",
    a: "Anything with a picture behind it — calculus, linear algebra, signals, probability, mechanics, algorithms. The further an idea sits from something you could draw, the less an animation adds.",
  },
  {
    q: "Do I own what comes out?",
    a: "You keep the rights you already hold in what you write and in the video it produces. We take only the permission needed to render, store, and deliver it. The terms say it in full.",
  },
  {
    q: "Is the narration AI?",
    a: "Yes. The script is written alongside the storyboard and read by a synthetic voice, timed against the animation. You can rewrite any line and the timing moves with it.",
  },
];

export default function Marketing() {
  const [selected, setSelected] = useState(EXAMPLES[0].id);

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
      { threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const active = EXAMPLES.find((item) => item.id === selected) ?? EXAMPLES[0];

  return (
    <MarketingChrome>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Hard ideas, made obvious.</h1>
          <p className="hero-lede">
            Describe what you are trying to understand. Orune animates it into a
            narrated lesson you can pause, redraw, and rebuild until it clicks.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="/studio">
              Start with one free lesson
            </a>
            <a className="text-link" href="#examples">
              Watch an example &rarr;
            </a>
          </div>
        </div>
        <div className="hero-stage-slot">
          <div className="hero-stage stage-frame">
            <video
              className="reel-video"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/orune-reel-poster.jpg"
              src="/orune-reel.mp4"
              aria-label="A lesson being generated, reviewed, and re-rendered in Orune"
            >
              <track
                kind="captions"
                src="/orune-reel.vtt"
                srcLang="en"
                label="English"
              />
            </video>
          </div>
        </div>
      </section>

      <section
        className="mk-section"
        id="examples"
        aria-labelledby="examples-title"
        data-reveal
      >
        <div className="mk-section-head">
          <span className="kicker">Examples</span>
          <h2 id="examples-title">Made with Orune.</h2>
          <p>
            Nothing below is a mockup. Every frame and clip here came out of the
            renderer, from one written prompt.
          </p>
        </div>
        <div className="gallery">
          <div className="gallery-stage stage-frame">
            {active.video ? (
              <video
                key={active.id}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster={active.image}
                src={active.video}
                aria-label={active.alt}
              />
            ) : (
              <img key={active.id} src={active.image} alt={active.alt} />
            )}
          </div>
          <div className="gallery-caption">
            <strong>{active.title}</strong>
            <span>{active.blurb}</span>
            <span className="mono">{active.badge}</span>
          </div>
          <div className="gallery-thumbs">
            {EXAMPLES.map((item) => (
              <button
                type="button"
                key={item.id}
                className="gallery-thumb"
                aria-pressed={item.id === active.id}
                onClick={() => setSelected(item.id)}
              >
                <span className="gallery-thumb-media">
                  <img src={item.image} alt="" />
                  {item.video && (
                    <span className="gallery-thumb-play" aria-hidden="true">
                      <Play size={11} weight="fill" />
                    </span>
                  )}
                </span>
                <span className="gallery-thumb-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        className="mk-section"
        id="how-it-works"
        aria-labelledby="how-title"
        data-reveal
      >
        <div className="mk-section-head">
          <span className="kicker">How it works</span>
          <h2 id="how-title">From one sentence to a finished lesson.</h2>
          <p>
            You write the description. Everything between that and the rendered
            file is automatic — until you want something changed.
          </p>
        </div>
        <div className="column-set">
          <div>
            <span className="step-number">01</span>
            <h3>Describe the idea</h3>
            <p>
              Say what you are trying to understand and who it is for. No
              storyboard, no script, no scene list.
            </p>
          </div>
          <div>
            <span className="step-number">02</span>
            <h3>Orune builds it</h3>
            <p>
              It plans the beats, writes the Manim and Remotion scenes, narrates
              them against the animation, and renders the video.
            </p>
          </div>
          <div>
            <span className="step-number">03</span>
            <h3>Fix what is wrong</h3>
            <p>
              Pause on a frame, draw on it, ask for the change. Only the scenes
              you touched get rendered again.
            </p>
          </div>
        </div>
      </section>

      <section
        className="mk-section"
        aria-labelledby="studio-title"
        data-reveal
      >
        <div className="mk-section-head">
          <span className="kicker">In the studio</span>
          <h2 id="studio-title">Built to be argued with.</h2>
          <p>
            Most generators hand you a file and wish you luck. Orune hands you a
            lesson you are allowed to interrupt.
          </p>
        </div>
        <div className="feature-rows">
          <div className="feature-row">
            <div className="feature-text">
              <span className="kicker">Frame review</span>
              <h3>Draw on any frame.</h3>
              <p>
                Scrub to the moment that is wrong, circle it, and write what
                should be different. The mark and the sentence travel together,
                so &ldquo;this arrow, not that one&rdquo; is a complete
                instruction.
              </p>
            </div>
            <div className="feature-visual stage-frame">
              <img
                src="/showcase/fourier-2.jpg"
                alt="A rendered frame showing a signal drawn as a bar spectrum."
              />
            </div>
          </div>

          <div className="feature-row feature-row-flipped">
            <div className="feature-text">
              <span className="kicker">Narration</span>
              <h3>Words that land on the right frame.</h3>
              <p>
                The script is written against the storyboard rather than bolted
                on afterwards. When a curve appears, the sentence about it
                starts. Move a beat and the audio moves with it.
              </p>
            </div>
            <div className="feature-visual stage-frame">
              <img
                src="/showcase/integral-2.jpg"
                alt="A rendered frame showing a solid of revolution with one disk highlighted."
              />
            </div>
          </div>

          <div className="feature-row">
            <div className="feature-text">
              <span className="kicker">Versions</span>
              <h3>Revisions, not regenerations.</h3>
              <p>
                Changing scene four leaves scenes one through three alone. Every
                render is kept, so you can hold two takes next to each other and
                go back to the one that read better.
              </p>
            </div>
            <div className="feature-visual stage-frame">
              <img
                src="/showcase/fourier-1.jpg"
                alt="A rendered frame showing a rotating vector and the wave it traces."
              />
            </div>
          </div>
        </div>
      </section>

      <section
        className="mk-section"
        aria-labelledby="precision-title"
        data-reveal
      >
        <div className="mk-section-head">
          <span className="kicker">Under the hood</span>
          <h2 id="precision-title">Two renderers, one timeline.</h2>
          <p>
            Nothing on screen is a drawing that resembles the maths. It is the
            maths, evaluated and then animated.
          </p>
        </div>
        <div className="precision">
          <div className="precision-notes">
            <div className="precision-note">
              <h3>
                Manim <span className="mono">exact geometry</span>
              </h3>
              <p>
                Curves, axes, transforms, and solids are computed from the
                functions you are talking about. Equations are typeset with
                LaTeX, so a limit looks like a limit and the symbols match the
                picture.
              </p>
            </div>
            <div className="precision-note">
              <h3>
                Remotion <span className="mono">editorial motion</span>
              </h3>
              <p>
                Titles, callouts, pacing, and transitions are React components
                on a frame-accurate timeline, which keeps the presentation
                consistent from the first scene to the last.
              </p>
            </div>
            <div className="precision-note">
              <h3>
                One clock <span className="mono">audio and video</span>
              </h3>
              <p>
                Narration, animation, and captions are cut against the same
                timeline, so the explanation and the thing being explained stay
                in step.
              </p>
            </div>
          </div>
          <figure className="precision-figure">
            <div className="precision-visual stage-frame">
              <img
                src="/showcase/integral-1.jpg"
                alt="A rendered frame with a typeset Riemann sum beside the curve it measures."
              />
            </div>
            <figcaption>
              The rectangles here are evaluated from f, not drawn by eye, and{" "}
              <span className="mono">area &asymp; &Sigma; f(x&#7522;) &Delta;x</span>{" "}
              is typeset from the same expression that produced them.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="who-title" data-reveal>
        <div className="mk-section-head">
          <span className="kicker">Who it is for</span>
          <h2 id="who-title">Anyone stuck on one idea.</h2>
        </div>
        <div className="column-set">
          <div>
            <h3>Students</h3>
            <p>
              Bring the thing from lecture that did not land. Watch it built
              from the bottom, then keep asking until the gap closes.
            </p>
          </div>
          <div>
            <h3>Teachers</h3>
            <p>
              Make the visual you have been redrawing on the whiteboard for
              years — once, properly — and reuse it every term.
            </p>
          </div>
          <div>
            <h3>Creators</h3>
            <p>
              Draft an explainer in an afternoon instead of a week of keyframes,
              then take the version you like into your own edit.
            </p>
          </div>
        </div>
      </section>

      <section
        className="mk-section"
        id="faq"
        aria-labelledby="faq-title"
        data-reveal
      >
        <div className="mk-section-head">
          <span className="kicker">Questions</span>
          <h2 id="faq-title">Before you start.</h2>
        </div>
        <div className="faq-list">
          {FAQ.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="closing" aria-labelledby="closing-title" data-reveal>
        <h2 id="closing-title">
          Pick the idea you never quite got, and watch it get built.
        </h2>
        <div className="hero-actions">
          <a className="button button-primary" href="/studio">
            Start with one free lesson
          </a>
          <a className="text-link" href="/pricing">
            See the plans &rarr;
          </a>
        </div>
        <p>One lesson free. No card, no trial clock.</p>
      </section>
    </MarketingChrome>
  );
}
