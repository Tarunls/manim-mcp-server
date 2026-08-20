import type { StudioProject } from "./types";

export function isLegacyProject(project: StudioProject) {
  return project.versions.length > 0 && Boolean(project.timeline) && project.timeline!.shots.length === 0;
}
