import { useCallback } from "react";
import { t, type Locale } from "../lib/i18n";
import { track } from "../lib/telemetry.client";
import {
  BpmnEditorCore,
  type BpmnEditorActivity,
  type BpmnEditorSaveResult,
} from "./BpmnEditorCore";

const activityEvents = {
  "shape.create": "canvas.node_created",
  "shape.delete": "canvas.node_deleted",
  "shape.move": "canvas.node_moved",
  "element.updateProperties": "canvas.node_renamed",
  "connection.create": "canvas.connection_created",
  "connection.delete": "canvas.connection_deleted",
  "viewbox.changed": "canvas.zoomed",
} as const;

export function BpmnEditor({
  xml,
  locale,
  projectId,
  versionId,
  versionNumber,
  projectTitle,
  onSaved,
}: {
  xml: string;
  locale: Locale;
  projectId: string;
  versionId: string;
  versionNumber: number;
  projectTitle: string;
  onSaved?: (id: string, number: number) => void;
}) {
  const handleActivity = useCallback(
    (activity: BpmnEditorActivity) => {
      if (activity in activityEvents) {
        track(activityEvents[activity as keyof typeof activityEvents], {
          projectId,
          versionId,
        });
        return;
      }
      if (activity === "document.loaded") {
        track("canvas.loaded", {
          projectId,
          versionId,
          payload: { result: "success" },
        });
        return;
      }
      if (activity === "document.import_failed") {
        track("canvas.import", {
          projectId,
          versionId,
          payload: { result: "failure", error_class: "import_error" },
        });
        return;
      }
      if (activity.startsWith("document.export_"))
        track(`diagram.${activity.slice("document.".length)}`, {
          projectId,
          versionId,
        });
    },
    [projectId, versionId],
  );

  const save = useCallback(
    async (editedXml: string): Promise<BpmnEditorSaveResult> => {
      const response = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: editedXml,
      });
      const body = (await response.json()) as {
        ok: boolean;
        versionId?: string;
        versionNumber?: number;
        error?: string;
      };
      if (!response.ok || !body.versionId || !body.versionNumber)
        return {
          ok: false,
          status: body.error ?? t(locale, "editor.saveError"),
        };
      track("canvas.version_saved", {
        projectId,
        versionId: body.versionId,
        payload: { result: "success" },
      });
      onSaved?.(body.versionId, body.versionNumber);
      return {
        ok: true,
        status: t(locale, "editor.historyBaselineSaved", {
          number: body.versionNumber,
        }),
      };
    },
    [locale, onSaved, projectId],
  );

  return (
    <BpmnEditorCore
      xml={xml}
      locale={locale}
      revisionNumber={versionNumber}
      documentTitle={projectTitle}
      onActivity={handleActivity}
      onSave={save}
    />
  );
}
