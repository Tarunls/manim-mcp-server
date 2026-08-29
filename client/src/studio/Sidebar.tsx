import {
  CaretLeft,
  CaretRight,
  GearSix,
  Plus,
  SignOut,
  Star,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import type { BillingState, StudioProject } from "../types";
import { shortDate, type AccountUser } from "../lib/studio";

export function Sidebar({
  projects,
  activeId,
  billing,
  account,
  open,
  collapsed,
  onClose,
  onToggle,
  onNew,
  onSelect,
  onFavorite,
  onBilling,
  onAccount,
  onLogout,
}: {
  projects: StudioProject[];
  activeId?: string;
  billing: BillingState;
  account?: AccountUser;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onFavorite: (project: StudioProject) => void;
  onBilling: () => void;
  onAccount: () => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className={`sidebar ${open ? "sidebar-open" : ""} ${collapsed ? "sidebar-is-collapsed" : ""}`}
      aria-label="Projects"
    >
      <div className="brand-row">
        <span className="wordmark collapsible-copy">Orune</span>
        <button
          className="icon-button sidebar-toggle desktop-only"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
        </button>
        <button
          className="icon-button mobile-only"
          onClick={onClose}
          aria-label="Close projects"
        >
          <X size={16} />
        </button>
      </div>

      {/* the label is hidden when the rail is collapsed, so the name is
          carried explicitly */}
      <button
        className="new-button button button-secondary"
        onClick={onNew}
        aria-label="New video"
        title="New video"
      >
        <Plus size={15} />
        <span className="collapsible-copy">New video</span>
      </button>

      <span className="sidebar-section collapsible-copy">Projects</span>

      <nav className="project-list" aria-label="Recent projects">
        {!projects.length && (
          <p className="project-empty collapsible-copy">Nothing here yet.</p>
        )}
        {projects.map((project) => (
          <div
            className={`project-item ${activeId === project.id ? "project-item-active" : ""}`}
            key={project.id}
          >
            <button
              className="project-select"
              onClick={() => onSelect(project.id)}
              aria-label={project.title}
              title={project.title}
            >
              <span
                className="status-dot"
                data-state={
                  project.status === "running"
                    ? "running"
                    : project.status === "error"
                      ? "error"
                      : "idle"
                }
                aria-hidden="true"
              />
              <span className="project-copy collapsible-copy">
                <span className="project-title">{project.title}</span>
                <span className="project-time">
                  {project.status === "running"
                    ? `Creating v${project.versions.length + 1}`
                    : shortDate(project.updatedAt)}
                </span>
              </span>
            </button>
            <button
              className={`icon-button favorite-button collapsible-copy ${project.favorite ? "favorite-active" : ""}`}
              aria-label={`${project.favorite ? "Remove" : "Add"} ${project.title} ${project.favorite ? "from" : "to"} favorites`}
              onClick={() => onFavorite(project)}
            >
              <Star size={14} weight={project.favorite ? "fill" : "regular"} />
            </button>
          </div>
        ))}
      </nav>

      <div className="account-area">
        <div className="account-card">
          <UserCircle size={22} />
          <div className="account-copy collapsible-copy">
            <span title={account?.email}>
              {account?.isStaff ? "Studio team" : account?.email || "Account"}
            </span>
            <button className="billing-summary" onClick={onBilling}>
              {billing.planName} · {billing.creditsRemaining} credits
            </button>
          </div>
          <button
            className="icon-button collapsible-copy"
            onClick={onAccount}
            aria-label="Account settings"
            title="Account settings"
          >
            <GearSix size={16} />
          </button>
          <button
            className="icon-button collapsible-copy"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
