import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function cycleState(seconds: number) {
  const time = seconds % 16.5;
  if (time < 1.8) return { layout: 0, unwrap: 0, formula: 0 };
  if (time < 3) {
    return { layout: ease((time - 1.8) / 1.2), unwrap: 0, formula: 0 };
  }
  if (time < 8.5) {
    const unwrap = ease((time - 3) / 5.5);
    return { layout: 1, unwrap, formula: ease((unwrap - 0.78) / 0.22) };
  }
  if (time < 11) return { layout: 1, unwrap: 1, formula: 1 };
  if (time < 14.5) {
    const unwrap = 1 - ease((time - 11) / 3.5);
    return { layout: 1, unwrap, formula: ease((unwrap - 0.78) / 0.22) };
  }
  if (time < 15.7) {
    return { layout: 1 - ease((time - 14.5) / 1.2), unwrap: 0, formula: 0 };
  }
  return { layout: 0, unwrap: 0, formula: 0 };
}

export function CircleTriangleVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    let height = 0;
    let startedAt = 0;
    let lastFrameAt = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (timestamp: number) => {
      if (timestamp - lastFrameAt < 30) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastFrameAt = timestamp;
      if (!startedAt) startedAt = timestamp;

      const seconds =
        ((timestamp - startedAt) / 1000) * (reducedMotion.matches ? 0.45 : 1);
      const state = cycleState(seconds);
      const ringCount = 30;
      const samples = 96;
      const initialRadius = Math.min(width * 0.285, height * 0.365);
      const pairedRadius = Math.min(width * 0.205, height * 0.275);
      const radius =
        initialRadius + (pairedRadius - initialRadius) * state.layout;
      const circleCenter = {
        x: width * (0.5 - state.layout * 0.23),
        y: height * 0.435,
      };
      const triangleCenterX = width * 0.72;
      const triangleHeight = pairedRadius * 1.9;
      const triangleTop = height * 0.435 - triangleHeight / 2;
      const triangleBottom = triangleTop + triangleHeight;
      const triangleBase = Math.min(width * 0.46, pairedRadius * 2.65);
      const circumferenceScale = triangleBase / (TAU * pairedRadius);

      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      for (let ring = 1; ring <= ringCount; ring += 1) {
        const normalizedRadius = ring / ringCount;
        const ringRadius = radius * normalizedRadius;
        // The outside circumference unwraps first. The remaining rings follow
        // inwards, so the triangle is visibly assembled instead of morphed.
        const order = 1 - normalizedRadius;
        const localAmount = ease((state.unwrap - order * 0.56) / 0.44);
        const alpha = 0.1 + normalizedRadius * 0.25;

        context.beginPath();
        for (let sample = 0; sample <= samples; sample += 1) {
          const theta = (sample / samples) * TAU - Math.PI / 2;
          const circleX = circleCenter.x + Math.cos(theta) * ringRadius;
          const circleY = circleCenter.y + Math.sin(theta) * ringRadius;
          const lineProgress = sample / samples - 0.5;
          const lineX =
            triangleCenterX +
            lineProgress * TAU * pairedRadius * normalizedRadius * circumferenceScale;
          const lineY = triangleTop + normalizedRadius * triangleHeight;
          const x = circleX + (lineX - circleX) * localAmount;
          const y = circleY + (lineY - circleY) * localAmount;
          if (sample === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle =
          ring === ringCount
            ? `rgba(176, 117, 72, ${0.5 + localAmount * 0.18})`
            : ring % 6 === 0
              ? `rgba(176, 117, 72, ${alpha})`
              : `rgba(46, 82, 102, ${alpha})`;
        context.lineWidth = ring === ringCount ? 1.35 : 0.72;
        context.stroke();
      }

      // Keep a ghost of the source visible once the rings start leaving it.
      if (state.unwrap > 0.08) {
        context.beginPath();
        context.arc(
          circleCenter.x,
          circleCenter.y,
          pairedRadius,
          -Math.PI / 2 + 0.035,
          -Math.PI / 2 + TAU - 0.035,
        );
        context.strokeStyle = `rgba(46, 82, 102, ${0.05 + state.unwrap * 0.08})`;
        context.lineWidth = 0.85;
        context.stroke();
      }

      // One radius becomes the triangle's height. The copper circumference
      // becomes its base, preserving both quantities throughout the sequence.
      const guideAmount = state.unwrap;
      const radiusStart = {
        x: circleCenter.x,
        y: circleCenter.y,
      };
      const radiusEnd = {
        x: circleCenter.x,
        y: circleCenter.y - radius,
      };
      const heightStart = {
        x: triangleCenterX,
        y: triangleBottom,
      };
      const heightEnd = {
        x: triangleCenterX,
        y: triangleTop,
      };
      context.beginPath();
      context.moveTo(
        radiusStart.x + (heightStart.x - radiusStart.x) * guideAmount,
        radiusStart.y + (heightStart.y - radiusStart.y) * guideAmount,
      );
      context.lineTo(
        radiusEnd.x + (heightEnd.x - radiusEnd.x) * guideAmount,
        radiusEnd.y + (heightEnd.y - radiusEnd.y) * guideAmount,
      );
      context.strokeStyle = "rgba(176, 117, 72, 0.72)";
      context.lineWidth = 1.35;
      context.stroke();

      context.beginPath();
      context.arc(
        circleCenter.x + (triangleCenterX - circleCenter.x) * guideAmount,
        circleCenter.y + (triangleBottom - circleCenter.y) * guideAmount,
        2.5,
        0,
        TAU,
      );
      context.fillStyle = "#b07548";
      context.fill();

      // A final outline removes any ambiguity about the constructed shape.
      const outlineAlpha = ease((state.unwrap - 0.82) / 0.18);
      if (outlineAlpha > 0) {
        context.beginPath();
        context.moveTo(triangleCenterX, triangleTop);
        context.lineTo(triangleCenterX + triangleBase / 2, triangleBottom);
        context.lineTo(triangleCenterX - triangleBase / 2, triangleBottom);
        context.closePath();
        context.strokeStyle = `rgba(26, 25, 23, ${outlineAlpha * 0.3})`;
        context.lineWidth = 1.05;
        context.stroke();
      }

      if (state.formula > 0) {
        context.save();
        context.globalAlpha = state.formula;
        context.fillStyle = "rgba(26, 25, 23, 0.72)";
        context.font = `${Math.max(14, Math.min(18, width * 0.026))}px Georgia, serif`;
        context.textAlign = "center";
        context.fillText(
          "A△ = ½ × base × height",
          triangleCenterX,
          triangleBottom + Math.max(30, height * 0.065),
        );
        context.font = `${Math.max(13, Math.min(16, width * 0.023))}px Georgia, serif`;
        context.fillText(
          "= ½ × circumference × radius = πr²",
          triangleCenterX,
          triangleBottom + Math.max(53, height * 0.11),
        );
        context.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <figure
      className="hero-visual hero-circle-triangle"
      id="how-it-works"
      aria-label="A circle's concentric rings unfolding into a triangle"
    >
      <canvas
        ref={canvasRef}
        className="circle-triangle-canvas"
        aria-hidden="true"
      />
      <figcaption className="visually-hidden">
        Concentric rings unwrap into stacked line segments, transforming a
        circle into a triangle with the same area.
      </figcaption>
    </figure>
  );
}
