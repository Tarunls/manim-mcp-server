import React from "react";
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
import {LayoutAudit, LayoutItem, ManimSequence} from "../../../remotion/layout";
import clipMetadata from "./composite-metadata.json";

const FPS = 30;
const BEAT = 315;
const DURATION = 1290;

const palette = {
  ink: "#07111f",
  panel: "rgba(12, 29, 46, 0.78)",
  line: "rgba(138, 180, 202, 0.19)",
  text: "#f7f4ed",
  muted: "#a9bdca",
  cyan: "#67e8f9",
  coral: "#fb7185",
  gold: "#fbbf24",
};

const clipFrames = (id: string) => {
  const clip = (clipMetadata as {clips: Array<{source: string; frames: number}>}).clips.find(
    (entry) => entry.source.endsWith(`/${id}.py`),
  );
  if (!clip) throw new Error(`Missing composite metadata for ${id}`);
  return clip.frames;
};

const enterStyle = (frame: number, delay = 0): React.CSSProperties => {
  const local = Math.max(0, frame - delay);
  const progress = spring({frame: local, fps: FPS, config: {damping: 18, stiffness: 105, mass: 0.9}});
  return {
    opacity: 1,
    transform: `translateY(${interpolate(progress, [0, 1], [24, 0])}px)`,
  };
};

const Kicker: React.FC<{chapter: string; color: string}> = ({chapter, color}) => (
  <div style={{display: "flex", alignItems: "center", gap: 14, marginBottom: 22}}>
    <span style={{width: 36, height: 3, borderRadius: 9, background: color}} />
    <span style={{fontSize: 20, fontWeight: 750, letterSpacing: 3.6, color}}>{chapter}</span>
  </div>
);

const TitleBlock: React.FC<{
  id: string;
  chapter: string;
  color: string;
  title: React.ReactNode;
  frame: number;
}> = ({id, chapter, color, title, frame}) => (
  <LayoutItem
    layoutId={id}
    group="chapter"
    style={{left: 110, top: 86, width: 680, height: 254}}
  >
    <div style={{...enterStyle(frame), width: "100%", height: "100%"}}>
      <Kicker chapter={chapter} color={color} />
      <div
        style={{
          color: palette.text,
          fontSize: 70,
          lineHeight: 1.01,
          letterSpacing: -3.2,
          fontWeight: 730,
          textWrap: "balance",
        }}
      >
        {title}
      </div>
    </div>
  </LayoutItem>
);

const ExplanationCard: React.FC<{
  id: string;
  frame: number;
  children: React.ReactNode;
  formula: string;
  accent: string;
}> = ({id, frame, children, formula, accent}) => (
  <LayoutItem
    layoutId={id}
    group="chapter"
    style={{left: 110, top: 396, width: 680, height: 290}}
  >
    <div
      style={{
        ...enterStyle(frame, 8),
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${palette.line}`,
        borderRadius: 28,
        padding: "34px 38px",
        background: palette.panel,
        boxShadow: "0 26px 80px rgba(0, 0, 0, 0.24)",
      }}
    >
      <div style={{fontSize: 28, lineHeight: 1.42, color: palette.muted, maxWidth: 586}}>{children}</div>
      <div
        style={{
          display: "inline-flex",
          marginTop: 25,
          padding: "11px 18px",
          borderRadius: 999,
          fontFamily: "Georgia, serif",
          fontSize: 25,
          letterSpacing: 0.3,
          color: palette.text,
          background: `${accent}1c`,
          border: `1px solid ${accent}66`,
        }}
      >
        {formula}
      </div>
    </div>
  </LayoutItem>
);

const VisualFrame: React.FC<{
  id: string;
  frame: number;
  children: React.ReactNode;
  accent: string;
}> = ({id, frame, children, accent}) => (
  <LayoutItem
    layoutId={id}
    group="chapter"
    style={{left: 900, top: 120, width: 850, height: 820}}
  >
    <div
      style={{
        ...enterStyle(frame, 4),
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: 38,
        border: `1px solid ${accent}55`,
        background: "linear-gradient(145deg, rgba(17,39,58,.88), rgba(7,17,31,.52))",
        boxShadow: `0 30px 100px rgba(0,0,0,.33), inset 0 1px 0 ${accent}24`,
      }}
    >
      {children}
    </div>
  </LayoutItem>
);

const InsertLabel: React.FC<{children: React.ReactNode; color: string}> = ({children, color}) => (
  <div
    style={{
      position: "absolute",
      left: 34,
      top: 32,
      zIndex: 2,
      color,
      fontSize: 18,
      fontWeight: 750,
      letterSpacing: 2.8,
    }}
  >
    {children}
  </div>
);

const BeatOne: React.FC<{frame: number}> = ({frame}) => {
  return (
    <>
      <TitleBlock id="b1-title" chapter="01 · TIME DOMAIN" color={palette.cyan} frame={frame} title={<>A waveform is a crowd in disguise.</>} />
      <ExplanationCard id="b1-card" frame={frame} accent={palette.cyan} formula="signal = many simple waves">
        What looks like one shape can be a precise mixture of slow swells, quick ripples, and everything between.
      </ExplanationCard>
      <VisualFrame id="b1-wave" frame={frame} accent={palette.cyan}>
        <InsertLabel color={palette.cyan}>AMPLITUDE OVER TIME</InsertLabel>
        <div style={{position: "absolute", inset: "75px 12px 16px"}}>
          <Sequence from={0} durationInFrames={BEAT} layout="none">
            <ManimSequence clipId="wave" frameCount={clipFrames("wave")} />
          </Sequence>
        </div>
      </VisualFrame>
    </>
  );
};

const BeatTwo: React.FC<{frame: number}> = ({frame}) => {
  return (
    <>
      <TitleBlock id="b2-title" chapter="02 · HIDDEN MOTION" color={palette.coral} frame={frame} title={<>Frequencies are rotations.</>} />
      <ExplanationCard id="b2-card" frame={frame} accent={palette.coral} formula="rotation → oscillation">
        A steady turn around a circle casts a smooth up-and-down shadow. Add several turns, and their shadows become a complex signal.
      </ExplanationCard>
      <VisualFrame id="b2-phasors" frame={frame} accent={palette.coral}>
        <InsertLabel color={palette.coral}>ROTATING COMPONENTS</InsertLabel>
        <div style={{position: "absolute", inset: "64px 4px 8px"}}>
          <Sequence from={BEAT} durationInFrames={BEAT} layout="none">
            <ManimSequence clipId="phasors" frameCount={clipFrames("phasors")} />
          </Sequence>
        </div>
      </VisualFrame>
    </>
  );
};

const spectrumValues = [0.10, 0.18, 0.94, 0.13, 0.29, 0.67, 0.16, 0.11, 0.44, 0.12, 0.23, 0.77, 0.15, 0.09];

const Spectrum: React.FC<{frame: number}> = ({frame}) => {
  const scan = interpolate(frame, [20, 190], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic)});
  return (
    <div style={{position: "absolute", inset: "92px 44px 44px"}}>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 108, height: 1, background: "rgba(169,189,202,.35)"}} />
      <div style={{position: "absolute", left: 4, top: 12, color: palette.muted, fontSize: 18, letterSpacing: 2}}>STRENGTH</div>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 109, height: 535, display: "flex", alignItems: "flex-end", gap: 15}}>
        {spectrumValues.map((value, index) => {
          const rise = interpolate(frame, [22 + index * 3, 62 + index * 3], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic)});
          const strong = value > 0.6;
          const color = strong ? (index === 2 ? palette.cyan : index === 5 ? palette.coral : palette.gold) : "#54748a";
          return (
            <div key={index} style={{height: "100%", flex: 1, display: "flex", alignItems: "flex-end"}}>
              <div
                style={{
                  width: "100%",
                  height: `${value * 100}%`,
                  transform: `scaleY(${rise})`,
                  transformOrigin: "bottom",
                  borderRadius: "12px 12px 3px 3px",
                  background: `linear-gradient(to top, ${color}88, ${color})`,
                  boxShadow: strong ? `0 0 34px ${color}55` : "none",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{position: "absolute", left: `${scan * 96}%`, top: 38, bottom: 108, width: 2, background: `linear-gradient(${palette.cyan}00, ${palette.cyan}, ${palette.cyan}00)`, boxShadow: `0 0 22px ${palette.cyan}`}} />
      <div style={{position: "absolute", left: 0, bottom: 55, fontSize: 18, color: palette.muted}}>low frequency</div>
      <div style={{position: "absolute", right: 0, bottom: 55, fontSize: 18, color: palette.muted}}>high frequency</div>
      <div style={{position: "absolute", left: "14.2%", bottom: 18, color: palette.cyan, fontSize: 19, fontWeight: 700}}>110 Hz</div>
      <div style={{position: "absolute", left: "38%", bottom: 18, color: palette.coral, fontSize: 19, fontWeight: 700}}>330 Hz</div>
      <div style={{position: "absolute", left: "77%", bottom: 18, color: palette.gold, fontSize: 19, fontWeight: 700}}>880 Hz</div>
    </div>
  );
};

const BeatThree: React.FC<{frame: number}> = ({frame}) => {
  return (
    <>
      <TitleBlock id="b3-title" chapter="03 · FREQUENCY DOMAIN" color={palette.gold} frame={frame} title={<>The transform makes a map.</>} />
      <ExplanationCard id="b3-card" frame={frame} accent={palette.gold} formula="F(f) = how much of frequency f">
        Instead of tracking the signal through time, we ask one focused question at every frequency: how much of this rotation is present?
      </ExplanationCard>
      <VisualFrame id="b3-spectrum" frame={frame} accent={palette.gold}>
        <InsertLabel color={palette.gold}>THE FREQUENCY SPECTRUM</InsertLabel>
        <Spectrum frame={frame} />
      </VisualFrame>
    </>
  );
};

const wavePath = (frame: number) => {
  const width = 760;
  const center = 310;
  const amp = 122;
  const additions = [
    interpolate(frame, [24, 70], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
    interpolate(frame, [82, 132], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
    interpolate(frame, [146, 202], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
  ];
  const points = Array.from({length: 181}, (_, index) => {
    const x = (index / 180) * width + 30;
    const t = (index / 180) * Math.PI * 4;
    const y = center - amp * (
      0.78 * Math.sin(t) +
      additions[0] * 0.31 * Math.sin(3 * t + 0.5) +
      additions[1] * 0.19 * Math.sin(5 * t - 0.7) +
      additions[2] * 0.12 * Math.sin(8 * t + 0.2)
    );
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return points.join(" ");
};

const Reconstruction: React.FC<{frame: number}> = ({frame}) => {
  const count = frame < 70 ? 1 : frame < 132 ? 2 : frame < 202 ? 3 : 4;
  return (
    <div style={{position: "absolute", inset: "94px 30px 34px"}}>
      <div style={{position: "absolute", left: 0, right: 0, top: 48, bottom: 98, opacity: 0.36, backgroundImage: "linear-gradient(rgba(108,145,164,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(108,145,164,.15) 1px, transparent 1px)", backgroundSize: "80px 80px"}} />
      <svg width="100%" height="590" viewBox="0 0 820 590" style={{position: "absolute", left: 0, top: 18, overflow: "visible"}}>
        <defs>
          <linearGradient id="wave-gradient" x1="0" x2="1">
            <stop offset="0" stopColor={palette.cyan} />
            <stop offset="0.52" stopColor={palette.coral} />
            <stop offset="1" stopColor={palette.gold} />
          </linearGradient>
          <filter id="wave-glow" x="-30%" y="-50%" width="160%" height="200%">
            <feGaussianBlur stdDeviation="7" result="blur" />
          </filter>
        </defs>
        <path d={wavePath(frame)} fill="none" stroke="url(#wave-gradient)" strokeWidth="17" opacity=".16" filter="url(#wave-glow)" />
        <path d={wavePath(frame)} fill="none" stroke="url(#wave-gradient)" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <div style={{position: "absolute", top: 0, right: 10, padding: "10px 16px", borderRadius: 999, color: palette.text, background: "rgba(7,17,31,.72)", border: `1px solid ${palette.line}`, fontSize: 19}}>
        <span style={{color: palette.gold, fontWeight: 800}}>{count}</span> {count === 1 ? "frequency" : "frequencies"}
      </div>
      <div style={{position: "absolute", left: 2, right: 2, bottom: 4, display: "flex", gap: 14}}>
        {["fundamental", "+ shape", "+ texture", "+ detail"].map((label, index) => (
          <div key={label} style={{flex: 1, padding: "15px 12px", borderRadius: 14, textAlign: "center", fontSize: 18, color: index < count ? palette.text : "#688295", background: index < count ? "rgba(103,232,249,.10)" : "rgba(255,255,255,.025)", border: `1px solid ${index < count ? "rgba(103,232,249,.35)" : "rgba(138,180,202,.10)"}`}}>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
};

const BeatFour: React.FC<{frame: number}> = ({frame}) => {
  return (
    <>
      <TitleBlock id="b4-title" chapter="04 · INVERSE TRANSFORM" color={palette.cyan} frame={frame} title={<>Add the peaks. Recover the wave.</>} />
      <ExplanationCard id="b4-card" frame={frame} accent={palette.cyan} formula="spectrum ⇄ signal">
        The spectrum is not just a description. It is a recipe: restore each frequency with its measured strength, and the original motion returns.
      </ExplanationCard>
      <VisualFrame id="b4-rebuild" frame={frame} accent={palette.cyan}>
        <InsertLabel color={palette.cyan}>SYNTHESIS</InsertLabel>
        <Reconstruction frame={frame} />
      </VisualFrame>
    </>
  );
};

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: palette.ink,
      backgroundImage: "radial-gradient(circle at 76% 18%, rgba(20,116,139,.22), transparent 30%), radial-gradient(circle at 18% 86%, rgba(190,24,93,.10), transparent 33%), linear-gradient(145deg, #081522, #050b14 70%)",
      color: palette.text,
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
    }}
  >
    <div style={{position: "absolute", left: 62, top: 62, width: 16, height: 16, borderLeft: `2px solid ${palette.line}`, borderTop: `2px solid ${palette.line}`}} />
    <div style={{position: "absolute", right: 62, bottom: 62, width: 16, height: 16, borderRight: `2px solid ${palette.line}`, borderBottom: `2px solid ${palette.line}`}} />
  </AbsoluteFill>
);

const MountedLayoutAudit: React.FC = () => {
  return <LayoutAudit minGap={56} safePadding={48} />;
};

const GeneratedVideo: React.FC = () => {
  const frame = useCurrentFrame();
  useVideoConfig();
  const chapter = Math.min(3, Math.floor(frame / BEAT));
  const localFrame = frame - chapter * BEAT;
  return (
    <AbsoluteFill style={{fontFamily: "Inter, Arial, Helvetica, sans-serif", color: palette.text}}>
      <Background />
      {chapter === 0 ? <BeatOne frame={localFrame} /> : null}
      {chapter === 1 ? <BeatTwo frame={localFrame} /> : null}
      {chapter === 2 ? <BeatThree frame={localFrame} /> : null}
      {chapter === 3 ? <BeatFour frame={localFrame} /> : null}
      <MountedLayoutAudit />
    </AbsoluteFill>
  );
};

const RemotionRoot: React.FC = () => (
  <Composition
    id="GeneratedVideo"
    component={GeneratedVideo}
    width={1920}
    height={1080}
    fps={FPS}
    durationInFrames={DURATION}
  />
);

registerRoot(RemotionRoot);
