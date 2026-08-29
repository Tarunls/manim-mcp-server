import { useState } from "react";
import { errorMessage, request } from "../lib/api";
import { CONTACT_EMAIL, type AccountUser } from "../lib/studio";
import { Modal } from "./Modal";

export function AccountDialog({
  account,
  onClose,
}: {
  account: AccountUser;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setDeleting(true);
    setError("");
    try {
      await request("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ email: confirmation }),
      });
      window.location.href = "/";
    } catch (reason) {
      setError(errorMessage(reason, "Could not delete the account."));
      setDeleting(false);
    }
  }

  return (
    <Modal
      label="Account settings"
      kicker="Account"
      title="Data and access"
      className="account-dialog"
      onClose={onClose}
      footer={
        <>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Support</a>
        </>
      }
    >
      <div className="account-dialog-section">
        <strong>Your data</strong>
        <p>
          Download your account, projects, generation history, billing state,
          and recorded model usage.
        </p>
        <a
          className="button button-secondary"
          href="/api/account/export"
          download
        >
          Download JSON export
        </a>
      </div>
      <div className="account-dialog-section danger-zone">
        <strong>Delete account</strong>
        <p>
          This cancels an active subscription and permanently removes your
          projects and generated files. Cancel any running generation first.
        </p>
        <label>
          <span>Enter {account.email} to confirm</span>
          <input
            type="email"
            autoComplete="email"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button
          className="button button-danger"
          disabled={
            deleting || confirmation.trim().toLowerCase() !== account.email
          }
          onClick={() => void deleteAccount()}
        >
          {deleting ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </Modal>
  );
}
