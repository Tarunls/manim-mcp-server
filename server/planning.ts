export function productionRequest(text: string, revision: boolean) {
  const request = revision
    ? `Revise the existing editable video project for this request: ${text}`
    : `Create the first editable video project for this prompt: ${text}`;
  return `${request}

Follow the production gates in order:
1. Read project.json and update its brief, storyboard, shots, tracks, clips, assets, and narration. Do not start renderer code before the storyboard is valid.
2. Run: node --import tsx ../../../scripts/validate_project.ts .
3. Search and import only the online assets named by the storyboard, using the provided asset scripts. Preserve license and provenance fields.
4. Write narration.json from the approved storyboard, then run: node ../../../scripts/generate_narration.mjs . --prepare
5. Read narration-timing.json and time every shot to the actual speech. Run the project validator again.
6. Produce specialized Manim source only for shots routed to Manim. Keep the rest represented as editable timeline clips.
7. Render the full timeline through the appropriate renderer and inspect the result.

Keep unrelated shots and assets stable during revisions. A targeted request must patch the smallest possible portion of project.json.`;
}
