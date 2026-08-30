import { useEffect, useRef } from "react";

type Grain = {
  x: number;
  y: number;
  delay: number;
  radius: number;
  phase: number;
};

type FieldSample = {
  value: number;
  dx: number;
  dy: number;
};

const TAU = Math.PI * 2;

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function hash(index: number, salt: number) {
  const value = Math.sin(index * 91.173 + salt * 47.119) * 43758.5453;
  return value - Math.floor(value);
}

function mode(x: number, y: number, n: number, m: number): FieldSample {
  const nx = n * Math.PI * x;
  const mx = m * Math.PI * x;
  const ny = n * Math.PI * y;
  const my = m * Math.PI * y;

  return {
    value: Math.sin(nx) * Math.sin(my) - Math.sin(mx) * Math.sin(ny),
    dx:
      n * Math.PI * Math.cos(nx) * Math.sin(my) -
      m * Math.PI * Math.cos(mx) * Math.sin(ny),
    dy:
      m * Math.PI * Math.sin(nx) * Math.cos(my) -
      n * Math.PI * Math.sin(mx) * Math.cos(ny),
  };
}

function field(x: number, y: number, blend: number): FieldSample {
  const first = mode(x, y, 4, 7);
  const second = mode(x, y, 5, 8);
  return {
    value: first.value * (1 - blend) + second.value * blend,
    dx: first.dx * (1 - blend) + second.dx * blend,
    dy: first.dy * (1 - blend) + second.dy * blend,
  };
}

function projectToNode(x: number, y: number, blend: number) {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 3; pass += 1) {
    const sample = field(px, py, blend);
    const magnitude = sample.dx * sample.dx + sample.dy * sample.dy + 0.002;
    const step = Math.max(-0.16, Math.min(0.16, sample.value / magnitude));
    px -= sample.dx * step;
    py -= sample.dy * step;
    px = Math.max(-0.985, Math.min(0.985, px));
    py = Math.max(-0.985, Math.min(0.985, py));
  }
  return { x: px, y: py };
}

function contour(
  context: CanvasRenderingContext2D,
  blend: number,
  level: number,
  size: number,
  resolution = 64,
) {
  const values: number[][] = [];
  for (let row = 0; row <= resolution; row += 1) {
    const y = -1 + (row / resolution) * 2;
    values[row] = [];
    for (let column = 0; column <= resolution; column += 1) {
      const x = -1 + (column / resolution) * 2;
      values[row][column] = field(x, y, blend).value;
    }
  }

  const point = (column: number, row: number) => ({
    x: ((column / resolution) * 2 - 1) * (size / 2),
    y: ((row / resolution) * 2 - 1) * (size / 2),
  });

  const intersection = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    av: number,
    bv: number,
  ) => {
    const amount = Math.max(0, Math.min(1, (level - av) / (bv - av || 1)));
    return {
      x: a.x + (b.x - a.x) * amount,
      y: a.y + (b.y - a.y) * amount,
    };
  };

  context.beginPath();
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const corners = [
        point(column, row),
        point(column + 1, row),
        point(column + 1, row + 1),
        point(column, row + 1),
      ];
      const samples = [
        values[row][column],
        values[row][column + 1],
        values[row + 1][column + 1],
        values[row + 1][column],
      ];
      const crossings: Array<{ x: number; y: number }> = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const next = (edge + 1) % 4;
        if ((samples[edge] < level) === (samples[next] < level)) continue;
        crossings.push(
          intersection(
            corners[edge],
            corners[next],
            samples[edge],
            samples[next],
          ),
        );
      }
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        context.moveTo(crossings[index].x, crossings[index].y);
        context.lineTo(crossings[index + 1].x, crossings[index + 1].y);
      }
    }
  }
  context.stroke();
}

export function ChladniVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const grains: Grain[] = Array.from({ length: 1320 }, (_, index) => ({
      x: hash(index, 1) * 1.88 - 0.94,
      y: hash(index, 2) * 1.88 - 0.94,
      delay: hash(index, 3) * 1.25,
      radius: 0.62 + hash(index, 4) * 0.72,
      phase: hash(index, 5) * TAU,
    }));

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
      if (!reducedMotion.matches && timestamp - lastFrameAt < 30) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      lastFrameAt = timestamp;
      if (!startedAt) startedAt = timestamp;
      const seconds = reducedMotion.matches ? 9 : (timestamp - startedAt) / 1000;
      const plateSize = Math.min(width * 0.84, height * 0.82);
      const blend =
        0.5 + 0.5 * Math.sin(Math.max(0, seconds - 3.6) * 0.24 - Math.PI / 2);
      const settle = reducedMotion.matches ? 1 : smoothstep(seconds / 3.4);
      const wave = seconds * 2.1;

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(width * 0.53, height * 0.5);
      context.rotate(-0.035);

      // The plate is an object in space, not a UI card: one quiet boundary,
      // a whisper of depth, and plenty of surrounding paper.
      context.save();
      context.shadowColor = "rgba(26, 25, 23, 0.055)";
      context.shadowBlur = 28;
      context.shadowOffsetY = 15;
      context.fillStyle = "rgba(255, 253, 248, 0.74)";
      context.fillRect(-plateSize / 2, -plateSize / 2, plateSize, plateSize);
      context.restore();

      context.strokeStyle = "rgba(83, 81, 75, 0.22)";
      context.lineWidth = 1;
      context.strokeRect(-plateSize / 2, -plateSize / 2, plateSize, plateSize);

      context.save();
      context.beginPath();
      context.rect(-plateSize / 2, -plateSize / 2, plateSize, plateSize);
      context.clip();

      // A moving displacement contour makes the vibration visible before the
      // grains reveal where the plate itself is standing still.
      context.strokeStyle = "rgba(46, 82, 102, 0.075)";
      context.lineWidth = 1;
      contour(context, blend, Math.sin(wave) * 0.58, plateSize, 56);
      context.strokeStyle = "rgba(176, 117, 72, 0.085)";
      contour(context, blend, Math.sin(wave + Math.PI) * 0.58, plateSize, 56);

      // The exact nodal geometry remains calm while the plate moves around it.
      context.strokeStyle = "rgba(176, 117, 72, 0.24)";
      context.lineWidth = 0.85;
      contour(context, blend, 0, plateSize, 72);

      const half = plateSize / 2;
      for (const grain of grains) {
        const target = projectToNode(grain.x, grain.y, blend);
        const localSettle = reducedMotion.matches
          ? 1
          : smoothstep((seconds - grain.delay) / 2.5);
        const tremor = (1 - localSettle) * 0.011;
        const x =
          grain.x + (target.x - grain.x) * localSettle + Math.sin(wave * 2.7 + grain.phase) * tremor;
        const y =
          grain.y + (target.y - grain.y) * localSettle + Math.cos(wave * 2.3 + grain.phase) * tremor;

        context.beginPath();
        context.arc(x * half, y * half, grain.radius, 0, TAU);
        context.fillStyle = `rgba(26, 25, 23, ${0.2 + 0.48 * localSettle})`;
        context.fill();
      }

      // The exciter is the only explicit cause in the composition. Its pulse
      // recedes as order appears, keeping the final frame beautifully sparse.
      const pulseStrength = 0.34 * (1 - settle * 0.55);
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = 7 + ((seconds * 26 + ring * 24) % 72);
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.strokeStyle = `rgba(46, 82, 102, ${pulseStrength * (1 - radius / 82)})`;
        context.lineWidth = 1;
        context.stroke();
      }
      context.beginPath();
      context.arc(0, 0, 3.2, 0, TAU);
      context.fillStyle = "#b07548";
      context.fill();

      context.restore();
      context.restore();

      if (!reducedMotion.matches) animationFrame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches) draw(performance.now());
    });
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
      className="hero-visual hero-chladni"
      id="how-it-works"
      aria-label="A vibrating plate organizing scattered grains into a standing-wave pattern"
    >
      <canvas ref={canvasRef} className="hero-chladni-canvas" aria-hidden="true" />
      <figcaption className="visually-hidden">
        A simple vibration moves scattered grains into the intricate nodal lines
        of a Chladni figure, revealing the geometry of a standing wave.
      </figcaption>
    </figure>
  );
}
