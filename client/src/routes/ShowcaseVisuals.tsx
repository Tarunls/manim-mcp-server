import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

function useCanvasAnimation(
  drawFrame: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    seconds: number,
  ) => void,
) {
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
      const speed = reducedMotion.matches ? 0.4 : 1;
      drawFrame(context, width, height, ((timestamp - startedAt) / 1000) * speed);
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
  }, [drawFrame]);

  return canvasRef;
}

function drawCaustic(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seconds: number,
) {
  context.clearRect(0, 0, width, height);
  const radius = Math.min(width, height) * 0.39;
  const center = { x: width * 0.5, y: height * 0.52 };
  // The source travels all the way around the boundary. The caustic rotates
  // with it, making the animation unmistakable even at a quick glance.
  const sourceAngle = seconds * 0.44 - Math.PI * 0.7;
  const source = {
    x: center.x + Math.cos(sourceAngle) * radius,
    y: center.y + Math.sin(sourceAngle) * radius,
  };

  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, TAU);
  context.clip();
  context.lineWidth = 0.72;

  for (let index = 0; index < 84; index += 1) {
    const angle = (index / 84) * TAU;
    const hit = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    const incomingLength = Math.hypot(hit.x - source.x, hit.y - source.y) || 1;
    const incoming = {
      x: (hit.x - source.x) / incomingLength,
      y: (hit.y - source.y) / incomingLength,
    };
    const normal = { x: Math.cos(angle), y: Math.sin(angle) };
    const dot = incoming.x * normal.x + incoming.y * normal.y;
    const reflected = {
      x: incoming.x - 2 * dot * normal.x,
      y: incoming.y - 2 * dot * normal.y,
    };
    context.beginPath();
    context.moveTo(hit.x, hit.y);
    context.lineTo(
      hit.x + reflected.x * radius * 2.05,
      hit.y + reflected.y * radius * 2.05,
    );
    context.strokeStyle =
      index % 7 === 0
        ? "rgba(176, 117, 72, 0.19)"
        : "rgba(46, 82, 102, 0.12)";
    context.stroke();
  }
  context.restore();

  context.beginPath();
  context.arc(center.x, center.y, radius, 0, TAU);
  context.strokeStyle = "rgba(83, 81, 75, 0.22)";
  context.lineWidth = 1;
  context.stroke();
  context.beginPath();
  context.arc(source.x, source.y, 3, 0, TAU);
  context.fillStyle = "#b07548";
  context.fill();
}

export function CausticVisual() {
  const canvasRef = useCanvasAnimation(drawCaustic);
  return (
    <div
      className="showcase-visual"
      role="img"
      aria-label="Reflected light forming a caustic curve inside a circle"
    >
      <canvas ref={canvasRef} className="concept-canvas" aria-hidden="true" />
    </div>
  );
}

function drawCycloid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seconds: number,
) {
  context.clearRect(0, 0, width, height);
  const radius = Math.min(width, height) * 0.145;
  const baseline = height * 0.72;
  const start = -radius;
  const travel = width + radius * 2;
  const progress = (seconds * 0.105) % 1;
  const distance = travel * progress;
  const theta = distance / radius;
  const centerX = start + distance;

  context.beginPath();
  context.moveTo(width * 0.04, baseline);
  context.lineTo(width * 0.96, baseline);
  context.strokeStyle = "rgba(83, 81, 75, 0.2)";
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  for (let sample = 0; sample <= 180; sample += 1) {
    const sampleProgress = (sample / 180) * progress;
    const sampleDistance = travel * sampleProgress;
    const sampleTheta = sampleDistance / radius;
    const x = start + sampleDistance - Math.sin(sampleTheta) * radius;
    const y = baseline - radius + Math.cos(sampleTheta) * radius;
    if (sample === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = "rgba(176, 117, 72, 0.72)";
  context.lineWidth = 1.45;
  context.stroke();

  context.beginPath();
  context.arc(centerX, baseline - radius, radius, 0, TAU);
  context.strokeStyle = "rgba(46, 82, 102, 0.34)";
  context.lineWidth = 1;
  context.stroke();

  const point = {
    x: centerX - Math.sin(theta) * radius,
    y: baseline - radius + Math.cos(theta) * radius,
  };
  context.beginPath();
  context.moveTo(centerX, baseline - radius);
  context.lineTo(point.x, point.y);
  context.strokeStyle = "rgba(46, 82, 102, 0.48)";
  context.stroke();
  context.beginPath();
  context.arc(point.x, point.y, 3.1, 0, TAU);
  context.fillStyle = "#b07548";
  context.fill();
}

export function CycloidVisual() {
  const canvasRef = useCanvasAnimation(drawCycloid);
  return (
    <div
      className="showcase-visual"
      role="img"
      aria-label="A point on a rolling circle tracing a cycloid"
    >
      <canvas ref={canvasRef} className="concept-canvas" aria-hidden="true" />
    </div>
  );
}
