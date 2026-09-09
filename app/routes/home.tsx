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

const faqs = [
  {
    question: "What does Process Foundry deliver?",
    answer:
      "An editable BPMN 2.0 diagram with source references, explicit questions and assumptions, and saved revisions for review.",
  },
  {
    question: "What evidence can I bring?",
    answer:
      "Paste text and corrections, record or upload audio, add JPEG, PNG, WebP, HEIC, or HEIF images, and upload CSV, DOCX, or XLSX tables. Documented size and count limits apply.",
  },
  {
    question: "Can I edit and export the result?",
    answer:
      "Yes. Edit the diagram in the embedded modeler, keep revisions, and export standard BPMN, SVG, or high-resolution PNG files.",
  },
  {
    question: "What happens when evidence is missing or conflicts?",
    answer:
      "The gap stays visible as a question or assumption for review. Unsupported or ambiguous BPMN behavior is surfaced for a person to resolve rather than invented.",
  },
  {
    question: "Where does my data live, and what is sent to OpenAI?",
    answer:
      "Your deployment keeps project and review state in Cloudflare D1 and source objects in private R2. Audio transcription and model extraction are sent directly to OpenAI; Responses requests use store: false.",
  },
  {
    question: "What do I need to install it?",
    answer:
      "Use Node.js 22.22.2+ on the 22.x line or 24.15+ on the 24.x line, npm 12+, curl, tar, and Bash. You also provide Cloudflare authorization, an OpenAI API key, and a shared login phrase.",
  },
  {
    question: "How are licensing, hosting, and AI costs handled?",
    answer:
      "The software is available under Apache 2.0. You host it in your own Cloudflare account and provide the OpenAI API key, so provider usage is billed under the plans you choose.",
  },
] as const;

type CopyStatus = "idle" | "copied" | "failed";

function InstallCommand({
  instanceId,
  heading,
}: {
  instanceId: "hero" | "final";
  heading: string;
}) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const feedbackId = `install-copy-feedback-${instanceId}`;

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
    <div className="landing-command" aria-label={heading}>
      <p>{heading}</p>
      <div className="landing-command-control">
        <code tabIndex={0}>{INSTALL_COMMAND}</code>
        <button
          type="button"
          onClick={() => void copyInstallCommand()}
          aria-describedby={feedbackId}
        >
          {copyLabel}
        </button>
      </div>
      <p
        id={feedbackId}
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
  );
}

export const meta: MetaFunction = () => [
  { title: "Process Foundry | Challengeable BPMN from source evidence" },
  { name: "description", content: copy.description },
];

export default function Home() {
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

          <InstallCommand
            instanceId="hero"
            heading="Install in your Cloudflare account"
          />

          <div className="landing-hero-art" aria-hidden="true">
            <img
              src="/process-foundry-structure.webp"
              alt=""
              width="1280"
              height="853"
              loading="eager"
              fetchPriority="high"
            />
          </div>

          <Link className="landing-demo-link" to="/demo">
            Explore the interactive demo
            <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section className="landing-why" aria-labelledby="why-title">
          <div className="landing-why-intro">
            <h2 id="why-title">A process model should show its working.</h2>
            <p>
              Operational truth is scattered across notes, audio, images,
              tables, and the people who remember the exceptions.
            </p>
          </div>

          <div className="landing-why-copy">
            <p>
              Model elements keep source references, so reviewers can trace the
              diagram back to the material that shaped it.
            </p>
            <p>
              Missing or conflicting detail remains visible as a question or
              assumption until someone resolves it against the evidence.
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

        <section className="landing-faq" aria-labelledby="faq-title">
          <div className="landing-faq-intro">
            <h2 id="faq-title">Questions before you self-host.</h2>
            <p>
              What to expect from the model, the data path, and installation.
            </p>
          </div>
          <div className="landing-faq-list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          id="self-hosting"
          className="landing-self-host"
          aria-labelledby="self-host-title"
        >
          <div className="landing-self-host-inner">
            <div className="landing-self-host-intro">
              <h2 id="self-host-title">
                Run Process Foundry in your Cloudflare account.
              </h2>
              <p>
                Review the requirements, then use the release launcher to create
                a deployer-owned installation.
              </p>
            </div>
            <InstallCommand
              instanceId="final"
              heading="Install from the latest published release"
            />
            <a
              className="landing-self-host-docs"
              href="https://github.com/maxjustships/process-foundry/blob/main/docs/SELF_HOSTING.md"
            >
              Read the self-hosting guide
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="public-footer">
        <strong>Process Foundry</strong>
        <span>Source evidence to editable BPMN</span>
        <a href="https://github.com/maxjustships/process-foundry">
          Source and Apache 2.0 license
        </a>
      </footer>
    </div>
  );
}
