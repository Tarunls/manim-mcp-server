# Educational video review rubric

## Layout

- No independent objects intersect or violate the renderer's safe gap.
- Nothing is clipped by the frame, a panel, or text wrapping.
- Hierarchy stays readable at 1920×1080 and at a laptop-sized preview.

## Motion

- Entering, exiting, and transforming objects remain collision-free between key poses.
- Easing supports the explanation; it does not obscure state changes.
- Cuts and transitions leave enough time to read the resulting state.

## Pedagogy

- Each beat has one clear teaching purpose and one dominant visual.
- Narration and visuals introduce the same idea at the same time.
- Decorative elements never compete with the causal or mathematical relationship.

## Accessibility

- Text contrast is strong; meaning does not depend on color alone.
- Important text is large, concise, and visible long enough to read.
- Motion is not needlessly rapid, flashing, or disorienting.

## House style

- The ground is warm paper. No dark background, gradient, glow, vignette, or drop shadow appears in any frame.
- No cards, rounded boxes, uppercase eyebrow tags, chips, badges, or decorative rules appear anywhere.
- Every beat's running head, claim, and visual align to one editorial left margin. Nothing is centred.
- The claim reads as a full sentence in sentence case; the running head is small and muted. Emphasis never comes from bold weight or colour.
- The working colour carries the mathematical object; the payoff colour appears exactly once in the lesson.
- Axes are thin and untipped in the rule colour; fills stay pale enough to read the curve on top of them.
- Text is cross-faded rather than morphed, and groups with different element counts are cross-faded rather than transformed.
- Every text mobject uses the font family named in `design-config.json`.

## Polish

- Spacing, stroke widths, type scale, and palette are consistent.
- Asset crops are clean and credits/licenses remain in `assets.json`.
