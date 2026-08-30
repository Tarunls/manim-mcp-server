import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

type Point = { x: number; y: number };

function cubicPoint(
  start: Point,
  first: Point,
  second: Point,
  end: Point,
  amount: number,
) {
  const inverse = 1 - amount;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * amount * first.x +
      3 * inverse * amount ** 2 * second.x +
      amount ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * amount * first.y +
      3 * inverse * amount ** 2 * second.y +
      amount ** 3 * end.y,
  };
}

function drawCubic(
  context: CanvasRenderingContext2D,
  start: Point,
  first: Point,
  second: Point,
  end: Point,
) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
  context.stroke();
}

function warpedPoint(x: number, y: number, scale: number) {
  const radiusSquared = x * x + y * y;
  const warp = 0.12 * Math.exp(-radiusSquared * 1.7) / (radiusSquared + 0.095);
  return {
    x: x * (1 + warp) * scale,
    y: y * (1 + warp) * scale,
  };
}

function drawWarpedGrid(context: CanvasRenderingContext2D, size: number) {
  const scale = size / 2;
  const lines = 10;
  const samples = 72;

  for (let index = -lines; index <= lines; index += 1) {
    const fixed = index / lines;
    const major = index === 0;
    context.strokeStyle = major
      ? "rgba(46, 82, 102, 0.18)"
      : index % 2 === 0
        ? "rgba(46, 82, 102, 0.09)"
        : "rgba(176, 117, 72, 0.075)";
    context.lineWidth = major ? 0.9 : 0.65;

    context.beginPath();
    for (let sample = 0; sample <= samples; sample += 1) {
      const moving = -1 + (sample / samples) * 2;
      const point = warpedPoint(fixed, moving, scale);
      if (sample === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();

    context.beginPath();
    for (let sample = 0; sample <= samples; sample += 1) {
      const moving = -1 + (sample / samples) * 2;
      const point = warpedPoint(moving, fixed, scale);
      if (sample === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
}

export function GravitationalLensVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let startedAt = 0;
    let lastFrameAt = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (timestamp: number) => {
      if (timestamp - lastFrameAt < 30) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      lastFrameAt = timestamp;
      if (!startedAt) startedAt = timestamp;

      const elapsed = (timestamp - startedAt) / 1000;
      const seconds = elapsed * (reducedMotion.matches ? 0.48 : 1);
      const size = Math.min(width * 0.92, height * 0.9);
      const center = { x: width * 0.53, y: height * 0.5 };
      const lensRadius = size * 0.055;
      const sourceOffset = Math.sin(seconds * 0.56) * 0.82;
      const alignment = Math.exp(-Math.pow(sourceOffset * 2.15, 2));
      const source = {
        x: center.x + size * 0.5,
        y: center.y + sourceOffset * size * 0.26,
      };
      const observer = { x: center.x - size * 0.55, y: center.y };
      const pathLift = size * (0.19 + alignment * 0.035);
      const upperFirst = {
        x: center.x + size * 0.18,
        y: center.y - pathLift + sourceOffset * size * 0.055,
      };
      const upperSecond = {
        x: center.x - size * 0.18,
        y: center.y - pathLift,
      };
      const lowerFirst = {
        x: center.x + size * 0.18,
        y: center.y + pathLift + sourceOffset * size * 0.055,
      };
      const lowerSecond = {
        x: center.x - size * 0.18,
        y: center.y + pathLift,
      };

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(center.x, center.y);
      context.rotate(-0.018 + Math.sin(seconds * 0.18) * 0.004);
      drawWarpedGrid(context, size);
      context.restore();

      // Two possible paths from the same source curve around the mass.
      context.lineWidth = 1.05;
      context.strokeStyle = "rgba(46, 82, 102, 0.34)";
      drawCubic(context, source, upperFirst, upperSecond, observer);
      context.strokeStyle = "rgba(176, 117, 72, 0.38)";
      drawCubic(context, source, lowerFirst, lowerSecond, observer);

      // Small packets of light make the bending visible without turning the
      // illustration into a particle effect.
      for (let path = 0; path < 2; path += 1) {
        for (let packet = 0; packet < 4; packet += 1) {
          const amount = (seconds * 0.2 + packet * 0.25 + path * 0.08) % 1;
          const point = cubicPoint(
            source,
            path === 0 ? upperFirst : lowerFirst,
            path === 0 ? upperSecond : lowerSecond,
            observer,
            amount,
          );
          context.beginPath();
          context.arc(point.x, point.y, 1.7, 0, TAU);
          context.fillStyle =
            path === 0 ? "rgba(46, 82, 102, 0.78)" : "rgba(176, 117, 72, 0.82)";
          context.fill();
        }
      }

      // As the source aligns behind the lens, its two images stretch into an
      // Einstein ring. Away from alignment, the ring separates back into arcs.
      const sourceAngle = Math.atan2(source.y - center.y, source.x - center.x);
      const ringRadius = lensRadius * (2.15 + (1 - alignment) * 0.16);
      const arcSpan = 0.28 + alignment * (Math.PI - 0.31);
      context.save();
      context.translate(center.x, center.y);
      context.lineCap = "round";
      context.shadowBlur = 13 + alignment * 18;
      context.shadowColor = "rgba(176, 117, 72, 0.26)";
      context.lineWidth = 2.2 + alignment * 1.2;
      context.strokeStyle = `rgba(176, 117, 72, ${0.55 + alignment * 0.34})`;
      context.beginPath();
      context.arc(0, 0, ringRadius, sourceAngle - arcSpan / 2, sourceAngle + arcSpan / 2);
      context.stroke();
      context.shadowColor = "rgba(46, 82, 102, 0.24)";
      context.strokeStyle = `rgba(46, 82, 102, ${0.5 + alignment * 0.36})`;
      context.beginPath();
      context.arc(
        0,
        0,
        ringRadius,
        sourceAngle + Math.PI - arcSpan / 2,
        sourceAngle + Math.PI + arcSpan / 2,
      );
      context.stroke();
      context.restore();

      const lensGlow = context.createRadialGradient(
        center.x - lensRadius * 0.25,
        center.y - lensRadius * 0.3,
        lensRadius * 0.08,
        center.x,
        center.y,
        lensRadius * 1.5,
      );
      lensGlow.addColorStop(0, "#4d6170");
      lensGlow.addColorStop(0.42, "#232a2d");
      lensGlow.addColorStop(1, "rgba(26, 25, 23, 0)");
      context.beginPath();
      context.arc(center.x, center.y, lensRadius * 1.5, 0, TAU);
      context.fillStyle = lensGlow;
      context.fill();
      context.beginPath();
      context.arc(center.x, center.y, lensRadius, 0, TAU);
      context.fillStyle = "#1a1917";
      context.fill();

      // The real source traces one quiet path while its apparent images change.
      context.beginPath();
      context.arc(source.x, source.y, 3.4, 0, TAU);
      context.fillStyle = "#b07548";
      context.fill();
      context.strokeStyle = "rgba(176, 117, 72, 0.38)";
      context.lineWidth = 0.8;
      for (let ray = 0; ray < 4; ray += 1) {
        const angle = ray * (Math.PI / 2);
        context.beginPath();
        context.moveTo(
          source.x + Math.cos(angle) * 5.5,
          source.y + Math.sin(angle) * 5.5,
        );
        context.lineTo(
          source.x + Math.cos(angle) * 11,
          source.y + Math.sin(angle) * 11,
        );
        context.stroke();
      }

      animationFrame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <figure
      className="hero-visual hero-lens"
      id="how-it-works"
      aria-label="Light bending around a massive object and forming an Einstein ring"
    >
      <canvas ref={canvasRef} className="hero-lens-canvas" aria-hidden="true" />
      <figcaption className="visually-hidden">
        A background source moves behind a massive object. Its light splits
        around the gravitational field and briefly forms a bright Einstein ring.
      </figcaption>
    </figure>
  );
}
