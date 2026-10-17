import { strFromU8, unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_EXTRACTED_CHARS = 60_000;

function decodeXml(value) {
  return value
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<a:br\b[^>]*\/>/g, "\n")
    .replace(/<\/(?:w:p|a:p)>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function requireArchiveEntry(archive, path) {
  const entry = archive[path];
  if (!entry) throw new Error(`The Office file is missing ${path}.`);
  return strFromU8(entry);
}

function extractDocx(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const xml = requireArchiveEntry(archive, "word/document.xml");
  const content = decodeXml(xml);
  if (!content) throw new Error("No readable text was found in this Word document.");
  return [{ location: "document", content }];
}

function extractPptx(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const slidePaths = Object.keys(archive)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((first, second) => Number(first.match(/slide(\d+)/)[1]) - Number(second.match(/slide(\d+)/)[1]));
  if (!slidePaths.length) throw new Error("No slides were found in this PowerPoint file.");
  const slides = slidePaths
    .map((path, index) => ({
      location: `slide ${index + 1}`,
      content: decodeXml(requireArchiveEntry(archive, path)),
    }))
    .filter((slide) => slide.content);
  if (!slides.length) throw new Error("No readable slide text was found in this PowerPoint file.");
  return slides;
}

async function extractPdf(buffer) {
  let loadingTask;
  let document;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      stopAtErrors: true,
    });
    document = await loadingTask.promise;
    const pages = [];
    let totalChars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const content = text.items
        .map((item) => typeof item.str === "string" ? item.str : "")
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!content) continue;
      totalChars += content.length;
      if (totalChars > MAX_EXTRACTED_CHARS) {
        throw new Error("This PDF contains more than 60,000 characters of extracted text. Split it into smaller files.");
      }
      pages.push({ location: `page ${pageNumber}`, content });
    }
    return pages;
  } catch (error) {
    if (error instanceof Error && error.message.includes("60,000 characters")) throw error;
    throw new Error(`This PDF could not be read locally: ${error.message}`);
  } finally {
    await loadingTask?.destroy();
  }
}

export async function extractLocalFile({ name, mimeType, buffer }) {
  const extension = name.toLowerCase().split(".").pop();
  let segments;
  if (mimeType === "application/pdf" || extension === "pdf") {
    segments = await extractPdf(buffer);
  } else if (extension === "docx") {
    segments = extractDocx(buffer);
  } else if (extension === "pptx") {
    segments = extractPptx(buffer);
  } else if (["txt", "md", "markdown", "csv"].includes(extension)) {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/\0/g, "").trim();
    if (!content) throw new Error("This file is empty.");
    segments = [{ location: "document", content }];
  } else {
    throw new Error("This file format is not supported for local extraction.");
  }
  const totalChars = segments.reduce((total, segment) => total + segment.content.length, 0);
  if (totalChars > MAX_EXTRACTED_CHARS) {
    throw new Error("This file contains more than 60,000 characters of extracted text. Split it into smaller files.");
  }
  return segments;
}

export const localExtractionLimits = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  maxExtractedChars: MAX_EXTRACTED_CHARS,
});
