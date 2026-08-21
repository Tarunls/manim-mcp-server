import React, { useLayoutEffect } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";

type LayoutItemProps = React.HTMLAttributes<HTMLDivElement> & {
  layoutId: string;
  group?: string;
  allowOverlapWith?: string[];
};

export function LayoutItem({ layoutId, group = "canvas", allowOverlapWith = [], style, ...props }: LayoutItemProps) {
  return (
    <div
      {...props}
      data-layout-item={layoutId}
      data-layout-group={group}
      data-allow-overlap-with={allowOverlapWith.join(",")}
      style={{ position: "absolute", ...style }}
    />
  );
}

function allowed(first: HTMLElement, second: HTMLElement) {
  const firstAllowed = new Set((first.dataset.allowOverlapWith || "").split(",").filter(Boolean));
  const secondAllowed = new Set((second.dataset.allowOverlapWith || "").split(",").filter(Boolean));
  return firstAllowed.has(second.dataset.layoutItem || "") || secondAllowed.has(first.dataset.layoutItem || "");
}

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01 && bounds.width > 0 && bounds.height > 0;
}

export function LayoutAudit({ minGap = 36, safePadding = 28 }: { minGap?: number; safePadding?: number }) {
  const frame = useCurrentFrame();

  useLayoutEffect(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("[data-layout-item]")].filter(visible);
    const collisions: string[] = [];
    for (const element of elements) {
      const bounds = element.getBoundingClientRect();
      if (bounds.left < safePadding || bounds.top < safePadding || bounds.right > window.innerWidth - safePadding || bounds.bottom > window.innerHeight - safePadding) {
        collisions.push(`${element.dataset.layoutItem} leaves the ${safePadding}px safe frame (${Math.round(bounds.left)}, ${Math.round(bounds.top)}, ${Math.round(bounds.right)}, ${Math.round(bounds.bottom)})`);
      }
    }
    for (let firstIndex = 0; firstIndex < elements.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < elements.length; secondIndex += 1) {
        const first = elements[firstIndex];
        const second = elements[secondIndex];
        if (first.dataset.layoutGroup !== second.dataset.layoutGroup) continue;
        if (first.contains(second) || second.contains(first) || allowed(first, second)) continue;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        const separated = a.right + minGap <= b.left
          || b.right + minGap <= a.left
          || a.bottom + minGap <= b.top
          || b.bottom + minGap <= a.top;
        if (!separated) {
          const horizontalGap = Math.max(b.left - a.right, a.left - b.right);
          const verticalGap = Math.max(b.top - a.bottom, a.top - b.bottom);
          collisions.push(`${first.dataset.layoutItem} / ${second.dataset.layoutItem} (gaps x=${Math.round(horizontalGap)}px, y=${Math.round(verticalGap)}px)`);
        }
      }
    }
    if (collisions.length) {
      throw new Error(`Layout audit failed at frame ${frame} (minimum gap ${minGap}px): ${collisions.join(", ")}`);
    }
  }, [frame, minGap, safePadding]);

  return null;
}

export function ManimSequence({ clipId, frameCount, style }: { clipId: string; frameCount: number; style?: React.CSSProperties }) {
  const frame = Math.max(0, Math.min(useCurrentFrame(), Math.max(0, frameCount - 1)));
  return <Img src={staticFile(`manim/${clipId}/${String(frame).padStart(6, "0")}.png`)} style={{ width: "100%", height: "100%", objectFit: "contain", ...style }} />;
}
