import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { extractLocalFile } from "../ingest.mjs";

function makePdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`)} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test("extracts PDF text with a page citation", async () => {
  const segments = await extractLocalFile({
    name: "lecture.pdf",
    mimeType: "application/pdf",
    buffer: makePdf("Attention connects tokens"),
  });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].location, "page 1");
  assert.match(segments[0].content, /Attention connects tokens/);
});

test("extracts DOCX paragraphs locally", async () => {
  const archive = zipSync({
    "word/document.xml": strToU8(
      '<w:document><w:body><w:p><w:r><w:t>First concept</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second &amp; related concept</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const segments = await extractLocalFile({
    name: "notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: archive,
  });
  assert.equal(segments.length, 1);
  assert.match(segments[0].content, /First concept/);
  assert.match(segments[0].content, /Second & related concept/);
});

test("extracts PowerPoint slides in numeric order and retains slide locations", async () => {
  const archive = zipSync({
    "ppt/slides/slide1.xml": strToU8("<a:p><a:r><a:t>First slide</a:t></a:r></a:p>"),
    "ppt/slides/slide2.xml": strToU8("<a:p><a:r><a:t>Second slide</a:t></a:r></a:p>"),
    "ppt/slides/slide10.xml": strToU8("<a:p><a:r><a:t>Tenth slide</a:t></a:r></a:p>"),
  });
  const segments = await extractLocalFile({
    name: "course.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: archive,
  });
  assert.deepEqual(segments.map((segment) => segment.location), ["slide 1", "slide 2", "slide 3"]);
  assert.match(segments[2].content, /Tenth slide/);
});

test("decodes UTF-8 text and rejects empty or unsupported files", async () => {
  const segments = await extractLocalFile({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Café attention"),
  });
  assert.match(segments[0].content, /Café/);
  await assert.rejects(
    extractLocalFile({ name: "blank.txt", mimeType: "text/plain", buffer: Buffer.from(" \n") }),
    /empty/i,
  );
  await assert.rejects(
    extractLocalFile({ name: "notes.doc", mimeType: "application/msword", buffer: Buffer.from("x") }),
    /not supported/i,
  );
});

test("rejects malformed PDFs with a user-readable extraction error", async () => {
  await assert.rejects(
    extractLocalFile({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") }),
    /could not be read locally/i,
  );
});
