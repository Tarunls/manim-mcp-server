import { useEffect, useRef } from "react";

type Grain = {
  x: number;
  y: number;
  delay: number;
  radius: number;
  phase: number;
  tone: number;
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

function resonanceState(seconds: number) {
  const cycle = seconds % 12;
  if (cycle < 1.5) return { blend: 0, activity: 0 };
  if (cycle < 5) {
    const progress = smoothstep((cycle - 1.5) / 3.5);
    return { blend: progress, activity: Math.sin(progress * Math.PI) };
  }
  if (cycle < 7) return { blend: 1, activity: 0 };
  if (cycle < 10.5) {
    const progress = smoothstep((cycle - 7) / 3.5);
    return { blend: 1 - progress, activity: Math.sin(progress * Math.PI) };
  }
  return { blend: 0, activity: 0 };
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

export function ChladniVisual({
  className = "",
  id,
}: {
  className?: string;
  id?: string;
}) {
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
      tone: hash(index, 6),
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
      const seconds = (timestamp - startedAt) / 1000;
      // Reduced motion keeps the explanation alive at a calmer speed and
      // amplitude instead of replacing the animation with a frozen frame.
      const motionScale = reducedMotion.matches ? 0.28 : 1;
      const motionSeconds = seconds * (reducedMotion.matches ? 0.52 : 1);
      const plateSize = Math.min(width * 0.84, height * 0.82);
      const resonance = resonanceState(motionSeconds);
      const blend = resonance.blend;
      const activity = resonance.activity * motionScale;
      const settle = smoothstep(seconds / 2.8);
      const wave = motionSeconds * 2.35;
      const plateBreath = Math.sin(wave) * 0.006 * motionScale;

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(
        width * 0.53,
        height * 0.5 + Math.sin(wave * 0.5) * (1.1 + activity * 1.8),
      );
      context.rotate(-0.035 + Math.sin(wave * 0.38) * 0.0045);
      context.scale(1 - plateBreath * 0.3, 1 + plateBreath);

      // The plate is an object in space, not a UI card: one quiet boundary,
      // a whisper of depth, and plenty of surrounding paper.
      context.save();
      context.shadowColor = `rgba(26, 25, 23, ${0.05 + activity * 0.035})`;
      context.shadowBlur = 26 + activity * 16;
      context.shadowOffsetY = 13 + activity * 8;
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

      // Moving displacement contours make the flex of the plate legible.
      // Their phase shifts continuously while the stationary node remains calm.
      const surfaceLevels = [-0.68, -0.3, 0.3, 0.68];
      for (let index = 0; index < surfaceLevels.length; index += 1) {
        const level =
          surfaceLevels[index] * (0.84 + Math.sin(wave + index * 1.2) * 0.12);
        context.strokeStyle =
          index < 2
            ? `rgba(46, 82, 102, ${0.075 + activity * 0.055})`
            : `rgba(176, 117, 72, ${0.08 + activity * 0.06})`;
        context.lineWidth = 0.8;
        contour(context, blend, level, plateSize, 46);
      }

      // The exact nodal geometry remains calm while the plate moves around it.
      context.strokeStyle = "rgba(176, 117, 72, 0.24)";
      context.lineWidth = 0.85;
      contour(context, blend, 0, plateSize, 72);

      const half = plateSize / 2;
      for (const grain of grains) {
        const target = projectToNode(grain.x, grain.y, blend);
        const introSettle = smoothstep((seconds - grain.delay) / 1.9);
        // A new tone briefly lifts the grains before they find the next set
        // of nodal lines. The stagger keeps the transition physical, not a fade.
        const localSettle =
          introSettle * (1 - activity * (0.42 + grain.tone * 0.18));
        const tremor = 0.0025 + (1 - localSettle) * 0.02;
        const targetField = field(target.x, target.y, blend);
        const targetMagnitude = Math.hypot(targetField.dx, targetField.dy) || 1;
        const tangentX = -targetField.dy / targetMagnitude;
        const tangentY = targetField.dx / targetMagnitude;
        const glide =
          Math.sin(wave * 0.48 + grain.phase) * (0.0015 + activity * 0.0045);
        const x =
          grain.x +
          (target.x - grain.x) * localSettle +
          Math.sin(wave * 2.7 + grain.phase) * tremor +
          tangentX * glide;
        const y =
          grain.y +
          (target.y - grain.y) * localSettle +
          Math.cos(wave * 2.3 + grain.phase) * tremor +
          tangentY * glide;

        const distance = Math.hypot(x, y);
        const travellingLight = 0.5 + 0.5 * Math.cos(distance * 18 - wave * 1.7);
        const warm = travellingLight > 0.84 && grain.tone > 0.67;

        context.beginPath();
        context.arc(x * half, y * half, grain.radius, 0, TAU);
        context.fillStyle = warm
          ? `rgba(176, 117, 72, ${0.34 + 0.28 * localSettle})`
          : `rgba(26, 25, 23, ${0.18 + 0.5 * localSettle})`;
        context.fill();
      }

      // Wavefronts travel all the way across the plate, tying the movement of
      // the grains to the small exciter at the center.
      const pulseStrength = 0.12 + activity * 0.13 + (1 - settle) * 0.14;
      const maximumRadius = plateSize * 0.72;
      for (let ring = 0; ring < 4; ring += 1) {
        const radius =
          8 +
          ((motionSeconds * 54 + ring * (maximumRadius / 4)) % maximumRadius);
        const edgeFade = Math.sin(Math.min(1, radius / maximumRadius) * Math.PI);
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.strokeStyle =
          ring % 2 === 0
            ? `rgba(46, 82, 102, ${pulseStrength * edgeFade})`
            : `rgba(176, 117, 72, ${pulseStrength * edgeFade * 0.8})`;
        context.lineWidth = 0.8;
        context.stroke();
      }
      context.beginPath();
      context.arc(0, 0, 3.2, 0, TAU);
      context.fillStyle = "#b07548";
      context.fill();

      context.restore();
      context.restore();

      animationFrame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      resize();
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
    <div
      className={`chladni-visual ${className}`}
      id={id}
      role="img"
      aria-label="A vibrating plate organizing scattered grains into a standing-wave pattern"
    >
      <canvas ref={canvasRef} className="chladni-canvas" aria-hidden="true" />
      <span className="visually-hidden">
        A simple vibration moves scattered grains into the intricate nodal lines
        of a Chladni figure, revealing the geometry of a standing wave.
      </span>
    </div>
  );
}
