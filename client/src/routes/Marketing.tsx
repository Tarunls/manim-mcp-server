import { useEffect } from "react";
import { MarketingChrome } from "./MarketingChrome";

type Lesson = {
  id: string;
  claim: string;
  note: string;
  poster: string;
  video: string;
};

const LEAD: Lesson = {
  id: "slope",
  claim: "That line's steepness is the derivative.",
  note: "The tangent is placed by evaluating the derivative at the marked point, so its slope is the number under discussion rather than a line that looks about right.",
  poster: "/showcase/slope.jpg",
  video: "/showcase/slope.mp4",
};

const SIDE: Lesson[] = [
  {
    id: "rotation",
    claim: "A rotation casts a wave.",
    note: "A hand turning at a steady rate, and the height it traces plotted beside it.",
    poster: "/showcase/rotation.jpg",
    video: "/showcase/rotation.mp4",
  },
  {
    id: "accumulation",
    claim: "The estimate stops being an estimate.",
    note: "Rectangles narrowing under a curve until the sum and the integral agree.",
    poster: "/showcase/accumulation.jpg",
    video: "/showcase/accumulation.mp4",
  },
];

function LessonFigure({
  lesson,
  className,
}: {
  lesson: Lesson;
  className?: string;
}) {
  return (
    <figure className={`lesson ${className || ""}`} id={`lesson-${lesson.id}`}>
      <div className="lesson-media">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={lesson.poster}
          src={lesson.video}
          aria-label={`${lesson.claim} A lesson rendered by Orune.`}
        />
      </div>
      <figcaption>
        <p className="lesson-note">{lesson.note}</p>
      </figcaption>
    </figure>
  );
}

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
      {/* 1 — hero: type across the top, the render taking the rest of the screen */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Hard ideas, made obvious.</h1>
          <div className="hero-aside">
            <p className="hero-lede">
              Write one sentence about what you are trying to understand. Orune
              renders it as a narrated lesson you can stop, mark up, and have
              rebuilt.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/studio">
                Start with one free lesson
              </a>
              <a className="text-link" href="#examples">
                See what it makes &rarr;
              </a>
            </div>
          </div>
        </div>
        <div className="hero-media">
          <div className="hero-stage">
            <video
              className="reel-video"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/showcase/accumulation.jpg"
              src="/showcase/accumulation.mp4"
              aria-label="An Orune lesson: rectangles under a curve narrowing until the estimate becomes the integral."
            />
          </div>
        </div>
      </section>

      {/* 2 — examples: a full-bleed spread, one large and two small */}
      <section className="spread" id="examples" aria-labelledby="examples-title">
        <div className="spread-head">
          <h2 id="examples-title">Three lessons</h2>
          <p>
            Each of these came out of the renderer from a single written prompt.
            Nothing here was drawn by hand or touched up afterwards.
          </p>
        </div>
        <div className="spread-grid" data-reveal>
          <LessonFigure lesson={LEAD} className="spread-lead" />
          <div className="spread-side">
            {SIDE.map((lesson) => (
              <LessonFigure key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </div>
      </section>

      {/* 3 — how it works: sticky steps on the left, the lesson on the right */}
      <section className="how" id="how-it-works" aria-labelledby="how-title">
        <div className="how-inner">
          <div className="how-rail">
            <span className="kicker">How it works</span>
            <h2 id="how-title">From a sentence to a finished lesson.</h2>
            <p>
              You write the description. Everything between that and the
              rendered file is automatic, until you want something changed.
            </p>
            <ol className="how-steps">
              <li>
                <div>
                  <h3>Describe the idea</h3>
                  <p>
                    Say what you are trying to understand and who it is for. No
                    storyboard, no script, no scene list.
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <h3>Orune builds it</h3>
                  <p>
                    It plans the beats, writes the Manim scenes, narrates them
                    against the animation, and renders the video.
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <h3>Correct what is wrong</h3>
                  <p>
                    Pause on a frame, draw on it, and say what should be
                    different. Only the scenes you touched are rendered again.
                  </p>
                </div>
              </li>
            </ol>
          </div>
          <figure className="how-figure">
            <div className="lesson-media">
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/showcase/rotation.jpg"
                src="/showcase/rotation.mp4"
                aria-label="An Orune lesson: a hand turning on a circle and the wave its height traces."
              />
            </div>
            <figcaption>
              <p className="how-prompt">
                &ldquo;Show me why a sine wave is just something going round a
                circle.&rdquo;
              </p>
              <p className="how-prompt-note">
                The prompt, and the lesson it produced.
              </p>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* 4 — precision: the one sunken band, no imagery */}
      <section className="tenet" aria-labelledby="tenet-title">
        <div className="tenet-inner" data-reveal>
          <span className="kicker">Why Manim</span>
          <h2 id="tenet-title">
            Every diagram is <em>computed</em>, not drawn.
          </h2>
          <div className="tenet-notes">
            <div>
              <h3>The picture is the function.</h3>
              <p>
                A curve is the function sampled along its own domain. A tangent
                is placed by the derivative at the point it touches. An area is
                the integral it is claiming to be. Nothing on screen is an
                artist&rsquo;s impression of the maths.
              </p>
            </div>
            <div>
              <h3>One renderer, no shortcuts.</h3>
              <p>
                Orune renders with Manim and nothing else. The symbols beneath a
                figure are set from the same expression that drew it, so the
                notation and the shape cannot drift apart.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 — close */}
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
        <p className="closing-note">
          One lesson free, no card. Paid plans start at $20 a month.
        </p>
      </section>
    </MarketingChrome>
  );
}
