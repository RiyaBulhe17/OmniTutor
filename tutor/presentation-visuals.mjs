import { strFromU8, unzipSync } from "fflate";
import { posix } from "node:path";

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`));
  return match?.[1] ?? match?.[2] ?? "";
}

function slideNumber(path) {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

export function extractPresentationImages(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const slidePaths = Object.keys(archive)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((first, second) => slideNumber(first) - slideNumber(second));
  const images = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const path of slidePaths) {
    const slideXml = strFromU8(archive[path]);
    const slide = slideNumber(path);
    const relationshipsPath = `ppt/slides/_rels/slide${slide}.xml.rels`;
    const relationshipXml = archive[relationshipsPath] ? strFromU8(archive[relationshipsPath]) : "";
    const imageRelationships = new Map();
    for (const match of relationshipXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = match[0];
      const id = attribute(tag, "Id");
      const target = attribute(tag, "Target").replace(/&amp;/g, "&");
      const type = attribute(tag, "Type");
      if (!id || !target || !type.endsWith("/image") || /TargetMode=["']External["']/.test(tag)) continue;
      const archivePath = posix.normalize(posix.join("ppt/slides", target.replace(/^\/+/, "")));
      if (archivePath.startsWith("ppt/media/")) imageRelationships.set(id, archivePath);
    }

    let imageIndex = 0;
    for (const embed of slideXml.matchAll(/\br:embed=["']([^"']+)["']/g)) {
      const archivePath = imageRelationships.get(embed[1]);
      if (!archivePath || seen.has(`${slide}:${archivePath}`)) continue;
      seen.add(`${slide}:${archivePath}`);
      const extension = archivePath.split(".").pop()?.toLowerCase();
      const mimeType = IMAGE_TYPES.get(extension);
      const data = archive[archivePath];
      if (!mimeType || !data?.length) continue;
      if (images.length >= MAX_IMAGES || totalBytes + data.length > MAX_IMAGE_BYTES) {
        throw new Error("This slide deck has too many or too-large embedded images for one consented analysis. Split it or upload selected images separately.");
      }
      totalBytes += data.length;
      imageIndex++;
      images.push({
        location: `slide ${slide} · image ${imageIndex}`,
        mimeType,
        data,
      });
    }
  }
  return images;
}
