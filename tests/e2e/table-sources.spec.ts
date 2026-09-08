import { expect, test } from "@playwright/test";
import {
  makeDocx,
  makeXlsx,
  wordCell,
  wordDocument,
  wordRow,
} from "../fixtures/ooxml";

async function loginAndCreate(page: import("@playwright/test").Page) {
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Project title").fill(`Table UI ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
}

const docx = () =>
  makeDocx(
    wordDocument(
      `<w:tbl>${wordRow([
        wordCell(["Stage"]),
        wordCell(["Owner"]),
        wordCell(["Input"]),
        wordCell(["Action"]),
        wordCell(["Result"]),
        wordCell(["Handoff"]),
      ])}${wordRow([
        wordCell(["Receive"]),
        wordCell(["Clerk"]),
        wordCell(["Request"]),
        wordCell(["Check"]),
        wordCell(["Open"]),
        wordCell(["Review"]),
      ])}</w:tbl>`,
    ),
  );

const xlsx = () =>
  makeXlsx({
    sheets: [
      {
        name: "Handoffs",
        xml: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Stage</t></is></c><c r="B1" t="inlineStr"><is><t>Owner</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Archive</t></is></c><c r="B2" t="inlineStr"><is><t>Records</t></is></c></row></sheetData></worksheet>`,
      },
    ],
  });

test("uploads CSV, DOCX, and XLSX with table badges, explicit selection, provenance, and RU/EN copy", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginAndCreate(page);
  const picker = page.getByLabel("Choose audio, images, or tables");
  await expect(
    page.getByText(/Rows, columns, tables, and sheet order are preserved/),
  ).toBeVisible();
  await picker.setInputFiles([
    {
      name: "steps.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Stage,Owner\nReceive,Clerk"),
    },
    {
      name: "matrix.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(docx()),
    },
    {
      name: "handoffs.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(xlsx()),
    },
  ]);
  await page.getByRole("button", { name: "Confirm 3 files" }).click();

  await expect(page.getByText("steps.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("CSV table", { exact: true })).toBeVisible();
  await expect(page.getByText("Word table", { exact: true })).toBeVisible();
  await expect(page.getByText("Excel workbook", { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: /Use steps\.csv/ }).uncheck();
  await page.getByRole("checkbox", { name: /Use matrix\.docx/ }).uncheck();
  await page.getByRole("checkbox", { name: /Use handoffs\.xlsx/ }).check();
  const preflight = page.getByRole("region", { name: "Generation preflight" });
  await expect(preflight).toContainText("1 source");
  await expect(preflight).toContainText("handoffs.xlsx · Excel workbook");
  await expect(preflight).toContainText("Output remains BPMN 2.0");
  await page.getByRole("button", { name: "Generate version 1" }).click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    page.getByLabel("Version").locator("option:checked"),
  ).toContainText(/handoffs\.xlsx · Excel workbook/);

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(page.getByText("книга Excel", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Строки, столбцы, таблицы и порядок листов сохраняются/),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});

test("shows safe actionable errors for unsupported, mismatched, and malformed table files", async ({
  page,
}) => {
  await loginAndCreate(page);
  const picker = page.getByLabel("Choose audio, images, or tables");

  await picker.setInputFiles({
    name: "legacy.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("legacy"),
  });
  await page.getByRole("button", { name: "Confirm 1 file" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Only CSV, DOCX, and XLSX table files are supported",
  );

  await picker.setInputFiles({
    name: "mismatch.csv",
    mimeType: "application/pdf",
    buffer: Buffer.from("A,B\n1,2"),
  });
  await page.getByRole("button", { name: "Confirm 1 file" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "file type does not match its extension",
  );

  await picker.setInputFiles({
    name: "broken.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK-not-an-office-archive"),
  });
  await page.getByRole("button", { name: "Confirm 1 file" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "unsafe or malformed Office archive",
  );
});

test("table upload controls remain keyboard-accessible at a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndCreate(page);
  const picker = page.getByLabel("Choose audio, images, or tables");
  await picker.focus();
  await expect(picker).toBeFocused();
  await expect(page.locator(".source-rail")).toHaveCSS("overflow-y", "auto");
});
