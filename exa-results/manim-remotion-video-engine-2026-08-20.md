# Manim vs. Remotion: Why Manim Looks Precise, Why It Looks Like Slides, and What to Build Next

Date: 2026-08-20

## Executive conclusion

Manim does not look better because Cairo is inherently more accurate than Chrome, and Remotion does not look worse because React is incapable of exact layout. Remotion's renderer explicitly seeks to a requested frame, waits for asynchronous render handles, waits for `document.fonts.ready`, and then captures that browser frame. Its pixels are generally faithful to the DOM it was given. The problem is that the DOM is allowed to be a bad video composition.

Manim's advantage is earlier in the pipeline: it gives the author a small, geometric language in which every visible thing is an object with concrete points, bounds, and a common coordinate system. Text becomes vector geometry before it is positioned. `next_to()`, `align_to()`, `arrange()`, and `VGroup` operate on measured object boundaries. There are fewer coordinate systems, fewer layout side effects, and fewer valid-but-visually-wrong states. See Manim's [`Mobject` geometry and placement implementation](https://github.com/ManimCommunity/manim/blob/main/manim/mobject/mobject.py), [`Text` implementation](https://github.com/ManimCommunity/manim/blob/main/manim/mobject/text/text_mobject.py), and [official internals guide](https://docs.manim.community/en/latest/guides/deep_dive.html).

That same narrow language causes the sameness. Manim's natural unit of authorship is a persistent scene graph plus serial calls to `play()`. The easiest generated video is therefore: establish a title, create a diagram, fade in a panel, indicate an object, wait for narration, repeat. It is precise because it is constrained; it feels like slides because it has almost no editorial, cinematic, typographic, or shot-design layer above those constraints.

The right product is not “Manim plus Remotion.” It is a **video compiler with one renderer-independent intermediate representation, one layout authority, one motion model, and multiple temporary backends only during migration**. Long term, the cleanest 2D engine is a native scene graph rendered with Skia, with HarfBuzz/ICU-grade text shaping, a constraint solver, deterministic frame evaluation, and a studio that edits the same structured representation. Manim can be a short-term compiler target and specialist geometry/formula adapter. Remotion can be a temporary preview or legacy importer. Neither should remain the language the model writes directly.

## What was examined

I used Exa to review 121 search results across three research workstreams—Manim internals, Remotion internals, and lower-level text/layout architecture—then validated the important claims against the current upstream repositories and official documentation. The local project was audited separately, including its generator prompt, layout guards, render helper, example scenes, archived hybrid timeline, metadata, and contact sheets.

The upstream snapshots inspected were:

- Manim commit `443f32c` from 2026-08-15.
- Remotion commit `28df56b` from 2026-08-20.

The analysis below distinguishes source-confirmed behavior from architectural recommendations.

## The core distinction: authoring precision versus render precision

| Layer | Manim | Remotion | Consequence for generated video |
|---|---|---|---|
| Authoring primitive | Geometry-bearing `Mobject` | Arbitrary React/DOM/CSS | Manim exposes fewer ways to make a locally valid but globally bad layout. |
| Coordinate model | One fixed scene coordinate space | Nested CSS boxes, containing blocks, transforms, flex/grid, percentages, viewport units | Remotion makes composition sensitive to ancestry and box-model interactions. |
| Text before placement | Pango shapes text and Manim imports it as SVG/vector paths | Browser shapes text during layout; optional utilities measure DOM boxes | Manim placement naturally consumes already-materialized geometry. In Remotion, measurement is opt-in. |
| Relative placement | `next_to`, `align_to`, `arrange`, group transforms | CSS flow or manually authored absolute positions | The Manim happy path is relational; generated Remotion often becomes coordinate soup. |
| Animation | Object/state interpolation sampled by scene time | Any browser behavior is possible; correct Remotion uses frame-derived values | Remotion is more expressive but permits CSS transitions, state, time, randomness, and effects that are inappropriate for parallel frame rendering. |
| Validation | Bounds are immediately inspectable on objects | Core renderer mainly validates that a frame can be produced | Neither provides full composition QA, but Manim makes basic geometric QA easier to add. |
| Styling surface | Vector shapes, strokes, fills, text, plots, camera | Full web platform, filters, gradients, media, SVG, canvas, WebGL, component ecosystem | Remotion produces more visual dialects and “UI glitter” with less custom infrastructure. |

This is why the comparison can feel paradoxical: **Manim has stronger spatial semantics but a weaker design vocabulary; Remotion has a stronger visual vocabulary but a weaker default composition contract.**

## Where Manim's precision comes from

### 1. Visible objects are concrete geometry

A Manim `Mobject` owns point arrays and child objects. Its width and height are calculated from point extrema. `get_critical_point()` treats the object as a measured bounding box, and `next_to()` places one object's critical point against another's with an explicit buffer. `arrange()` applies that relationship successively across children. These mechanics are visible in the current [`mobject.py`](https://github.com/ManimCommunity/manim/blob/main/manim/mobject/mobject.py).

The crucial product property is not the exact algorithm; it is that **measurement, placement, and animation all speak about the same object**. A label beside a circle is not a DOM node positioned inside a transformed parent whose layout box differs from its painted bounds. It is geometry positioned against geometry.

### 2. Text is resolved into stable vector outlines

Manim's `Text` uses Pango to shape content, writes SVG, imports that SVG as a vector object, and then derives its normal object bounds from the resulting paths. The implementation and documented behavior are in [`text_mobject.py`](https://github.com/ManimCommunity/manim/blob/main/manim/mobject/text/text_mobject.py) and the [official text reference](https://docs.manim.community/en/latest/reference/manim.mobject.text.text_mobject.html).

Pango's own [rendering-pipeline documentation](https://docs.gtk.org/Pango/pango_rendering.html) separates itemization, shaping, line breaking, justification, and rendering. At the shaping layer, HarfBuzz turns Unicode code points into ordered, positioned glyphs with advances and offsets; those outputs are exactly the kind of stable metrics a deterministic layout engine needs. See the [HarfBuzz shaping overview](https://harfbuzz.github.io/getting-started.html).

This gives Manim a practical advantage for generated compositions: once a text object exists, the generator can ask for its real width, scale it, group it, and place it. There is no later browser reflow that silently changes the result.

### 3. Groups preserve spatial relationships

`VGroup` makes a title, equation, caption, and panel content into one transformable unit. Moving or scaling the group preserves internal relations. This is especially powerful for generated code because the model can reason in a small hierarchy: frame → region → group → element.

The local `stack_in_panel()` helper uses exactly this property: arrange rows, fit the group into a panel, then validate the resulting group. That is why the panels in the local Manim contact sheets remain internally coherent even when they are visually conservative.

### 4. Animation is evaluated as explicit object state

Manim's scene loop computes an exact normalized time for each rendered frame, updates animations, and renders the resulting object state. `Transform` aligns the source and target object structures and interpolates their geometry. See [`scene.py`](https://github.com/ManimCommunity/manim/blob/main/manim/scene/scene.py) and [`transform.py`](https://github.com/ManimCommunity/manim/blob/main/manim/animation/transform.py).

That creates excellent continuity for diagrams: a square can literally become a term in an equation, and the same object identity can remain legible through the move. This is more semantically useful than animating independent CSS properties on unrelated nodes.

### 5. The language has a deliberately small error surface

Manim has no margin collapse, flex shrink, browser default heading margins, responsive line wrapping, nested containing-block surprises, CSS specificity, layout-versus-paint transform split, or asynchronous image intrinsic sizing unless the author builds equivalents manually. Less capability creates less accidental complexity.

That is the deepest answer to “where does the precision come from?”: **Manim makes the set of representable layouts smaller and makes object geometry first-class.**

## Why Remotion's output can be spatially worse even when its render is correct

### 1. Remotion is a frame scheduler and browser capture system, not a composition solver

`AbsoluteFill` is an absolutely positioned full-size `div` with flex defaults; it does not decide hierarchy, safe areas, line lengths, collision avoidance, or optical balance. Its source is straightforward: [`AbsoluteFillElement.tsx`](https://github.com/remotion-dev/remotion/blob/main/packages/core/src/AbsoluteFillElement.tsx). `Sequence` manages temporal scope, and `useCurrentFrame()` converts the global frame into sequence-relative time. Neither provides editorial layout.

The renderer then does its job correctly: it seeks the page to the requested frame, waits for render readiness, waits for `document.fonts.ready`, captures the frame, and collects media assets. See [`seek-to-frame.ts`](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/src/seek-to-frame.ts) and [`render-frame-with-option-to-reject.ts`](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/src/render-frame-with-option-to-reject.ts).

So “off position” usually means the authored DOM was off position, not that Remotion captured it inaccurately.

### 2. CSS gives a generator too many degrees of freedom

Generated Remotion commonly mixes:

- fixed pixels and percentages;
- flex/grid layout and absolute overlays;
- transforms that affect painting but not sibling flow;
- auto-sized text and manually sized cards;
- nested `AbsoluteFill` and `Sequence` wrappers;
- font-relative, viewport-relative, and composition-relative sizes;
- springs or interpolation that move elements outside the state for which layout was checked.

Each choice is legal. The browser has no concept of “this caption belongs under that equation term,” “this is the declared visual focus,” or “this label may not occlude the curve between frames 37 and 52.” It can only execute CSS.

### 3. Measurement exists, but it is optional and incomplete as a system

Remotion provides `measureText()`, `fitText()`, `fitTextOnNLines()`, and `fillTextBox()`. The current `measureText()` creates a hidden span and reads `getBoundingClientRect()`; it can also detect probable font fallback. See [`measure-text.ts`](https://github.com/remotion-dev/remotion/blob/main/packages/layout-utils/src/layouts/measure-text.ts) and the [official measurement guidance](https://www.remotion.dev/docs/layout-utils/measure-text).

That is useful, but it is a library call, not a mandatory layout pass. A model can ignore it. The current `fitTextOnNLines()` solves line count and width using binary search, but does not solve a whole scene, balance multiple regions, preserve a minimum hierarchy ratio, or reason about vertical box height. It is a text utility, not a layout engine.

### 4. Browser freedom includes nondeterministic or frame-hostile animation styles

Remotion expects animation values to be functions of the frame. It explicitly warns against CSS animations because they depend on playback rather than the requested render frame; see [Remotion's CSS-animation warning](https://www.remotion.dev/docs/troubleshooting/css-animations). Randomness must also be seeded to remain deterministic; see [Remotion's randomness guidance](https://www.remotion.dev/docs/using-randomness).

Even correct `interpolate()` usage can go out of range because interpolation is not clamped by default. Springs can overshoot. CSS transforms can paint outside the measured layout box. A generated scene therefore needs temporal geometry validation, not just a screenshot at the start and end.

### 5. Web design instincts are not video direction

The Remotion repository's own current generation guidance literally begins, “You are designing a video, not a webpage,” then specifies safe areas and large minimum type. See the [official video-layout guidance](https://github.com/remotion-dev/remotion/blob/main/packages/skills/skills/remotion-create/video-layout.md). That advice exists because the raw web platform does not encode those rules.

## Why Manim output feels like a slideshow

### 1. `Scene.play()` encourages serial reveal grammar

The lowest-effort generated structure is a list of `play()` calls: `Create`, `Write`, `FadeIn`, `Indicate`, `FadeOut`, and `wait`. These are semantically clean and visually safe, so a model repeats them. Manim has no default concept of a shot, edit, camera plan, rhythmic motif, motion lane, foreground/background performance, or transition family.

### 2. Generated scenes preserve one composition for too long

The local evidence is strong:

- `a0abedfa` is 30.2 seconds and contains 12.3 seconds of explicit `wait()` calls: about **41% explicitly frozen** before counting low-motion holds inside animations.
- `5d7564d9` is 52.1 seconds and contains 34.7 seconds of explicit `wait()` calls: about **67% explicitly frozen**.
- The six-frame contact sheets show large runs of the same title/diagram/two-column-panel composition with only highlighting or panel-copy changes.

The result is not just “Manim style.” It is a timing and directing policy that treats narration as something to hold a slide under.

### 3. The current prompt actively biases toward panels and restraint

The local agent instructions repeatedly require information panels, vertically arranged `VGroup`s, no more than two type sizes per panel, a restrained palette, and deterministic primitives. Those are sensible safety rails, but together they form a style prescription. The model is not being asked to choose among editorial, kinetic-type, cinematic-diagram, collage, data-story, or product-demo visual languages. It is being asked to make a safe technical presentation.

### 4. The narration contract contradicts the duration contract

The prompt asks for an 8–15 second first draft and also requires 3–5 passages of 18–45 words at roughly 145 words per minute plus 0.8 seconds of breathing room per slot. The minimum possible narration is 54 words:

`54 / 145 × 60 + 3 × 0.8 ≈ 24.7 seconds`

The system cannot obey both. It resolves the conflict by stretching static holds, which directly creates the slideshow feel.

### 5. Object-level motion is not the same as video-level pacing

Manim is strong at explaining relationships *within* a composition. Great video also needs changes *between* compositions: reframing, inserts, close-ups, negative-space changes, typographic beats, cutaways, matched cuts, texture, sound-led transitions, and deliberate edit cadence. None of that is represented in the current `scene.py` contract.

## Manim's real weak points

Manim is precise, but not a complete layout or video-design system.

1. **No global constraint solver.** `arrange()` is a greedy sequence of `next_to()` calls. It does not optimize a whole frame against required and preferred constraints.
2. **No semantic layout.** Manim knows bounds, not that an object is a headline, evidence, annotation, focus, or background.
3. **No optical typography model.** Glyph-path bounds are not cap-height, baseline, line-box, hanging punctuation, or perceived-center metrics. Tight vector bounds can be mathematically exact and optically wrong.
4. **Weak paragraph composition.** Long copy, line breaking, widows/orphans, balanced rag, responsive reflow, and multi-script editorial typography require more than `Text`/`Paragraph` and manual groups.
5. **No collision detection over time.** Bounds can be valid before an animation and invalid during its path or spring-like overshoot.
6. **No shot/edit abstraction.** It has scenes and animations, not a director-level grammar.
7. **Limited material/effect vocabulary.** Modern compositing, blur, blend modes, masks, image treatment, shader effects, live media, and complex typography take more work than in a browser or compositing engine.
8. **Difficult direct manipulation.** Python code is a poor canonical format for a visual timeline editor. Arbitrary code cannot reliably round-trip through an inspector.
9. **Generated-code fragility.** The model must remember Python APIs, signatures, object lifetimes, and scene state. A structurally valid scene can still fail late.
10. **Platform/font reproducibility is not complete by default.** Font family resolution depends on installed fonts unless assets and versions are pinned.

## Weak points in the current local system

These are separate from upstream Manim:

### Validation is mostly string matching

`render_scene.py` checks that certain strings occur in the source. It does not parse the AST, verify helper signatures, prove every panel is checked, or execute a layout-only preflight. One failed local Fourier scene contains invalid helper calls such as `fit_inside(panel, margin=0.32)` and `assert_inside(panel, margin=0.32)`; the current textual checks are incapable of diagnosing that before render. The same scene also failed on an unsupported `opacity` argument.

### Bounds checks cover a few static states

`assert_scene_safe()` and `assert_inside()` check axis-aligned extrema of the objects passed at the moment the call runs. They do not include a semantic focus zone, optical alignment, stroke/shadow bleed, label-to-feature association, motion paths, visibility, or overlap among siblings.

### QA samples by clock, not by meaning

The contact sheet samples six uniformly spaced frames. It can miss a 300 ms collision, a bad transition midpoint, the first fully readable frame of a title, or a spring overshoot. The same agent that generated the scene is asked to inspect the samples, which reduces independence.

### Render provenance is insufficient

Current Manim metadata records dimensions, duration, and filenames but not the source hash, renderer commit/version, dependency lock hash, font manifest, random seed, asset hashes, or semantic keyframes. A render cannot be strongly tied back to a reproducible input.

### Migration state can show source and output from different systems

The local `adef1409` project currently contains a Manim `scene.py`, while its active metadata and archived output still identify the renderer as Remotion. The server migration resets a thread and removes old timeline fields in memory, but intentionally retains prior renders. That is useful for history, but the UI needs an explicit legacy-render badge and must never imply the current source produced that output.

### There is no stable authoring IR

The model writes the final programming language directly. Therefore every revision can change structure, naming, layout strategy, and timing at once. There is no typed contract for a title, focus object, relationship, shot, cue, or required safe region.

## The proposed system: a video compiler, not a framework mash-up

Call the intermediate representation **VIR** (Video Intermediate Representation). The defining rule is:

> The model may propose intent and structured scene data, but it may not directly control pixels with arbitrary Python, JSX, or CSS in the production path.

The pure evaluation contract is:

`frame = render(compile(VIR, assets, fonts, viewport), time)`

The same VIR drives preview, final render, validation, direct manipulation, revisions, and provenance.

```text
prompt + assets
      │
      ▼
narrative beats ──► visual-device choices ──► 3–8 keyframe candidates
                                                     │
                                                     ▼
                                      constraint solve + candidate ranking
                                                     │
                                                     ▼
                                         state-based motion choreography
                                                     │
                          ┌──────────────────────────┴─────────────────────────┐
                          ▼                                                    ▼
              deterministic geometry/temporal QA                 independent perceptual QA
                          └──────────────────────────┬─────────────────────────┘
                                                     ▼
                                      immutable display list by time
                                                     ▼
                                      preview / render / editor / export
```

### Layer 1: narrative and directing model

Represent the video as beats, not as a flat list of animations.

Each beat should declare:

- communicative intent: reveal, explain cause, compare, quantify, demonstrate, summarize;
- the one primary focus;
- supporting evidence and annotations;
- narration and word-level timing;
- desired visual device: diagram, kinetic type, chart, UI demo, collage, close-up, process, spatial metaphor;
- continuity links to prior and next beats;
- target energy and density;
- duration bounds, not a single guessed duration.

This creates an editorial plan before layout. The system can reject a beat that asks one frame to communicate five unrelated ideas.

### Layer 2: typed visual scene graph

Use a restricted but extensible node set:

- text roles: display, headline, deck, body, caption, label, number, formula;
- vector primitives and paths;
- formula and equation nodes;
- plot/chart nodes with data semantics;
- image/video nodes with crop intent and focal point;
- UI/card nodes;
- annotation nodes tied to a target feature;
- camera/group/mask/effect nodes;
- reusable procedural illustration nodes.

Every node implements the same contract: `measure`, `layout`, `paint`, `hitTest`, `validate`, and optional `morph`. Arbitrary plugins may add node types, but they do not bypass the contract.

### Layer 3: constraint-based layout authority

Do not let an LLM emit hundreds of absolute coordinates. Let it emit relationships and priorities.

Required constraints should include:

- inside safe region;
- no overlap among protected objects;
- minimum type size and contrast;
- maximum lines and line length;
- annotation stays near its target;
- consistent baseline and gap tokens;
- media crop contains its focal point;
- equation labels align to referenced terms;
- aspect and minimum touch/visual sizes where relevant.

Preferred constraints should include:

- declared focus near the intended compositional power zone;
- balanced negative space;
- optical rather than purely geometric centering;
- consistent rhythm across a sequence;
- continuity with the previous beat;
- minimal movement distance for persistent objects.

Use a hybrid solver:

- a box/grid engine for local containers;
- a Cassowary/Kiwi-style linear constraint solver for cross-object relationships and strengths;
- graph-layout algorithms for node-link diagrams;
- a search layer that tries several legal composition families and scores the results.

The key is candidate search. For each beat, generate three to eight low-resolution keyframe candidates, run deterministic checks, score hierarchy/saliency/negative space, and only animate the best candidate. The current one-shot “write code then render a whole video” loop spends expensive effort after the most important design decision has already been guessed.

### Layer 4: professional text engine

Build text around shaping and paragraph layout, not SVG glyph bounds alone.

Use HarfBuzz for shaping, ICU for segmentation and line-break behavior, and Skia Paragraph or an equivalent paragraph engine for layout and painting. Preserve:

- ascent, descent, cap height, x-height, baseline, leading, and line boxes;
- glyph advances and offsets;
- script, language, direction, and font fallback;
- balanced wrapping, max lines, hyphenation policy, widows/orphans;
- optical margin alignment and hanging punctuation;
- measured decorated and undecorated bounds separately.

Decorations such as glow, shadow, background highlight, or outline should not silently change the logical layout box. They should expose a separate paint envelope so collision and crop checks can include them when needed.

### Layer 5: state-based motion and edit grammar

Replace imperative “play this, then wait” generation with declarative object states and transitions.

Each transition declares:

- persistent object identities;
- entering, exiting, and transforming elements;
- focus handoff;
- motion role: reveal, causal movement, comparison, emphasis, camera, ambient;
- path, easing, duration range, and settle behavior;
- z-order and occlusion policy;
- optional audio cue.

The compiler chooses concrete curves. Use bounded cubic curves or damped springs with known envelopes. Validate velocity, acceleration, and swept bounds. Matched geometry should be first-class, not a special trick.

Add a directing grammar above transitions:

- establish → focus → transform → resolve;
- wide → detail → consequence;
- question → evidence → answer;
- object match cut;
- camera push/pan/reframe;
- kinetic-type punctuation;
- diagram build with simultaneous causal motion;
- intentional cut or texture change when a beat changes.

This is what breaks the slideshow pattern. Visual variety comes from changing the **device and shot grammar**, while coherence comes from shared tokens and motion laws.

### Layer 6: a real design system, not a color palette

A style profile must define six coordinated systems:

1. **Typography:** role families, scale ratios, line lengths, casing, numeral style, formula pairing.
2. **Composition:** safe areas, grids, preferred focal zones, density, corner behavior, negative-space policy.
3. **Shape/material:** stroke logic, radii, surface hierarchy, texture, shadow and light rules.
4. **Color:** semantic roles, contrast targets, background modes, chart palette, highlight budget.
5. **Motion:** curve families, duration ranges, stagger rules, overshoot limits, camera behavior, transition vocabulary.
6. **Editorial rhythm:** average shot length, maximum static hold, change cadence, caption density, sound punctuation.

Ship several opinionated visual dialects rather than hundreds of templates:

- technical drafting;
- warm editorial explainer;
- kinetic typography;
- cinematic collage;
- product/UI demonstration;
- data documentary;
- spatial whiteboard;
- geometric proof.

Each dialect uses the same VIR nodes and solver but changes constraints, composition families, and paint/motion rules. A video chooses one primary dialect and, at most, one secondary device. That gives variety without incoherence.

### Layer 7: deterministic renderer

For a new engine, the strongest default is a native 2D display-list renderer based on Skia, using the text stack above. The reasons are:

- one coordinate system and one layout authority;
- vector, raster, masks, filters, gradients, blend modes, paths, and text in one scene graph;
- no DOM reflow or CSS cascade;
- deterministic evaluation of any frame in isolation;
- easier pixel, geometry, and motion-envelope introspection;
- the same engine can power preview and final render.

Containerize and pin fonts, shaping libraries, renderer versions, color management, and codecs. Record all hashes in metadata.

Formula layout can initially compile Typst/LaTeX/MathJax output into normalized vector nodes with explicit baseline and semantic spans. Specialized Manim scenes can initially be imported as rendered vector/raster layers, but this should be a migration escape hatch—not a second live layout authority.

### Layer 8: validation and automatic repair

Run three gates.

**Static deterministic gate**

- safe-area and crop violations;
- logical and paint-envelope collisions;
- text overflow, minimum size, line count, widows/orphans;
- contrast and color-role violations;
- bad label-to-target distance;
- density and empty-space extremes;
- inconsistent spacing/baselines;
- missing fonts/assets and unseeded randomness.

**Temporal deterministic gate**

- sample every key state and adaptively subdivide transitions;
- calculate swept bounds for moving objects;
- detect transient collisions, clipping, flicker, and spring overshoot;
- measure frozen-frame ratio and meaningful visual-change cadence;
- enforce velocity/acceleration/jerk limits by role;
- detect focus changes that occur too quickly to read;
- verify narration/caption/cue alignment.

**Perceptual gate**

- OCR rendered text and compare it with source text;
- estimate saliency and compare it with the declared focus;
- score hierarchy, crowding, legibility, and unintended occlusion with an independent vision model;
- inspect semantic keyframes and transition midpoints, not six uniform timestamps.

Repair should patch constraints or node properties by ID. It should not ask the same model to rewrite an entire scene after a vague “looks crowded” message. A useful violation is: `caption-4 overlaps plot-label-2 by 18 px during frames 47–53; move caption to candidate anchor NE or reduce supporting font one step.`

## Recommended migration plan

### Phase 0: stabilize the existing Manim product

Do this immediately, even if Manim will later be removed.

- Resolve the duration/narration contradiction; derive duration from words and planned visual beats.
- Replace source string checks with AST/API validation and a layout-only execution pass.
- Clean or uniquely version the Manim media directory for every render.
- Hash source, assets, fonts, environment, renderer, and output.
- Pin and package fonts; fail on fallback.
- Add semantic keyframe declarations to `scene.py` and sample those plus transition midpoints.
- Validate every animation interval, not just pre-animation groups.
- Add frozen-ratio and visual-change-cadence metrics.
- Mark legacy Remotion renders explicitly when current source is Manim.
- Separate generation from review; use deterministic checks before a vision critic.

### Phase 1: introduce VIR while retaining Manim as a compiler target

Stop generating free-form `scene.py`. Generate VIR JSON, validate it, and compile a restricted node/motion subset into Manim. This immediately improves revision stability and lets the team build the hard product assets—story model, layout constraints, style profiles, validators, and editor—without first replacing rendering.

The Manim compiler should own object creation. The model should never call `move_to()`, `next_to()`, or `play()` directly. It should express `align`, `inside`, `focus`, `enter`, `transform`, and `emphasize`; the compiler chooses Manim operations.

### Phase 2: build the Skia renderer against the same VIR

Implement text, shapes, paths, images, charts, masks, effects, and camera. Run golden-frame tests against the Manim backend for geometry-heavy examples, but do not reproduce Manim's API. Reproduce the VIR semantics.

At this stage Remotion and Manim become import/export adapters. New production videos use the native renderer. Legacy Remotion scenes can be rasterized as fixed layers during migration, with no DOM layout participating in the new scene solve.

### Phase 3: make the studio edit VIR directly

Direct manipulation writes constraints and keyframes back to VIR. The inspector exposes semantic roles and tokens rather than raw CSS. Timeline edits preserve object identity and narration alignment. LLM revisions become typed patches such as “make the comparison denser,” “change this beat to kinetic type,” or “keep the chart but reframe the conclusion.”

### Phase 4: add candidate generation and learned scoring

Generate multiple keyframe/storyboard candidates before animation. Use acceptance data and human edits to improve layout ranking and dialect selection. The learned layer should rank valid candidates, not replace deterministic layout and rendering.

## What should be reused and what should be discarded

### Reuse

- Manim's object identity and measured-geometry philosophy.
- Its relative placement concepts and transform matching.
- Pango/HarfBuzz-class text shaping.
- Remotion's frame-addressable mental model, media pipeline ideas, asynchronous asset barrier, and React-based studio ergonomics.
- The local project's immutable revisions, narration timing validation, and visual inspection artifacts.

### Discard or demote

- Free-form generated Python as the canonical project format.
- Free-form generated JSX/CSS as the canonical project format.
- Absolute coordinate dumps as the normal layout representation.
- Uniform six-frame contact sheets as the primary visual QA.
- One-shot full-video generation before keyframe selection.
- A single “restrained panel explainer” prompt as the design system.
- Mixed live layout authorities inside one timeline.

## The single most important product decision

Build **VIR plus the layout/validation compiler first**, not a new renderer first.

A new Skia renderer fed by the same unstructured model output would reproduce the same composition failures with different pixels. Conversely, a strong VIR compiled to today's Manim would already improve structure, variety, revision safety, timing, and QA. The renderer replacement becomes valuable once the product has a semantic visual language worth rendering.

The enduring insight to take from Manim is not “use Python” or “use Cairo.” It is:

> Make visual relationships explicit, measurable, and preserved across time.

The enduring insight to take from Remotion is not “use React.” It is:

> Make every frame independently addressable and give creators a rich component/effect ecosystem.

The new system should encode both principles in its own language, then enforce design quality before a single production frame is rendered.
