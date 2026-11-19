# QuizKatalyst

QuizKatalyst is an open-source, personalized AI tutor. It combines streamed AI tutoring, document-grounded learning, quizzes, study-material generation, interactive canvases, and a persistent learner model.

The application can use **Groq Cloud** for fast inference or **Ollama** as a private local-model fallback. API keys stay in the backend and are never exposed to the browser.

## Main capabilities

- **Open Tutor:** general tutoring without an uploaded source.
- **Source Focus:** answers restricted to uploaded PDF, text, or Markdown files.
- **Quiz Studio:** source-grounded quizzes for a complete document or selected PDF pages, with learner-selected difficulty and AI-managed concept coverage.
- **Material Studio:** personalized study guides, revision notes, quick references, flashcards, source proof, micro-checks, and alternative explanations.
- **Learning Paths:** full-source concept extraction, prerequisite mapping, importance ranking, coverage auditing, and next-step recommendations.
- **Interactive Visual Lab:** draggable concept maps, guided steps, live variables, predictions, comparisons, chemistry tools, math explorers, and an embedded canvas tutor.
- **Chat workspace:** streamed responses, conversation history, chat renaming, pinning, and deletion.

## Closed-loop adaptive learning

QuizKatalyst keeps teaching decisions separate from language generation:

```text
Student activity
      ↓
Evidence classification
      ↓
Per-concept learner model
      ↓
Adaptive orchestrator
      ↓
Next teaching action
      ↓
New assessed evidence
```

The orchestrator can establish a diagnostic baseline, explain an idea, repair a misconception, rebuild a weak prerequisite, provide guided practice, test application or transfer, schedule spaced retrieval, or advance to a deeper concept.

Evidence is weighted by reliability:

| Evidence | Weight | Examples |
| --- | --- | --- |
| Strong | High | Assessed chat answers, quizzes, verified chemistry predictions |
| Moderate | Medium | Explicit confusion, alternative-explanation requests, learner feedback |
| Weak | Low | Canvas exploration and self-reported understanding |

Canvas clicks and movement can guide the next explanation, but they never count as proof of mastery. The system does not continuously retrain the language model; it adapts a private learner state and teaching policy for each user.

## Project structure

```text
QuizKatalyst/
├── frontend/                 React + Vite interface
│   └── src/
│       ├── main.jsx          Chat, quiz, materials, canvas and learner UI
│       └── styles.css        Application design system
├── backend/                  Express API and local data store
│   ├── src/
│   │   ├── server.js         API routes and feature integration
│   │   ├── adaptive-orchestrator.js
│   │   ├── learner-model.js
│   │   ├── teaching-policy.js
│   │   ├── learning-path.js
│   │   ├── source-documents.js
│   │   ├── chemistry-engine.js
│   │   └── llm-provider.js
│   ├── scripts/              Automated and integration tests
│   ├── data.json             Local chats and learner data
│   └── .env.example          Provider configuration template
└── README.md
```

## Technology

- React 18 and Vite
- React Flow for interactive learning maps
- Express for the backend API
- Groq-compatible chat completions
- Ollama local inference fallback
- Local JSON persistence
- `pdf-parse` for PDF extraction

## Run locally

Requirements: Node.js 20 or newer.

### 1. Start the backend

```bash
cd backend
npm install
cp .env.example .env
# Add GROQ_API_KEY to backend/.env, or configure Ollama.
npm run dev
```

The backend runs at `http://127.0.0.1:8787`.

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/`.

## Provider configuration

Important variables in `backend/.env`:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_TUTOR_MODEL=openai/gpt-oss-120b
GROQ_EVALUATOR_MODEL=openai/gpt-oss-20b

# Local fallback
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=phi3:latest
OLLAMA_EVALUATOR_MODEL=phi3:latest

PORT=8787
```

Never place provider keys in frontend environment variables or commit `backend/.env`.

## Testing

```bash
cd backend
npm test                 # Complete backend suite
npm run test:orchestrator

cd ../frontend
npm run build
```

Tests cover learner-state updates, teaching policies, 14 orchestrator scenarios, quiz-to-mastery integration, duplicate quiz protection, Groq streaming retries, chemistry behavior, document processing, and learning paths.

## Privacy and safety

- Learner history is stored locally in `backend/data.json`.
- One student’s memory is not written into shared model weights.
- Source Focus refuses to use information outside uploaded material.
- Generic simulations are labeled conceptual.
- Verified domain engines are used where deterministic correctness is required.
- Unsupported chemistry combinations are rejected rather than guessed.

## Current development priorities

1. First-run provider selection for Groq or local Ollama.
2. User accounts and a production database for multi-user deployment.
3. More deterministic plugins for mathematics, physics, finance, and science.
4. Learner-profile and study-history export/import.
5. Accessibility, performance, and model-qualification benchmarks.
