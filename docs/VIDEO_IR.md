# Video IR authoring

`project.json` follows `VideoProjectIR` in `shared/video-ir.ts`. Use the TypeScript definition as the authoritative schema and `npm run validate:project -- <project-dir>` as the gate.

## Coordinate system

Clip transforms use canvas pixels. `(0, 0)` is canvas center. Positive `x` moves right and positive `y` moves down. `width` and `height` describe the unscaled box. `scale`, `rotation`, and `opacity` are independently animatable.

Time values are seconds. Shot `start` is project time. Clip `start` is relative to its shot. Clip timing may not extend past the owning shot.

## Minimal shot

```json
{
  "id": "title-shot",
  "name": "Opening title",
  "intent": "Large editorial title with one supporting line",
  "start": 0,
  "duration": 5,
  "renderer": "remotion",
  "status": "ready",
  "tracks": [
    {
      "id": "titles",
      "name": "Titles",
      "kind": "overlay",
      "muted": false,
      "locked": false,
      "clips": []
    }
  ]
}
```

## Renderer metadata

Manim:

```json
{
  "renderer": "manim",
  "metadata": {
    "sceneFile": "scenes/derivative.py",
    "sceneClass": "DerivativeScene"
  }
}
```

The source must stay within the project. Import `manim_layout` guards and assert important groups are safe.

Generated footage:

```json
{
  "renderer": "generated",
  "metadata": {
    "generationPrompt": "Wide locked-off shot of ...",
    "provider": "runway",
    "model": "gen4.5",
    "referenceImageUrl": "https://..."
  }
}
```

Provider/model/reference are optional. Use a concrete prompt containing shot size, subject, action, setting, camera behavior, light, and continuity constraints. Do not ask generated footage to render explanatory text or factual diagrams.

Blender:

```json
{
  "renderer": "blender",
  "metadata": {
    "blenderScene": {
      "camera": { "location": [0, -8, 4], "target": [0, 0, 0], "lens": 55 },
      "lights": [
        { "type": "AREA", "location": [4, -4, 6], "target": [0, 0, 0], "energy": 1200, "size": 5 }
      ],
      "objects": [
        {
          "name": "Product",
          "primitive": "cylinder",
          "location": [0, 0, 0],
          "scale": [1, 1, 1.8],
          "color": [0.8, 0.3, 0.1, 1],
          "keyframes": [
            { "frame": 1, "rotation": [0, 0, 0] },
            { "frame": 180, "rotation": [0, 0, 360] }
          ]
        }
      ]
    }
  }
}
```

Supported primitives are cube, sphere, cylinder, plane, and text. The worker accepts transforms, RGBA material color, lights, camera, and object keyframes. It does not execute arbitrary project Python.

## Assets

An asset must record provider, creator when known, source URL, local path after import, license terms, attribution requirement/line, SHA-256, media metadata, tags, and provenance. Clips reference the asset by `assetId`; never place a raw web URL in a clip.

## Narration

Write the planned script to `narration.json`, synthesize with `generate_narration.mjs --prepare`, then copy measured `start`, `end`, and word timing into the IR. Shots should be extended to real speech duration plus breathing room. Narration is the timing master, not an afterthought added to a finished animation.

## Safe layout

Keep text, captions, charts, and diagrams inside `design.safeArea`. A full-bleed image/shape may reach the frame edge. Text should generally be at least 32px on the final canvas and meet 4.5:1 contrast. Use explicit widths/heights, consistent panel padding, and deliberate line breaks instead of relying on renderer auto-layout.
