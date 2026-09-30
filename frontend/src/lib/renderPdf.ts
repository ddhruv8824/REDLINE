// Resume JSON → PDF blob. Import this module lazily (await import("@/lib/renderPdf"))
// so React-PDF only loads when a PDF is actually needed.

import { createElement, type ReactElement } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import { ResumeDocument } from "@/components/ResumePdfTemplate";
import type { Resume } from "@/lib/tailor/types";

export async function renderResumePdf(resume: Resume, highlight?: Set<string>): Promise<Blob> {
  const doc = createElement(ResumeDocument, { resume, highlight }) as unknown as ReactElement<DocumentProps>;
  return pdf(doc).toBlob();
}
