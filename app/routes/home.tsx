import { useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { PublicHeader } from "../components/PublicHeader";

const INSTALL_COMMAND =
  "bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'";

const copy = {
  title: "Turn process evidence into a BPMN model your team can challenge.",
  description:
    "Reach an editable process model with source evidence, questions, assumptions, revisions, and standard BPMN export.",
} as const;

type CopyStatus = "idle" | "copied" | "failed";

export const meta: MetaFunction = () => [
  { title: "Process Foundry | Challengeable BPMN from source evidence" },
  { name: "description", content: copy.description },
];

export default function Home() {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const copyLabel =
    copyStatus === "copied"
      ? "Copied"
      : copyStatus === "failed"
        ? "Copy failed"
        : "Copy command";

  return (
    <div className="public-page landing-page">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <PublicHeader />

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <h1 id="landing-title">
              <span>Turn process evidence into</span>
              <span>a BPMN model your team can challenge.</span>
            </h1>
            <p>{copy.description}</p>
          </div>

          <div className="landing-command" aria-label="Installation command">
            <p>Install in your Cloudflare account</p>
            <div className="landing-command-control">
              <code tabIndex={0}>{INSTALL_COMMAND}</code>
              <button
                type="button"
                onClick={() => void copyInstallCommand()}
                aria-describedby="copy-feedback"
              >
                {copyLabel}
              </button>
            </div>
            <p
              id="copy-feedback"
              className={`landing-copy-feedback is-${copyStatus}`}
              role="status"
              aria-live="polite"
            >
              {copyStatus === "copied"
                ? "Command copied to clipboard."
                : copyStatus === "failed"
                  ? "Clipboard access failed. Select the command to copy it manually."
                  : "Select the command to copy it manually."}
            </p>
          </div>

          <Link className="landing-demo-link" to="/demo">
            Explore the interactive demo
            <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section
          id="self-hosting"
          className="landing-why"
          aria-labelledby="why-title"
        >
          <div className="landing-why-intro">
            <h2 id="why-title">A process model should show its working.</h2>
            <p>
              Operational truth is scattered across notes, audio, images,
              tables, and the people who remember the exceptions.
            </p>
          </div>

          <figure className="landing-proof">
            <div className="landing-proof-viewport">
              <img
                src="/process-foundry-demo.webp"
                alt="Process Foundry showing an editable returns BPMN diagram beside its source evidence and review panel"
                width="1440"
                height="1113"
                loading="eager"
                fetchPriority="high"
              />
            </div>
            <figcaption>
              The editable diagram stays beside the evidence and review context
              that shaped it.
            </figcaption>
          </figure>

          <div className="landing-why-reasons">
            <p>
              Model elements keep source references. Missing detail becomes a
              visible question or assumption instead of disappearing inside a
              polished answer.
            </p>
            <p>
              Run Process Foundry in your Cloudflare account so source files and
              model access remain in your environment.
            </p>
          </div>
        </section>

        <section className="landing-how" aria-labelledby="how-title">
          <div className="landing-how-intro">
            <h2 id="how-title">From fragmented evidence to editable BPMN.</h2>
            <p>The path stays concrete, inspectable, and open to correction.</p>
          </div>

          <ol className="landing-method">
            <li>
              <h3>Bring the evidence</h3>
              <p>Add notes, recorded or uploaded audio, images, and tables.</p>
            </li>
            <li>
              <h3>Map the process</h3>
              <p>
                Turn roles, events, tasks, decisions, and handoffs into a
                structured model with source references.
              </p>
            </li>
            <li>
              <h3>Challenge the gaps</h3>
              <p>
                Inspect each element, answer questions, and correct assumptions
                against the original evidence.
              </p>
            </li>
            <li>
              <h3>Revise and export</h3>
              <p>
                Compare revisions, edit the diagram, and export standard BPMN
                for the tools your team already uses.
              </p>
            </li>
          </ol>
        </section>
      </main>

      <footer className="public-footer">
        <strong>Process Foundry</strong>
        <span>Source evidence to editable BPMN</span>
        <a href="https://github.com/maxjustships/process-foundry">
          Source · Apache 2.0
        </a>
      </footer>
    </div>
  );
}
