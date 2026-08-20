export type QualitySeverity = "info" | "warning" | "error";

export interface QualityCheck {
  id: string;
  category: "project" | "layout" | "assets" | "audio" | "video" | "provenance";
  severity: QualitySeverity;
  message: string;
  targetId?: string;
  value?: number | string | boolean;
}

export interface QualityReport {
  projectId: string;
  createdAt: string;
  passed: boolean;
  score: number;
  summary: { errors: number; warnings: number; info: number };
  checks: QualityCheck[];
  media?: { width?: number; height?: number; fps?: number; duration?: number; bitRate?: number; hasAudio?: boolean };
  provenance: { assets: number; licensedAssets: number; attributedAssets: number; generatedAssets: number };
}
