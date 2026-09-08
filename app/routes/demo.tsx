import { useMemo, useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { BpmnEditorCore } from "../components/BpmnEditorCore";
import { PublicHeader } from "../components/PublicHeader";
import { demoProject } from "../demo/fixture";

const copy = {
  description:
    "Inspect the model, select a process element, and trace it back to the evidence that shaped it.",
  sourceHint: "Open a source to inspect the excerpt behind the model.",
} as const;

const demoInitialFit = {
  minimumZoom: 0.62,
  minimumZoomWidth: 700,
  offset: { x: 12, y: 0 },
  compact: {
    maximumWidth: 699,
    focus: { x: 325, y: 230 },
    minimumZoom: 0.9,
  },
} as const;

export const meta: MetaFunction = () => [
  { title: "Interactive workflow | Process Foundry" },
  { name: "description", content: copy.description },
];

export default function Demo() {
  const [versionId, setVersionId] = useState(demoProject.versions[0]!.id);
  const [editorKey, setEditorKey] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const version =
    demoProject.versions.find((item) => item.id === versionId) ??
    demoProject.versions[0]!;
  const selectedNode = useMemo(
    () =>
      version.ir.nodes.find((node) => node.id === selectedElementId) ?? null,
    [selectedElementId, version],
  );
  const selectedSourceIds = useMemo(
    () =>
      new Set(selectedNode?.sourceRefs.map((reference) => reference.sourceId)),
    [selectedNode],
  );
  const assumptions = useMemo(
    () =>
      version.ir.nodes.flatMap((node) =>
        node.assumptions.map((assumption) => ({ assumption, node: node.name })),
      ),
    [version],
  );
  const references = useMemo(() => {
    const unique = new Map<string, { sourceId: string; locator: string }>();
    for (const node of version.ir.nodes)
      for (const reference of node.sourceRefs)
        unique.set(`${reference.sourceId}:${reference.locator}`, reference);
    return [...unique.values()];
  }, [version]);
  const sourceNames = new Map(
    demoProject.sources.map((source) => [source.id, source.name]),
  );

  function selectVersion(nextVersionId: string) {
    setVersionId(nextVersionId);
    setSelectedElementId(null);
    setEditorKey((value) => value + 1);
  }

  function resetDiagram() {
    setSelectedElementId(null);
    setEditorKey((value) => value + 1);
  }

  return (
    <div className="public-page demo-page">
      <a className="skip-link" href="#demo-workspace">
        Skip to workspace
      </a>
      <PublicHeader compact />
      <main id="demo-workspace">
        <header className="demo-command-bar">
          <div className="demo-project-identity">
            <Link to="/" className="demo-back" aria-label="Product overview">
              <span aria-hidden="true">←</span>
            </Link>
            <div>
              <h1>{demoProject.title}</h1>
              <p>{copy.description}</p>
            </div>
          </div>
          <div className="demo-command-actions" aria-label="Project controls">
            <label htmlFor="demo-version">
              <span>Version</span>
              <select
                id="demo-version"
                value={version.id}
                onChange={(event) => selectVersion(event.target.value)}
              >
                {demoProject.versions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={resetDiagram}>
              Reset model
            </button>
          </div>
        </header>

        <div className="demo-grid">
          <section
            className="demo-canvas-column"
            aria-label="Editable BPMN model"
          >
            <div className="demo-version-note">
              <div>
                <strong>{version.label}</strong>
                <span>
                  Created{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(new Date(version.createdAt))}
                </span>
              </div>
              <p>Select a model element, then inspect its linked evidence.</p>
            </div>
            <BpmnEditorCore
              key={`${version.id}-${editorKey}`}
              xml={version.bpmnXml}
              locale="en"
              revisionNumber={version.number}
              documentTitle={demoProject.title}
              initialFit={demoInitialFit}
              onSelectionChange={setSelectedElementId}
            />
          </section>

          <aside
            className="demo-project-rail"
            aria-label="Project evidence and review"
          >
            <div className="demo-selection-context" aria-live="polite">
              {selectedNode ? (
                <>
                  <span>Selected element</span>
                  <strong>{selectedNode.name}</strong>
                  <p>
                    {selectedSourceIds.size} linked{" "}
                    {selectedSourceIds.size === 1 ? "source" : "sources"}
                  </p>
                </>
              ) : (
                <>
                  <span>Start here</span>
                  <strong>Select a model element</strong>
                  <p>Linked evidence will surface in this rail.</p>
                </>
              )}
            </div>

            <section
              className="demo-sources"
              aria-labelledby="demo-sources-title"
            >
              <div className="demo-panel-heading">
                <h2 id="demo-sources-title">Evidence</h2>
                <p>{copy.sourceHint}</p>
              </div>
              <div className="demo-source-list">
                {demoProject.sources.map((source, index) => {
                  const linked = selectedSourceIds.has(source.id);
                  return (
                    <details
                      key={source.id}
                      className={linked ? "is-linked" : undefined}
                      open={index === 0}
                    >
                      <summary>
                        <span className={`demo-source-kind is-${source.kind}`}>
                          {source.kind.toUpperCase()}
                        </span>
                        <span>
                          <strong>{source.name}</strong>
                          <small>{source.detail}</small>
                          {linked ? <em>Linked to selection</em> : null}
                        </span>
                      </summary>
                      <blockquote>{source.excerpt}</blockquote>
                    </details>
                  );
                })}
              </div>
            </section>

            <section
              className="demo-review"
              aria-labelledby="demo-review-title"
            >
              <div className="demo-panel-heading">
                <h2 id="demo-review-title">Review</h2>
              </div>
              <section>
                <h3>
                  Open questions <span>{version.ir.questions.length}</span>
                </h3>
                {version.ir.questions.map((question) => (
                  <details className="demo-review-item" key={question.id} open>
                    <summary>{question.text}</summary>
                    <p>{question.relatedElementIds.join(", ")}</p>
                  </details>
                ))}
              </section>
              <section>
                <h3>
                  Assumptions <span>{assumptions.length}</span>
                </h3>
                {assumptions.map((item) => (
                  <details className="demo-review-item" key={item.assumption}>
                    <summary>{item.assumption}</summary>
                    <p>{item.node}</p>
                  </details>
                ))}
              </section>
              <section>
                <h3>
                  Evidence links <span>{references.length}</span>
                </h3>
                {references.map((reference) => (
                  <div
                    className="demo-reference"
                    key={`${reference.sourceId}-${reference.locator}`}
                  >
                    <p>
                      {sourceNames.get(reference.sourceId) ??
                        reference.sourceId}
                      <small>{reference.locator}</small>
                    </p>
                  </div>
                ))}
              </section>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
