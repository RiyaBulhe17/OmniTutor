import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPresentationImages } from "./presentation-visuals.mjs";
import { extractLocalFile, localExtractionLimits } from "./ingest.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const maxRequestBytes = 1_000_000;
const maxUploadRequestBytes = 21 * 1024 * 1024;
const allowedGeminiModels = new Set(["gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-3.1-pro-preview"]);
const allowedOllamaModels = new Set(["qwen2.5:7b", "qwen2.5:3b", "llama3.2:3b"]);
const multimodalMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "audio/aac", "audio/flac", "audio/mp3", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav",
  "video/3gpp", "video/avi", "video/mp2t", "video/mp4", "video/mpeg", "video/quicktime",
  "video/webm", "video/x-flv", "video/x-ms-wmv",
]);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

async function loadEnvironmentFile() {
  let contents;
  try {
    contents = await readFile(resolve(root, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maxBytes = maxRequestBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("The AI request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("The AI request must contain valid JSON."), { status: 400 });
  }
}

async function readBinaryBody(request, maxBytes = localExtractionLimits.maxFileBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Choose a file smaller than 15 MB."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function extractWithGemini({ model, mimeType, base64, name, purpose = "all" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Gemini is not configured. Add GEMINI_API_KEY to .env and restart Folio."), { status: 503 });
  if (!allowedGeminiModels.has(model)) throw Object.assign(new Error("Choose a supported Gemini model in Folio settings."), { status: 400 });

  const schema = {
    type: "OBJECT",
    required: ["segments"],
    properties: {
      segments: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["location", "content"],
          properties: {
            location: { type: "STRING" },
            content: { type: "STRING" },
          },
        },
      },
    },
  };
  const prompt = purpose === "visuals"
    ? [
      "Inspect the attached PDF for study-relevant information that is conveyed by diagrams, charts, figures, tables, or image labels rather than ordinary body paragraphs.",
      "Return only information visible in those visual elements. Do not restate ordinary paragraph text, infer missing data, or add outside knowledge.",
      "Return JSON only in the supplied schema. Preserve visual reading order and keep each segment short.",
      "Use the PDF page index (for example 'page 4') so the excerpt opens the correct PDF page, even if a printed page label differs.",
      "Describe relationships, labels, axes, and trends only when they are legible. Omit anything unclear rather than guessing.",
      "Keep each segment under 2500 characters and return no more than 80 segments.",
      `Original filename: ${name}`,
    ].join("\n")
    : [
      "Extract study-relevant information from the attached learner-owned file.",
      "Return JSON only in the supplied schema. Do not add facts, interpretations, explanations, or outside knowledge.",
      "Preserve the original order and split content into short, readable segments.",
      "For PDFs, use the PDF page index (for example 'page 4') so the excerpt opens the correct PDF page, even if a printed page label differs.",
      "For audio and video, create concise transcript/explanation segments with approximate timestamps in MM:SS.",
      "For images, use 'image' as the location. For any content you cannot read or hear, omit it rather than guessing.",
      "Keep each segment under 2500 characters and return no more than 80 segments.",
      `Original filename: ${name}`,
    ].join("\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: 8192,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error(`Gemini returned an unreadable extraction response (HTTP ${response.status}).`), { status: 502 });
  }
  if (!response.ok) {
    const message = payload?.error?.message;
    throw Object.assign(
      new Error(typeof message === "string" ? `Gemini extraction failed: ${message}` : `Gemini extraction failed (HTTP ${response.status}).`),
      { status: 502 },
    );
  }
  const content = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!content) throw Object.assign(new Error("Gemini could not extract usable text from this file."), { status: 422 });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw Object.assign(new Error("Gemini returned invalid extraction data. Try a smaller file or another format."), { status: 502 });
  }
  if (!Array.isArray(parsed.segments) || parsed.segments.length > 80
    || parsed.segments.some((segment) =>
      typeof segment.location !== "string" || !segment.location.trim() || segment.location.length > 120
      || typeof segment.content !== "string" || !segment.content.trim() || segment.content.length > 2500
    )) {
    throw Object.assign(new Error("Gemini returned incomplete or oversized extraction data."), { status: 502 });
  }
  return parsed.segments;
}

async function extractPresentationVisualsWithGemini({ model, name, buffer }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Gemini is not configured. Add GEMINI_API_KEY to .env and restart Folio."), { status: 503 });
  if (!allowedGeminiModels.has(model)) throw Object.assign(new Error("Choose a supported Gemini model in Folio settings."), { status: 400 });
  const images = extractPresentationImages(buffer);
  if (!images.length) return [];
  const locations = images.map((image) => image.location);
  const parts = [{
    text: [
      "Describe study-relevant content visible in the attached images extracted from a student-owned PowerPoint deck.",
      "Use only the pixels in each image. Do not repeat slide body text, infer missing information, or add outside knowledge.",
      "Return a short segment for each readable diagram, chart, or figure. Use the exact slide/image location label supplied immediately before that image.",
      "Describe relationships, labels, axes, and trends only when legible. Omit unclear details rather than guessing.",
      "Return JSON only in the supplied schema. Keep each segment under 2500 characters.",
      `Original filename: ${name}`,
    ].join("\n"),
  }];
  for (const image of images) {
    parts.push(
      { text: `Embedded visual location: ${image.location}` },
      { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64") } },
    );
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["segments"],
            properties: {
              segments: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  required: ["location", "content"],
                  properties: {
                    location: { type: "STRING" },
                    content: { type: "STRING" },
                  },
                },
              },
            },
          },
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error(`Gemini returned an unreadable visual-analysis response (HTTP ${response.status}).`), { status: 502 });
  }
  if (!response.ok) {
    const message = payload?.error?.message;
    throw Object.assign(
      new Error(typeof message === "string" ? `Gemini visual analysis failed: ${message}` : `Gemini visual analysis failed (HTTP ${response.status}).`),
      { status: 502 },
    );
  }
  const text = payload?.candidates?.[0]?.content?.parts
    ?.filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  let parsed;
  try {
    parsed = JSON.parse(text || "");
  } catch {
    throw Object.assign(new Error("Gemini returned invalid presentation visual data."), { status: 502 });
  }
  if (!Array.isArray(parsed.segments) || parsed.segments.length > 80
    || parsed.segments.some((segment) =>
      typeof segment.location !== "string" || !locations.includes(segment.location)
      || typeof segment.content !== "string" || !segment.content.trim() || segment.content.length > 2500
    )) {
    throw Object.assign(new Error("Gemini returned incomplete or oversized presentation visual data."), { status: 502 });
  }
  return parsed.segments;
}

async function handleFileExtraction(request, response) {
  let body;
  try {
    body = await readJsonBody(request, maxUploadRequestBytes);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }

  if (!body || typeof body !== "object" || typeof body.name !== "string"
    || typeof body.mimeType !== "string" || typeof body.data !== "string") {
    sendJson(response, 400, { error: "The upload is missing its filename, type, or file data." });
    return;
  }
  if (!body.consented) {
    sendJson(response, 403, { error: "Gemini processing requires your explicit consent for this upload." });
    return;
  }
  if (!multimodalMimeTypes.has(body.mimeType)) {
    sendJson(response, 415, { error: "Gemini extraction does not support this file type. Folio can locally read PDF, DOCX, PPTX, TXT, Markdown, and CSV files." });
    return;
  }
  const purpose = body.purpose || "all";
  const isPresentation = body.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (!["all", "visuals", "pptx-visuals"].includes(purpose)
    || (purpose === "visuals" && body.mimeType !== "application/pdf")
    || (purpose === "pptx-visuals" && !isPresentation)
    || (isPresentation && purpose !== "pptx-visuals")) {
    sendJson(response, 400, { error: "Visual extraction is available only for consented PDF or PowerPoint uploads." });
    return;
  }
  const data = body.data.replace(/^data:[^,]+;base64,/, "");
  if (!data || data.length > Math.ceil(localExtractionLimits.maxFileBytes * 4 / 3)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    sendJson(response, 413, { error: "Choose a file smaller than 15 MB." });
    return;
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > localExtractionLimits.maxFileBytes
    || bytes.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) {
    sendJson(response, 413, { error: "The upload is empty, invalid, or larger than 15 MB." });
    return;
  }
  try {
    const segments = purpose === "pptx-visuals"
      ? await extractPresentationVisualsWithGemini({
        model: body.model,
        name: body.name.slice(0, 200),
        buffer: bytes,
      })
      : await extractWithGemini({
        model: body.model,
        mimeType: body.mimeType,
        base64: bytes.toString("base64"),
        name: body.name.slice(0, 200),
        purpose,
      });
    sendJson(response, 200, { segments, provider: "gemini" });
  } catch (error) {
    sendJson(response, error.status || 502, { error: error.message });
  }
}

async function handleLocalFileExtraction(request, response) {
  let name;
  try {
    name = decodeURIComponent(request.headers["x-folio-filename"] || "");
  } catch {
    sendJson(response, 400, { error: "The upload filename is invalid." });
    return;
  }
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    sendJson(response, 400, { error: "The upload filename is missing or invalid." });
    return;
  }
  let buffer;
  try {
    buffer = await readBinaryBody(request);
    if (!buffer.length) throw Object.assign(new Error("The uploaded file is empty."), { status: 400 });
    const segments = await extractLocalFile({ name, mimeType: request.headers["content-type"], buffer });
    sendJson(response, 200, { segments, provider: "local" });
  } catch (error) {
    sendJson(response, error.status || 422, { error: error.message });
  }
}

async function getOllamaModels() {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models.map((model) => model.name).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["additionalProperties", "minItems", "maxItems", "minLength", "maxLength"].includes(key)) continue;
    if (key === "type" && typeof value === "string") {
      result[key] = value.toUpperCase();
    } else {
      result[key === "oneOf" ? "anyOf" : key] = geminiSchema(value);
    }
  }
  return result;
}

async function generateWithGemini(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!allowedGeminiModels.has(body.model)) throw new Error("Choose a supported Gemini model in Folio settings.");
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("The AI request has no messages.");

  const systemText = body.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = body.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content || "") }],
    }));
  if (!contents.length) throw new Error("The AI request has no user message.");

  const generationConfig = {};
  if (Number.isInteger(body.maxOutputTokens)) {
    generationConfig.maxOutputTokens = Math.max(256, Math.min(body.maxOutputTokens, 8192));
  }
  if (body.format || body.json) {
    generationConfig.responseMimeType = "application/json";
    if (body.format && typeof body.format === "object") {
      generationConfig.responseSchema = geminiSchema(body.format);
    }
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents,
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Gemini returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = payload?.error?.message;
    throw new Error(typeof message === "string" ? `Gemini: ${message}` : `Gemini returned HTTP ${response.status}.`);
  }
  const content = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!content) throw new Error("Gemini returned no usable text.");
  return content;
}

async function generateWithOllama(body) {
  if (!allowedOllamaModels.has(body.fallbackModel)) throw new Error("Choose a supported Ollama backup model in Folio settings.");
  const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: body.fallbackModel,
      messages: body.messages,
      stream: false,
      ...(Number.isInteger(body.maxOutputTokens)
        ? { options: { num_predict: Math.max(256, Math.min(body.maxOutputTokens, 8192)) } }
        : {}),
      ...(body.format ? { format: body.format } : body.json ? { format: "json" } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Ollama returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(payload?.error || `Ollama returned HTTP ${response.status}.`);
  const content = payload?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Ollama returned an empty answer.");
  return content.trim();
}

async function handleAiRequest(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }
  const commonError = !body || typeof body !== "object"
    || !Array.isArray(body.messages)
    || typeof body.model !== "string"
    || typeof body.fallbackModel !== "string";
  if (commonError) {
    sendJson(response, 400, { error: "The AI request is missing its model, backup model, or messages." });
    return;
  }

  let geminiError = null;
  if (process.env.GEMINI_API_KEY) {
    try {
      const content = await generateWithGemini(body);
      sendJson(response, 200, { content, provider: "gemini" });
      return;
    } catch (error) {
      geminiError = error;
      console.warn("Gemini request failed; trying the configured Ollama backup:", error.message);
    }
  } else {
    geminiError = new Error("GEMINI_API_KEY is not configured.");
  }

  try {
    const content = await generateWithOllama(body);
    sendJson(response, 200, {
      content,
      provider: "ollama",
      fallbackReason: geminiError.message,
    });
  } catch (error) {
    const reason = geminiError ? ` Gemini is unavailable: ${geminiError.message}` : "";
    sendJson(response, 502, { error: `Both AI providers failed.${reason} Ollama backup: ${error.message}` });
  }
}

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid URL.");
    return;
  }

  if (pathname === "/api/ai/status") {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed.");
      return;
    }
    const ollamaModels = await getOllamaModels();
    sendJson(response, 200, {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      ollamaModels,
    });
    return;
  }
  if (pathname === "/api/ai/chat") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed.");
      return;
    }
    await handleAiRequest(request, response);
    return;
  }
  if (pathname === "/api/ai/extract") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed.");
      return;
    }
    await handleFileExtraction(request, response);
    return;
  }
  if (pathname === "/api/files/extract-local") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed.");
      return;
    }
    await handleLocalFileExtraction(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed.");
    return;
  }

  let relativePath;
  try {
    const decodedPath = decodeURIComponent(pathname);
    relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid URL.");
    return;
  }
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden.");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const notFound = error.code === "ENOENT" || error.code === "EISDIR";
    response.writeHead(notFound ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(notFound ? "Not found." : "Could not read this file.");
    if (!notFound) console.error(`Could not serve ${filePath}:`, error);
  }
});

server.on("error", (error) => {
  console.error(`Folio could not start on http://${host}:${port}:`, error.message);
  process.exitCode = 1;
});

await loadEnvironmentFile();
server.listen(port, host, () => {
  console.log(`Folio is ready at http://${host}:${port}`);
});
