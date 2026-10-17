# Folio — personalized learning companion

Folio is a local-first study workspace for **Track D: Personalized Tutoring & Adaptive Learning**. It combines source-grounded tutoring, learning materials, adaptive practice, a topic orbit, and a goal-based study plan.

## Run Folio

1. Install Node.js.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to your Google AI Studio key. Keep `.env` private; it is ignored by Git.
3. Optionally install Ollama and run `.\install-models.ps1` to set up local fallback models.
4. Run `npm start`. The app opens at <http://127.0.0.1:5173>.
5. Keep the terminal open while using the app; press Ctrl+C to stop the server. Materials and settings stay in the browser.

The server uses the `fflate` and `pdfjs-dist` packages declared in `package.json`; run `npm install` after checkout.

## Materials, privacy, and citations

- Add notes and links, or upload PDF, DOCX, PPTX, TXT, Markdown, CSV, image, audio, and video files. PDF/DOCX/PPTX and text extraction runs locally. For readable PDFs and slide decks, you can separately consent to Gemini inspecting diagrams and embedded images; for decks, only extracted image assets are sent. The browser keeps the original file locally where supported, so opening a PDF citation can show its page; audio/video citations seek to the referenced time. Office-file citations preserve slide/page labels and offer the original for download.
- Remove individual materials from the source library with **Remove**. For uploads split into multiple excerpts, Folio keeps the local original until its final excerpt is removed.
- Images, audio, video, and scanned PDFs require Google Gemini extraction. Folio asks for permission for each such upload and the server rejects extraction without the explicit consent flag. The server does not store the submitted file. Optional PDF/slide visual analysis also requires consent and sends the PDF or extracted slide images to Google.
- Tutor prompts and relevant excerpts are sent to the selected AI provider when you ask a question. For optional short-answer feedback, Folio sends the answer and its cited excerpt only after you click **Get AI feedback**; this formative feedback is not saved as a grade or used to update mastery. Ollama may be used as the configured backup provider.
- Imported excerpts retain page, slide, or timestamp labels and are used as evidence for tutoring and study-aid citations. A lexical retrieval gate refuses to generate a tutor answer if it cannot find relevant saved evidence. This gate is intentionally conservative and can miss paraphrases.
- Extracted text is limited to 60,000 characters across the saved study context. Each upload is limited to 15 MB and the selected batch to 30 MB.
- Original files are stored in browser IndexedDB for source previews; extracted text and study settings use browser storage. Clear Folio's browser data to remove saved materials. Do not upload confidential material unless you are comfortable sending the consented formats to Google.

## AI providers

Gemini is the primary provider, using Flash-Lite by default for faster responses. The local Node server reads the API key from `.env`; it is not sent to the browser or saved in browser preferences. Ollama is an optional automatic backup. If Gemini is unavailable, Folio tries the configured Ollama model; if both fail, it reports the provider errors.

Install Ollama using its official Windows installer, then run:

```powershell
.\install-models.ps1
.\check-models.ps1
```

Choose Gemini and Ollama models in **AI provider settings**. `OLLAMA_BASE_URL` can be set in `.env` if Ollama is running elsewhere.

## Learning features

- Generate source-cited summaries, detailed notes with selectable/custom page targets, and cheat sheets. Saved aids open as cards and can be printed or saved as PDF.
- Read a selected note aloud using the browser's speech engine; playback and voice selection do not upload audio.
- Choose English, Hindi, or Hinglish for tutor replies. Voice input can dictate a question and optionally read replies aloud; browser speech recognition may send audio to the browser's speech service, while Folio itself does not upload recordings to its server.
- Use configurable quizzes, review explanations and missed concepts, and see observed topic accuracy.
- Request optional, source-based AI feedback on a short answer. It is labeled formative, is not treated as an objective grade, and does not affect quiz scores or mastery; use **Compare with the source** to self-assess separately.
- Run every generated assessment through a separate source-only answer-key verification pass before starting it. Unsupported, ambiguous, or incorrect questions block the set rather than silently updating the learner model.
- Folio estimates topic mastery with a cautious Bayesian Knowledge Tracing-style model. Quiz responses have more weight than explicit tutoring self-reports; the model also schedules review and informs recommendations. This is an estimate, not a validated educational or clinical assessment.
- Explore the interactive topic orbit. Topics and material nodes show their own explanation and matching saved excerpts; supported videos play in the embedded player.
- Create exam-date study plans and track sessions.

## Checks and evaluation

```powershell
npm test
npm run check
npm run eval
npm run eval:personalization
# With Folio running and an AI provider configured:
npm run eval:live -- --out=evaluation/live-report.json
```

The deterministic retrieval benchmark uses a small synthetic dataset and includes off-material questions. The current report in [evaluation/report.json](./evaluation/report.json) records context precision 1.0, context recall 1.0, and off-material refusal 1.0 across two synthetic off-material cases; its simulated profiles report average estimated mastery gain 0.605 and question repetition 0.222. These are engineering checks on a small curated set, **not** representative learning-outcome results. `npm run eval:live` additionally runs model answers and an LLM judge, requires a running Folio server and a configured provider, and is not a substitute for human review or a formal RAGAS/DeepEval/TruLens evaluation.

The latest live run is saved in [evaluation/live-report.json](./evaluation/live-report.json). Gemini answered and judged all seven answerable cases. The report records faithfulness 1.0, answer relevancy 1.0, LLM-judged citation accuracy 1.0, annotated-label citation accuracy 1.0, and unsupported-answer rate 0.0. Gemini omitted the requested square brackets in its raw citation lines, but Folio now accepts only exact labels from retrieved evidence and renders them as source buttons; raw bracket-format compliance was 0.0. These are small-sample LLM-judged results and require human review.

For the architecture, model assumptions, evaluation caveats, and a demo run-through, see [TRACK-D.md](./TRACK-D.md).

For a ready-to-read, four-minute Track D narration with screen cues, see [DEMO-SCRIPT.md](./DEMO-SCRIPT.md).
