import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { compileProcessIr } from "../../domain/bpmn-compiler";
import { validateProcessIr } from "../../domain/process-ir";
import { demoProject } from "../../app/demo/fixture";

const root = path.resolve(import.meta.dirname, "../..");

function resolveLocalModule(fromFile: string, specifier: string): string {
  const target = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    path.join(target, "index.ts"),
    path.join(target, "index.tsx"),
  ];
  const resolved = candidates.find((candidate) => {
    try {
      readFileSync(candidate, "utf8");
      return true;
    } catch {
      return false;
    }
  });
  if (!resolved)
    throw new Error(`Could not resolve ${specifier} imported by ${fromFile}`);
  return resolved;
}

function localImportGraph(entrypoint: string) {
  const files = new Set<string>();
  const imports: Array<{ from: string; specifier: string }> = [];
  const pending = [entrypoint];

  while (pending.length) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const imported of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const specifier = imported.fileName;
      imports.push({ from: file, specifier });
      if (!specifier.startsWith(".")) continue;
      pending.push(resolveLocalModule(file, specifier));
    }
  }

  return { files: [...files], imports };
}

describe("public OSS surface", () => {
  it("ships a valid, deterministic fictional demo fixture", () => {
    expect(demoProject.fictional).toBe(true);
    expect(demoProject.sources.length).toBeGreaterThanOrEqual(4);
    expect(demoProject.versions.length).toBeGreaterThanOrEqual(2);

    for (const version of demoProject.versions) {
      expect(validateProcessIr(version.ir)).toEqual([]);
      expect(version.bpmnXml).toBe(compileProcessIr(version.ir));
    }

    expect(
      demoProject.versions.some((version) => version.ir.questions.length > 0),
    ).toBe(true);
    expect(
      demoProject.versions.some((version) =>
        version.ir.nodes.some((node) => node.assumptions.length > 0),
      ),
    ).toBe(true);
    expect(demoProject.versions[0]!.ir.participants[0]!.lanes).toHaveLength(3);
    expect(demoProject.versions[0]!.ir.nodes).toHaveLength(12);
    expect(
      demoProject.versions[0]!.ir.flows.filter(
        (flow) => flow.sourceId === "policy_check",
      )
        .map((flow) => flow.condition)
        .sort(),
    ).toEqual(["Eligible", "Not eligible"]);
  });

  it("keeps the landing explanation text-only and the demo review-first", () => {
    const home = readFileSync(path.join(root, "app/routes/home.tsx"), "utf8");
    const demo = readFileSync(path.join(root, "app/routes/demo.tsx"), "utf8");
    const styles = readFileSync(path.join(root, "app/public.css"), "utf8");
    const whySection = home.match(
      /<section className="landing-why"[\s\S]*?<\/section>/u,
    )?.[0];

    expect(home).not.toContain("BpmnEditorCore");
    expect(home).not.toContain("<BpmnEditorCore");
    expect(home).not.toContain("demoProject");
    expect(home).not.toContain('src="/process-foundry-demo.webp"');
    expect(home).toContain('src="/process-foundry-structure.webp"');
    expect(home).toContain(
      '<div className="landing-hero-art" aria-hidden="true">',
    );
    expect(home).not.toContain('<figure className="landing-hero-art"');
    expect(whySection).toBeDefined();
    expect(whySection).not.toMatch(/<(?:figure|img|figcaption)\b/u);
    expect(home).toContain(
      "bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'",
    );
    expect(home).toContain(
      'href="https://github.com/maxjustships/process-foundry"',
    );
    expect(home).toContain("navigator.clipboard.writeText(INSTALL_COMMAND)");
    expect(home).toContain('role="status"');
    expect(home).toContain('className="landing-why"');
    expect(home).toContain('className="landing-how"');
    expect(home).toContain('className="landing-faq"');
    expect(home).toContain('id="self-hosting"');
    expect(home.match(/\bquestion: "/gu)).toHaveLength(7);
    expect(home).toContain('instanceId="hero"');
    expect(home).toContain('instanceId="final"');
    expect(home).toContain(
      "const feedbackId = `install-copy-feedback-${instanceId}`",
    );
    for (const action of [
      "Bring the evidence",
      "Map the process",
      "Challenge the gaps",
      "Revise and export",
    ])
      expect(home).toContain(action);

    expect(demo).toMatch(
      /Select a model element, then inspect its linked evidence\./u,
    );
    expect(demo).toContain("minimumZoom: 0.62");
    expect(demo).toContain("minimumZoomWidth: 700");
    expect(demo).toContain("maximumWidth: 699");
    expect(demo).toContain("minimumZoom: 0.9");
    expect(demo).toContain('locale="en"');
    expect(demo).not.toContain("LanguageSwitcher");
    expect(demo).toContain("onSelectionChange={setSelectedElementId}");
    expect(styles).toContain("--demo-workspace-height: calc(100dvh - 156px)");
    expect(styles).toMatch(
      /\.landing-command-control \{[\s\S]*?display: grid;/u,
    );
    expect(styles).not.toContain(".landing-proof");
    expect(styles).toMatch(
      /\.landing-hero-art \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?pointer-events: none;/u,
    );
    expect(styles).toMatch(
      /\.landing-hero-art::after \{[\s\S]*?linear-gradient\([\s\S]*?90deg,[\s\S]*?var\(--landing-canvas\) 0%,[\s\S]*?transparent 100%/u,
    );
    expect(styles).toMatch(
      /\.landing-hero-art img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?display: block;[\s\S]*?object-fit: cover;/u,
    );
    expect(styles).toMatch(/\.landing-method li \{[\s\S]*?display: grid;/u);
    expect(styles).toMatch(
      /\.demo-project-rail \{[\s\S]*?height: var\(--demo-workspace-height\)/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.demo-canvas-column \.canvas-shell > header \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
    );
    expect(styles).toMatch(
      /\.demo-canvas-column \.bpmn-canvas \.djs-label \{[\s\S]*?font-size: 16px/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.landing-command-control \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u,
    );
    expect(styles.match(/\.djs-palette/gu)).toHaveLength(1);
    expect(styles).toMatch(
      /\.demo-page \.djs-palette \{\s*display: none;\s*\}/u,
    );
    expect(styles).toMatch(/\.demo-reference \{[\s\S]*?display: block;/u);
  });

  it("keeps complete public dependency graphs free of private mutation code", () => {
    for (const entrypoint of ["app/routes/home.tsx", "app/routes/demo.tsx"]) {
      const graph = localImportGraph(path.join(root, entrypoint));
      const relativeFiles = graph.files.map((file) =>
        path.relative(root, file),
      );
      const source = graph.files
        .map((file) => readFileSync(file, "utf8"))
        .join("\n");

      if (entrypoint.endsWith("demo.tsx"))
        expect(relativeFiles).toContain("app/components/BpmnEditorCore.tsx");
      else
        expect(relativeFiles).not.toContain(
          "app/components/BpmnEditorCore.tsx",
        );
      expect(relativeFiles).not.toContain("app/components/BpmnEditor.tsx");
      expect(source).not.toMatch(/\/api\//u);
      expect(source).not.toMatch(/\bfetch\s*\(/u);
      expect(source).not.toMatch(/\buseFetcher\b|<Form\b/u);
      for (const imported of graph.imports)
        expect(
          imported.specifier,
          `${imported.from} imports a private module`,
        ).not.toMatch(
          /(?:^|[./-])(?:telemetry|repository|server|ai|provider|workflow|d1|r2|persistence)(?:$|[./-])/iu,
        );
    }
  });

  it("keeps public CTAs accurate and workspace navigation workspace-scoped", () => {
    const header = readFileSync(
      path.join(root, "app/components/PublicHeader.tsx"),
      "utf8",
    );
    const home = readFileSync(path.join(root, "app/routes/home.tsx"), "utf8");
    const demo = readFileSync(path.join(root, "app/routes/demo.tsx"), "utf8");
    const rootRoute = readFileSync(path.join(root, "app/root.tsx"), "utf8");
    const login = readFileSync(path.join(root, "app/routes/login.tsx"), "utf8");
    const privateRoutes = [
      "app/routes/projects.tsx",
      "app/routes/project.tsx",
      "app/routes/admin.telemetry.tsx",
    ].map((file) => readFileSync(path.join(root, file), "utf8"));

    expect(header).toContain('to="/login?next=/projects"');
    expect(header).toContain('to="/#self-hosting"');
    expect(header).toContain('src="/process-foundry-mark.png"');
    expect(header).toContain("Open workspace");
    for (const asset of [
      "/favicon-16.png",
      "/favicon-32.png",
      "/favicon.ico",
      "/apple-touch-icon.png",
    ])
      expect(rootRoute).toContain(asset);
    expect(login).toContain('if (session) throw redirect("/projects")');
    expect(login).toContain('requestedNext === null ? "/projects"');
    expect(`${home}\n${demo}`).not.toMatch(/Deploy your own/u);
    expect(`${home}\n${demo}`).not.toMatch(/[\u0400-\u04ff]/u);
    expect(home).not.toContain('href="#final-cta"');
    for (const source of privateRoutes) {
      expect(source).not.toContain('to="/" className="wordmark"');
      expect(source).not.toMatch(/<Link to="\/">\{t\(locale, "nav\./u);
    }
    expect(privateRoutes[1]).toContain('window.location.assign("/projects")');
  });

  it("uses neutral public metadata and deployment documentation", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { name: string; description: string; private?: boolean };
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    const selfHosting = readFileSync(
      path.join(root, "docs/SELF_HOSTING.md"),
      "utf8",
    );

    expect(packageJson.name).toBe("process-foundry");
    expect(packageJson.description).toMatch(/evidence.*BPMN/iu);
    expect(packageJson.private).toBe(true);
    expect(readme).toContain("/demo");
    expect(selfHosting).toContain("wrangler.production.jsonc");
    expect(`${readme}\n${selfHosting}`).not.toMatch(
      /const\s+\w*(?:owner|maintainer)\w*\s*=\s*\[/iu,
    );
  });
});
