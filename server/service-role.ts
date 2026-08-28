export type ServiceRole = "api" | "dispatcher" | "all";

const dispatcherPaths = new Set([
  "/api/internal/generation/dispatch",
  "/api/internal/generation/reconcile",
]);

export function routeAllowedForService(role: ServiceRole, path: string) {
  if (role === "all") return true;
  if (path === "/healthz" || path.startsWith("/api/health")) return true;
  return role === "dispatcher" ? dispatcherPaths.has(path) : !dispatcherPaths.has(path);
}
