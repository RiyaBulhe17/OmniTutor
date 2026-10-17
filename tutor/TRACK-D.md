# Track D implementation notes

## Architecture

Folio is a local web application served by `server.mjs`. The browser owns the interface, saved study aids, learning history, and original-source files. The server provides:

- Local extraction for PDF, DOCX, PPTX, TXT, Markdown, and CSV via `ingest.mjs`.
- Consent-gated Gemini extraction for image, audio, video, and scanned PDF inputs.
- Optional, consent-gated PDF figure analysis and PPTX embedded-image analysis, with the resulting excerpts labeled to a page or slide.
- The Gemini AI proxy and configured Ollama fallback. API credentials remain on the local server.

`retrieval.mjs` ranks source sentences for a question and returns their source labels. Tutor responses use those excerpts as context; when the lexical retriever finds no evidence, Folio refuses to generate a grounded answer. Exact citations are accepted only when they match retrieved evidence, including when an answer draws on multiple cited sources. Study-aid generation and quiz creation use the selected AI provider. A separate verification pass checks each generated answer key against its cited excerpts; when Gemini is available it uses a different Gemini model from the generator. Folio does not start a set if any result fails or the verifier output is incomplete. Citation labels retain page, slide, or timestamp locations; PDF and media citations can open the locally stored original in the content view.

Optional AI feedback for short answers is requested only when the learner clicks the clearly disclosed button. It sends that answer and the cited excerpt to the selected provider, returns formative feedback, and does not write a grade or update the learner model. Objective quiz scores exclude short-answer self-checks; historical scores from before this separation are labeled as unclassified.

`learner-model.mjs` stores quiz and self-report evidence separately and updates a cautious BKT-style mastery estimate. That estimate drives review timing and recommendations. Observed quiz accuracy remains distinct from estimated mastery in the UI.

## Learner-model assumptions

The model initializes a new topic at 0.2 mastery and uses fixed learning, guessing, and slip probabilities. Quiz responses update the model more strongly than learner self-reports. A self-report is not treated as an objectively correct answer. Due-review dates use an increasing interval based on the estimate and recent evidence.

These values are design assumptions, not parameters fitted on a representative student dataset. The estimate is a prototype signal for recommendations, not a validated measure of knowledge or learning gain. A real evaluation would need consented learner data, a comparison protocol, and human review.

## Evaluation

Run `npm run eval` for deterministic retrieval checks and `npm run eval:personalization` for synthetic profile simulations. `npm run eval:live` additionally requests model answers and model-judged faithfulness, answer relevancy, and citation accuracy; it requires a running server and a working AI provider.

The current retrieval-only [report](./evaluation/report.json) measures context precision 1.0, context recall 1.0, and off-material refusal 1.0 on two negative examples. Its three synthetic profiles show average estimated mastery gain 0.605 and question repetition 0.222. The latest live [report](./evaluation/live-report.json) records Gemini as the answer and judge provider for all seven answerable cases, with faithfulness, answer relevancy, and both cited-label measures at 1.0. The raw model citation-line format did not use square brackets, but Folio normalizes exact retrieved labels into source buttons. These small curated checks do not establish user learning outcomes, and the optional LLM judge is not an independent human evaluator. Do not present these proxy results as a formal RAGAS, DeepEval, or TruLens score.

## Suggested 5–7 minute demo

For a timed narration script and on-screen directions, see [DEMO-SCRIPT.md](./DEMO-SCRIPT.md). The walkthrough below is a longer feature checklist.

1. **Workspace (30 seconds):** Open Folio and explain that materials and learning progress are stored locally in the browser.
2. **Ingestion (60–90 seconds):** Upload a text-based PDF or slide deck. Show the extracted page/slide label and open a citation. For a cloud-only format, show the per-upload Gemini consent prompt and explain that declining skips cloud extraction.
3. **Grounded tutor (60 seconds):** Ask a question covered by the uploaded material, point out its source citation, then ask an unrelated question to demonstrate the evidence gate.
4. **Study aids (60 seconds):** Generate a concise summary or detailed notes, open its card, show its citation, and use Speak aloud or Print / Save as PDF.
5. **Adaptive practice (60–90 seconds):** Create a short quiz, note the separate answer-key verification pass, submit answers, review missed concepts, and show how observed accuracy, estimated mastery, and the next-step suggestion are distinct signals. For a short answer, point out that optional AI feedback is sent only after clicking its disclosed button and is not an objective grade.
6. **Language and audio (30 seconds):** Change the tutor language to Hindi or Hinglish; optionally dictate a question and enable spoken replies. Explain that browser speech recognition may send audio to its provider.
7. **Orbit and planning (60 seconds):** Select multiple orbit nodes, show each node's explanation and its matching source excerpts, then show a recommended study session.
8. **Evaluation and caveats (30 seconds):** Run the deterministic checks and explain that the synthetic results are smoke tests, not a human-validated study.

Use sample material that is safe to share with the configured providers. Rotate any API key previously pasted into chat before the demo, and place its replacement only in the local ignored `.env` file.

## Known limits before claiming full compliance

- The retrieval method is lexical rather than semantic and may miss valid paraphrases.
- The benchmark and learner profiles are synthetic; there is no human-validated learning-outcome study.
- AI short-answer feedback is formative only; it is not a calibrated or objective grade, and a learner's self-check is kept separate from objective quiz scores. Hindi and Hinglish are supported for tutor replies, not a comprehensive multilingual localization workflow.
- Voice input and read-aloud depend on browser speech support, microphone permission, and installed voices. Browser recognition may process audio with its own speech service.
- PDF page previews and media seeking depend on the browser's support for those original formats; DOCX/PPTX source labels are preserved and the original can be downloaded. Optional image analysis may miss content or misread a visual; verify important interpretations against the original.
- The demo walkthrough is provided, but a recorded 3–10 minute demo video is a separate deliverable.
