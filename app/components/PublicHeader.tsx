import { Link } from "react-router";

export function PublicHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`public-header${compact ? " is-compact" : ""}`}>
      <Link
        to="/"
        className="public-wordmark"
        aria-label="Process Foundry home"
      >
        <img
          src="/process-foundry-mark.png"
          alt=""
          width="38"
          height="38"
          aria-hidden="true"
        />
        <strong>Process Foundry</strong>
      </Link>
      <nav aria-label="Public navigation">
        <Link to="/demo">Open live demo</Link>
        <Link to="/#self-hosting">Self-host</Link>
        <Link to="/login?next=/projects" className="public-sign-in">
          Open workspace
        </Link>
      </nav>
    </header>
  );
}
