export type StudioJobType = "render" | "proxy" | "asset-import" | "quality-check";
export type StudioJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export interface StudioJob {
  id: string;
  projectId: string;
  type: StudioJobType;
  status: StudioJobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  checkpoint?: Record<string, unknown>;
}
