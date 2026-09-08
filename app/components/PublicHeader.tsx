import { Link } from "react-router";

export function PublicHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`public-header${compact ? " is-compact" : ""}`}>
      <Link
        to="/"
        className="public-wordmark"
        aria-label="Process Foundry home"
      >
        <span aria-hidden="true">PF</span>
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
