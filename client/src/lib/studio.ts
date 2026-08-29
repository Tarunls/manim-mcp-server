import type {
  AuthState,
  BillingState,
  GenerationEffort,
  ProjectStage,
  RuntimeState,
  StudioProject,
} from "../types";

export const CONTACT_EMAIL = "tarun.l.sankar@gmail.com";

export const EMPTY_AUTH: AuthState = { connected: false };

export const EMPTY_RUNTIME: RuntimeState = {
  codex: false,
  manim: false,
  ffmpeg: false,
};

export const EMPTY_BILLING: BillingState = {
  userId: "",
  plan: "free",
  planName: "Free",
  status: "free",
  creditsRemaining: 1,
  periodEnd: "",
  stripeConfigured: false,
  hasStripeCustomer: false,
  isStaff: false,
  billingMode: "unconfigured",
  entitlements: {
    creditsPerMonth: 1,
    maxEffort: "quick",
    narration: false,
    licensedAssets: false,
  },
};

export type ChatMode = "docked" | "floating";
export type ChatSide = "left" | "right";
export type FloatingPosition = { x: number; y: number };
export type AccountUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  isStaff: boolean;
};
export type AccountState = {
  checked: boolean;
  configured: boolean;
  authenticated: boolean;
  user?: AccountUser;
};

export function mergeProject(projects: StudioProject[], project: StudioProject) {
  const next = projects.filter((item) => item.id !== project.id);
  return [project, ...next].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function shortDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function videoEngineIsReady(runtime: RuntimeState) {
  return runtime.manim;
}

export function stageLabel(stage: ProjectStage) {
  return stage === "brief"
    ? "Planning the lesson"
    : stage === "rendering"
      ? "Rendering the video"
      : stage === "inspecting"
        ? "Inspecting frames"
        : "Building the visuals";
}

export function generationLabel(project: StudioProject) {
  return project.versions.length
    ? `Revision ${project.versions.length + 1}`
    : "First draft";
}

export const THINKING_OPTIONS: Array<{
  value: GenerationEffort;
  label: string;
}> = [
  { value: "quick", label: "Faster" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Try harder" },
];

export function clampEffort(value: GenerationEffort, max: GenerationEffort) {
  const valueIndex = THINKING_OPTIONS.findIndex(
    (option) => option.value === value,
  );
  const maxIndex = THINKING_OPTIONS.findIndex((option) => option.value === max);
  return THINKING_OPTIONS[Math.min(valueIndex, maxIndex)].value;
}
