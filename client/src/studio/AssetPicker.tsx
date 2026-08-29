import { ImageSquare, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { errorMessage, request } from "../lib/api";
import type { StudioProject } from "../types";
import { Modal } from "./Modal";

type AssetCandidate = {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  downloadUrl: string;
  sourceUrl: string;
  creator?: string;
  license: string;
  licenseUrl?: string;
  provider: "Wikimedia Commons";
};

export function AssetPicker({
  project,
  onClose,
}: {
  project: StudioProject;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const body = await request<{ results: AssetCandidate[] }>(
        `/api/assets/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(body.results);
    } catch (reason) {
      setError(errorMessage(reason, "Search failed."));
    } finally {
      setLoading(false);
    }
  }

  async function importCandidate(candidate: AssetCandidate) {
    setImporting(candidate.id);
    setError("");
    try {
      await request(`/api/projects/${project.id}/assets`, {
        method: "POST",
        body: JSON.stringify(candidate),
      });
    } catch (reason) {
      setError(errorMessage(reason, "Import failed."));
    } finally {
      setImporting(undefined);
    }
  }

  return (
    <Modal
      label="Add a visual"
      kicker="Visual search"
      title="Add the right visual"
      subtitle="Search reusable images with source and creator details kept automatically."
      className="asset-dialog"
      onClose={onClose}
    >
      <form
        className="asset-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <MagnifyingGlass size={17} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search diagrams, places, people…"
          aria-label="Search visuals"
        />
        <button
          className="button button-secondary"
          disabled={loading || query.trim().length < 2}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <span className="form-error">{error}</span>}
      <div className="asset-grid">
        {results.map((candidate) => {
          const imported = project.assets?.some(
            (asset) => asset.sourceUrl === candidate.sourceUrl,
          );
          return (
            <article className="asset-card" key={candidate.id}>
              <img src={candidate.thumbnailUrl} alt="" />
              <div>
                <strong>{candidate.title.replace(/^File:/, "")}</strong>
                <small title={candidate.description}>
                  {candidate.description ||
                    candidate.creator ||
                    candidate.provider}
                </small>
                <small>
                  {candidate.creator
                    ? `${candidate.creator} · ${candidate.license}`
                    : candidate.license}
                </small>
              </div>
              <button
                className="button button-secondary"
                disabled={imported || Boolean(importing)}
                onClick={() => void importCandidate(candidate)}
              >
                {imported
                  ? "Added"
                  : importing === candidate.id
                    ? "Adding…"
                    : "Add to project"}
              </button>
            </article>
          );
        })}
      </div>
      {!results.length && !loading && (
        <div className="asset-empty">
          <ImageSquare size={26} />
          <p>Search results will appear here with their creator and license.</p>
        </div>
      )}
    </Modal>
  );
}
