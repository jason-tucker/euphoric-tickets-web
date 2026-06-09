# AI / LLM / RAG / Agent Safety Review

**Result: not applicable — no AI surface exists in this repository.**

This is a Next.js web frontend for a Discord ticket bot. A full inventory found
**no** LLM/model usage, embeddings, vector DB, RAG, agent/tool-calling
framework, prompt templates, or AI SDKs:

- No `openai`, `@anthropic-ai/*`, `@google/generative-ai`, `langchain`,
  `llamaindex`, `ollama`, `cohere`, `mistral`, `transformers`, `onnxruntime`,
  or vector-store packages in `package.json`.
- No model files (`*.gguf`, `*.safetensors`, `*.pt`, `*.onnx`, `*.pkl`,
  `joblib`/`torch.load`/`pickle` loads).
- No prompt templates or "system prompt" constructs.
- The only "generation" in the app is the deterministic synthetic-data
  generator under `src/server/demo/*` (seeded RNG, no model) used to populate
  the public `/demo`.

Consequently the GenAI risk classes in scope (prompt injection, indirect
injection from retrieved content, tool-calling/excessive-agency, model output
used as code/SQL/HTML, vector/memory cross-user leakage, unsafe model
downloads, cost amplification) **do not apply**.

### Adjacent note (not AI, but related to untrusted content)
Ticket bodies are untrusted user content. They are rendered by a custom
React-node markdown component (`src/components/app/discord-markdown.tsx`) with no
`dangerouslySetInnerHTML` and an `http(s)`-only autolink allowlist — so there is
no template/markup-injection sink that AI-style "untrusted-content-as-instruction"
attacks could pivot through. Covered in the main report (F-18 for the inline
remote-image privacy note).

If AI features (e.g. ticket summarization, triage suggestions) are added later,
re-run this review: separate instructions from untrusted ticket text, validate
any structured output, scope retrieval to the requesting tenant, keep ticket
PII out of prompts/logs, and gate any state-changing tool calls behind the
existing server-side permission checks.
