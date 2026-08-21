import React, { type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FPS = 30;
const SCENE_FRAMES = 120;
const COLORS = {
  ink: "#f7f2df",
  cyan: "#4de4ff",
  blue: "#4788ff",
  gold: "#ffc857",
  coral: "#ff6f61",
  ember: "#ff9f43",
  dark: "#050708",
};

function sceneOpacity(frame: number, duration = SCENE_FRAMES + 12) {
  return interpolate(frame, [0, 12, duration - 18, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

function Scene({ children, accent }: { children: ReactNode; accent: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity(frame),
        overflow: "hidden",
        background: `radial-gradient(circle at 64% 46%, ${accent}1f 0, transparent 30%), #050708`,
      }}
    >
      <div className="reel-grain" />
      {children}
    </AbsoluteFill>
  );
}

function SceneNumber({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 74, top: 58, display: "flex", alignItems: "center", gap: 15, color: "rgba(247,242,223,.72)", fontFamily: "Arial, sans-serif", fontSize: 15, letterSpacing: 4, textTransform: "uppercase" }}>
      <span style={{ width: 54, height: 1, background: COLORS.gold }} />{children}
    </div>
  );
}

function IntegralVolume() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [6, 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const turn = interpolate(frame, [52, 108], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const bars = Array.from({ length: 22 }, (_, index) => {
    const x = 115 + index * 25;
    const normalized = index / 21;
    const curveY = 495 - 315 * normalized * normalized;
    return { x, y: curveY, height: 555 - curveY };
  });
  return (
    <Scene accent={COLORS.cyan}>
      <SceneNumber>Accumulation becomes form</SceneNumber>
      <svg width="1280" height="720" viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="1" y2="0"><stop stopColor={COLORS.cyan} stopOpacity=".08"/><stop offset="1" stopColor={COLORS.gold} stopOpacity=".72"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g opacity={1 - turn * .55} transform={`translate(${-turn * 165} 0)`}>
          <path d="M92 555H694M115 584V142" stroke="rgba(247,242,223,.38)" strokeWidth="2"/>
          {bars.map((bar, index) => {
            const growth = interpolate(draw, [index / 30, Math.min(1, index / 30 + .3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <rect key={bar.x} x={bar.x} y={555 - bar.height * growth} width="18" height={bar.height * growth} fill="url(#area)" stroke="rgba(77,228,255,.38)" strokeWidth="1" />;
          })}
          <path d="M115 495C220 485 320 432 410 356C500 280 580 204 655 174" fill="none" stroke={COLORS.cyan} strokeWidth="7" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - draw} filter="url(#glow)"/>
          <text x="205" y="650" fill={COLORS.ink} fontFamily="Georgia, serif" fontSize="52" opacity={draw}>∫ f(x) dx</text>
        </g>
        <g opacity={turn} transform={`translate(${70 - (1 - turn) * 100} 0)`}>
          {Array.from({ length: 18 }, (_, index) => {
            const y = 199 + index * 19;
            const radiusX = 226 - Math.abs(index - 8) * 4;
            const phase = (frame * 1.8 + index * 11) * Math.PI / 180;
            return <ellipse key={y} cx="925" cy={y} rx={radiusX} ry={42 + Math.sin(phase) * 3} fill="none" stroke={index % 3 === 0 ? COLORS.gold : COLORS.cyan} strokeOpacity={.18 + (index % 3) * .12} strokeWidth={index % 3 === 0 ? 3 : 1.5}/>;
          })}
          {Array.from({ length: 15 }, (_, index) => {
            const angle = index / 15 * Math.PI * 2 + frame / 105;
            const x1 = 925 + Math.cos(angle) * 190;
            const x2 = 925 + Math.cos(angle + .48) * 225;
            return <path key={index} d={`M ${x1} 190 Q ${x2} 360 ${x1} 536`} fill="none" stroke={COLORS.cyan} strokeOpacity=".28" strokeWidth="2"/>;
          })}
          <ellipse cx="925" cy="190" rx="190" ry="43" fill="rgba(77,228,255,.06)" stroke={COLORS.gold} strokeWidth="4"/>
          <ellipse cx="925" cy="536" rx="190" ry="43" fill="rgba(255,200,87,.08)" stroke={COLORS.cyan} strokeWidth="4"/>
        </g>
      </svg>
    </Scene>
  );
}

function DerivativeTangent() {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [8, 104], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const x = 170 + p * 870;
  const y = 385 - Math.sin((x - 180) / 150) * 126 - (x - 610) * .08;
  const slope = -Math.cos((x - 180) / 150) * .84 - .08;
  const lineLength = 270;
  return (
    <Scene accent={COLORS.coral}>
      <SceneNumber>A change, made visible</SceneNumber>
      <svg width="1280" height="720" viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        <defs><filter id="dotGlow"><feGaussianBlur stdDeviation="9" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {Array.from({ length: 15 }, (_, i) => <line key={`v${i}`} x1={90 + i * 82} y1="120" x2={90 + i * 82} y2="620" stroke="rgba(247,242,223,.055)"/>)}
        {Array.from({ length: 8 }, (_, i) => <line key={`h${i}`} x1="75" y1={126 + i * 70} x2="1210" y2={126 + i * 70} stroke="rgba(247,242,223,.055)"/>)}
        <path d="M115 472C240 518 335 232 470 270C616 310 651 511 782 458C935 396 968 190 1160 242" fill="none" stroke={COLORS.cyan} strokeWidth="7" strokeLinecap="round"/>
        <line x1={x - lineLength} y1={y - slope * -lineLength} x2={x + lineLength} y2={y - slope * lineLength} stroke={COLORS.gold} strokeWidth="5" strokeLinecap="round"/>
        <circle cx={x} cy={y} r="14" fill={COLORS.coral} filter="url(#dotGlow)"/>
        <circle cx={x} cy={y} r="31" fill="none" stroke={COLORS.coral} strokeOpacity=".28" strokeWidth="2"/>
        <text x="90" y="664" fill={COLORS.ink} fontFamily="Georgia, serif" fontSize="44">dy/dx</text>
        <text x="1030" y="664" fill={COLORS.gold} fontFamily="Arial, sans-serif" fontSize="18" letterSpacing="5">RIGHT NOW</text>
      </svg>
    </Scene>
  );
}

function wavePath(amplitude: number, cycles: number, phase: number, center: number) {
  const points: string[] = [];
  for (let x = 0; x <= 1120; x += 8) points.push(`${80 + x},${center + Math.sin(x / 1120 * cycles * Math.PI * 2 + phase) * amplitude}`);
  return `M${points.join(" L")}`;
}

function Harmonics() {
  const frame = useCurrentFrame();
  const phases = [frame / 22, -frame / 15, frame / 9];
  return (
    <Scene accent={COLORS.gold}>
      <SceneNumber>Hidden frequencies, revealed</SceneNumber>
      <svg width="1280" height="720" viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        <defs><filter id="waveGlow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {[0,1,2].map((index) => <path key={index} d={wavePath(78 - index * 17, 1 + index * 2, phases[index], 236 + index * 130)} fill="none" stroke={[COLORS.cyan, COLORS.gold, COLORS.coral][index]} strokeWidth={index === 0 ? 8 : 4} strokeOpacity={1 - index * .18} filter="url(#waveGlow)"/>)}
        <line x1="80" y1="618" x2="1200" y2="618" stroke="rgba(247,242,223,.26)" strokeWidth="2"/>
        {Array.from({ length: 30 }, (_, index) => {
          const focus = [3, 9, 20];
          const proximity = Math.max(...focus.map((target) => Math.exp(-Math.abs(index - target) * .68)));
          const pulse = .82 + Math.sin(frame / 7 + index) * .14;
          const height = 22 + proximity * 126 * pulse;
          return <rect key={index} x={85 + index * 36.4} y={618 - height} width="13" height={height} rx="6" fill={index < 7 ? COLORS.cyan : index < 16 ? COLORS.gold : COLORS.coral} opacity={.25 + proximity * .68}/>;
        })}
      </svg>
    </Scene>
  );
}

function LinearTransform() {
  const frame = useCurrentFrame();
  const progress = (Math.sin(frame / 30 - Math.PI / 2) + 1) / 2;
  const centerX = 640;
  const centerY = 368;
  const transformPoint = (x: number, y: number) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return [centerX + dx * (1 + .26 * progress) + dy * .46 * progress, centerY + dy * (1 - .18 * progress) - dx * .12 * progress];
  };
  return (
    <Scene accent={COLORS.blue}>
      <SceneNumber>Space learns a new rule</SceneNumber>
      <svg width="1280" height="720" viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: 17 }, (_, index) => {
          const x = 80 + index * 70;
          const a = transformPoint(x, 90); const b = transformPoint(x, 650);
          return <line key={`v${index}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={index === 8 ? COLORS.cyan : "rgba(71,136,255,.24)"} strokeWidth={index === 8 ? 4 : 2}/>;
        })}
        {Array.from({ length: 9 }, (_, index) => {
          const y = 90 + index * 70;
          const a = transformPoint(80, y); const b = transformPoint(1200, y);
          return <line key={`h${index}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={index === 4 ? COLORS.gold : "rgba(71,136,255,.24)"} strokeWidth={index === 4 ? 4 : 2}/>;
        })}
        <g transform={`translate(${centerX} ${centerY})`}>
          <line x1="0" y1="0" x2={230 + progress * 70} y2={-75 * progress} stroke={COLORS.coral} strokeWidth="10" strokeLinecap="round"/>
          <polygon points={`${230 + progress * 70},${-75 * progress} ${208 + progress * 70},${-92 - 75 * progress} ${211 + progress * 70},${-56 - 75 * progress}`} fill={COLORS.coral}/>
          <line x1="0" y1="0" x2={88 * progress} y2={-220 + progress * 35} stroke={COLORS.gold} strokeWidth="10" strokeLinecap="round"/>
          <polygon points={`${88 * progress},${-220 + progress * 35} ${68 + 88 * progress},${-196 + progress * 35} ${104 + 88 * progress},${-190 + progress * 35}`} fill={COLORS.gold}/>
        </g>
        <text x="86" y="660" fill={COLORS.ink} fontFamily="Georgia, serif" fontSize="42">A · v</text>
      </svg>
    </Scene>
  );
}

const NETWORK_LAYERS = [
  [{ x: 150, y: 245 }, { x: 150, y: 365 }, { x: 150, y: 485 }],
  [{ x: 410, y: 180 }, { x: 410, y: 305 }, { x: 410, y: 430 }, { x: 410, y: 555 }],
  [{ x: 680, y: 210 }, { x: 680, y: 365 }, { x: 680, y: 520 }],
  [{ x: 940, y: 245 }, { x: 940, y: 365 }, { x: 940, y: 485 }],
  [{ x: 1150, y: 365 }],
];

function NeuralNetwork() {
  const frame = useCurrentFrame();
  return (
    <Scene accent={COLORS.coral}>
      <SceneNumber>An idea moving through a network</SceneNumber>
      <svg width="1280" height="720" viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        <defs><filter id="nodeGlow"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {NETWORK_LAYERS.slice(0, -1).flatMap((layer, layerIndex) => layer.flatMap((node, nodeIndex) => NETWORK_LAYERS[layerIndex + 1].map((target, targetIndex) => {
          const signal = (Math.sin(frame / 8 - layerIndex * 1.7 - nodeIndex * .5 - targetIndex * .8) + 1) / 2;
          return <line key={`${layerIndex}-${nodeIndex}-${targetIndex}`} x1={node.x} y1={node.y} x2={target.x} y2={target.y} stroke={layerIndex % 2 ? COLORS.gold : COLORS.blue} strokeOpacity={.06 + signal * .26} strokeWidth={1 + signal * 2}/>;
        })))}
        {NETWORK_LAYERS.flatMap((layer, layerIndex) => layer.map((node, nodeIndex) => {
          const pulse = (Math.sin(frame / 7 - layerIndex * 1.5 - nodeIndex) + 1) / 2;
          const activeLayer = Math.floor((frame / 24) % NETWORK_LAYERS.length);
          const active = layerIndex === activeLayer;
          return <g key={`${layerIndex}-${nodeIndex}`} filter={active ? "url(#nodeGlow)" : undefined}><circle cx={node.x} cy={node.y} r={14 + pulse * 5} fill={active ? COLORS.coral : COLORS.dark} stroke={active ? COLORS.coral : layerIndex % 2 ? COLORS.gold : COLORS.cyan} strokeWidth={4}/><circle cx={node.x} cy={node.y} r="4" fill={COLORS.ink} opacity={.65 + pulse * .35}/></g>;
        }))}
      </svg>
    </Scene>
  );
}

function OrbitingSurface() {
  const frame = useCurrentFrame();
  const reveal = spring({ frame, fps: FPS, config: { damping: 18, mass: .8 } });
  return (
    <Scene accent={COLORS.cyan}>
      <SceneNumber>One surface. Infinite viewpoints.</SceneNumber>
      <div style={{ position: "absolute", left: "50%", top: "52%", width: 610, height: 610, transformStyle: "preserve-3d", transform: `translate(-50%,-50%) rotateX(${62 + Math.sin(frame / 40) * 8}deg) rotateZ(${frame * .75}deg) scale(${.7 + reveal * .3})` }}>
        {Array.from({ length: 18 }, (_, index) => {
          const scale = .24 + index / 23;
          return <div key={index} style={{ position: "absolute", left: "50%", top: "50%", width: `${scale * 100}%`, height: `${scale * 100}%`, border: `2px solid ${index % 3 === 0 ? COLORS.gold : COLORS.cyan}`, borderRadius: `${48 - index * .8}% ${52 + index * .4}%`, opacity: .15 + index / 31, transform: `translate(-50%,-50%) rotate(${index * 13}deg) translateZ(${Math.sin(index * .8 + frame / 18) * 58}px)`, boxShadow: index % 4 === 0 ? `0 0 22px ${COLORS.cyan}55` : "none" }} />;
        })}
      </div>
      {Array.from({ length: 34 }, (_, index) => {
        const angle = index / 34 * Math.PI * 2 + frame / 65;
        const radius = 270 + Math.sin(index * 1.7 + frame / 25) * 80;
        const style: CSSProperties = { position: "absolute", left: 640 + Math.cos(angle) * radius, top: 370 + Math.sin(angle) * radius * .55, width: 5 + index % 4, height: 5 + index % 4, borderRadius: "50%", background: index % 4 === 0 ? COLORS.coral : COLORS.ink, opacity: .26 + (index % 5) * .12, boxShadow: `0 0 16px ${COLORS.cyan}` };
        return <i key={index} style={style}/>;
      })}
    </Scene>
  );
}

function Reel() {
  return (
    <AbsoluteFill style={{ background: COLORS.dark }}>
      <Sequence from={0} durationInFrames={132}><IntegralVolume /></Sequence>
      <Sequence from={108} durationInFrames={132}><DerivativeTangent /></Sequence>
      <Sequence from={228} durationInFrames={132}><Harmonics /></Sequence>
      <Sequence from={348} durationInFrames={132}><LinearTransform /></Sequence>
      <Sequence from={468} durationInFrames={132}><NeuralNetwork /></Sequence>
      <Sequence from={588} durationInFrames={132}><OrbitingSurface /></Sequence>
      <AbsoluteFill style={{ pointerEvents: "none", background: "linear-gradient(90deg, rgba(5,7,8,.42), transparent 45%, rgba(5,7,8,.16))" }} />
    </AbsoluteFill>
  );
}

function MarketingReelRoot() {
  return <Composition id="MarketingMathReel" component={Reel} durationInFrames={720} fps={FPS} width={1280} height={720} />;
}

registerRoot(MarketingReelRoot);
