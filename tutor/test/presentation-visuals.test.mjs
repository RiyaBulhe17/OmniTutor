import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractPresentationImages } from "../presentation-visuals.mjs";

function makePresentation(entries) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [
    name,
    typeof content === "string" ? strToU8(content) : content,
  ])));
}

test("extracts only slide-embedded local image relationships in slide order", () => {
  const presentation = makePresentation({
    "ppt/slides/slide2.xml": '<p:sld><a:blip r:embed="rId2"/></p:sld>',
    "ppt/slides/slide1.xml": '<p:sld><a:blip r:embed="rId1"/></p:sld>',
    "ppt/slides/_rels/slide2.xml.rels": '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/second.png"/></Relationships>',
    "ppt/slides/_rels/slide1.xml.rels": '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/first.jpg"/></Relationships>',
    "ppt/media/first.jpg": new Uint8Array([1, 2, 3]),
    "ppt/media/second.png": new Uint8Array([4, 5, 6]),
    "ppt/slides/slide3.xml": '<p:sld><a:blip r:embed="rId3"/></p:sld>',
    "ppt/slides/_rels/slide3.xml.rels": '<Relationships><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>',
  });
  const images = extractPresentationImages(presentation);
  assert.deepEqual(images.map(({ location, mimeType }) => [location, mimeType]), [
    ["slide 1 · image 1", "image/jpeg"],
    ["slide 2 · image 1", "image/png"],
  ]);
  assert.deepEqual([...images[0].data], [1, 2, 3]);
});

test("returns no image data for a text-only deck", () => {
  assert.deepEqual(extractPresentationImages(makePresentation({
    "ppt/slides/slide1.xml": "<p:sld><a:t>Text only</a:t></p:sld>",
  })), []);
});
