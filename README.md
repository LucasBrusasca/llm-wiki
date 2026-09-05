# Algedi

**Local AI-powered knowledge graph with 3D semantic visualization.**  
Ingest PDFs, YouTube videos, web pages and Excel files → the system extracts concepts via LLM, builds a semantic graph, and lets you explore, query, and synthesize knowledge in 3D.

> Algedi es un producto independiente. Su evolución de producto, arquitectura objetivo y MVP
> están definidos en **[PLAN_PRODUCTO_ALGEDI.md](docs/PLAN_PRODUCTO_ALGEDI.md)**.

> 📖 **Leé la [Visión y Concepto Central →](docs/VISION.md)** — el problema profundo que ataca (la deriva del significado / *semantic satiation*), en qué se diferencia de los demos virales y de Obsidian, y hacia dónde va.
> 🏗️ **Y la [Arquitectura y Forma →](docs/ARQUITECTURA.md)** — medallón (bronze/silver/gold), el framework de conectores para sumar fuentes, y cómo escala.

---

## What it does

You drop documents into Algedi. It reads them, extracts key concepts using a local or cloud LLM, generates vector embeddings, and positions each document as a node in 3D space based on semantic similarity (UMAP). Nodes that share concepts or have high cosine similarity get connected.

From there you can:

- **Explore the graph** — rotate, zoom, switch between layout modes (UMAP / Density / Centroids)
- **Click any node** — read the AI-generated summary, concepts, and source preview
- **Ask the agent** — RAG-powered chat over your entire knowledge base, or scoped to a single node
- **Create an Issue** — describe a problem, the system finds the most relevant nodes and synthesizes an analysis
- **Synthesize** — select multiple nodes and generate an integrated summary across all of them
- **Inspect relations** — click any edge to see its *provenance*: which method computed it
  (incremental ingest vs. global recompute), what sustains it (explicit shared concepts /
  vector proximity / an unmeasured threshold), the numbers behind it (cosine, the floor it
  was compared against and whether that floor was measured on this corpus), what the score
  does **not** mean, and a human review state (confirm / reject) that survives recomputation
- **Check source freshness** — an offline pass re-hashes every local file against the
  fingerprint stored at ingest time and flags sources whose file changed or vanished.
  Age is never used as a signal: nothing is marked stale for being old. Human decisions
  are stored separately from what the system observed, and both stay visible

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Python |
| LLM | Anthropic API / Gemini API / Ollama (local) |
| Embeddings | `sentence-transformers` — `paraphrase-multilingual-MiniLM-L12-v2` (384d) |
| Dimensionality reduction | UMAP → 3D coordinates |
| Clustering | HDBSCAN |
| Frontend | React 18 + Vite |
| 3D graph | `react-force-graph-3d` (Three.js / WebGL) |
| PDF parsing | PyMuPDF |

---

## Setup

### Prerequisites
- **Docker + Docker Compose** (recommended), *or* Python 3.10+ and Node.js 18+ for the manual setup
- An LLM provider: a **Gemini** or **Anthropic** API key, *or* **Ollama** running locally

### Clone and configure

```bash
git clone https://github.com/LucasBrusasca/llm-wiki.git
cd llm-wiki
cp .env.example .env          # then edit .env (see below)
```

Edit `.env`:

```env
# Choose your LLM provider: 'gemini', 'anthropic', or 'ollama'
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash

# API keys — only needed for cloud providers
GEMINI_API_KEY=your_key_here
ANTHROPIC_API_KEY=

# For local Ollama instead:
# LLM_PROVIDER=ollama
# LLM_MODEL=qwen3.5:27b
# OLLAMA_URL=http://localhost:11434/v1/chat/completions
```

### Option A — Docker (recommended)

```bash
./start.sh           # Linux / macOS
```

On Windows, just **double-click `start.bat`**. Either one runs `docker compose up -d`
(Postgres + pgvector, FastAPI backend, Vite frontend) and opens
**http://localhost:5173** when it's ready.

> If you use a local Ollama running on the host, the backend reaches it through
> `host.docker.internal` — already wired in `docker-compose.yml`.

To stop everything: `docker compose down`.

### Option B — Manual (without Docker)

```bash
# Backend
pip install -r requirements-fastapi.txt
python main.py                       # → http://localhost:8000

# Frontend (in another terminal)
cd frontend && npm install && npm run dev   # → http://localhost:5173
```

### First run

Open `http://localhost:5173`, click **Biblioteca**, and drop in a PDF or paste a YouTube URL. The system will:
1. Extract text and send it to the LLM
2. Generate a structured node (label, description, concepts, key quote)
3. Compute embeddings and project to 3D
4. Recalculate clusters and relations

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React Frontend                   │
│  Graph3D · NodePanel · AgentPanel · IssuePanel      │
│  RelationPanel · SynthesisPanel · LibraryPanel      │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────┐
│                  FastAPI Backend                     │
│                                                     │
│  main.py          processor.py    embeddings_engine │
│  ─ /api/graph     ─ LLM calls     ─ UMAP            │
│  ─ /api/ingest    ─ PDF/YT/HTML   ─ HDBSCAN         │
│  ─ /api/issue       parsing       ─ cosine sim      │
│  ─ /api/agent                                       │
└──────────────────────┬──────────────────────────────┘
                       │
         PostgreSQL + pgvector
    nodes · edges · chunks · sources · documents
              (índices HNSW)
```

---

## Data pipeline

```
Source (PDF / YouTube / HTML / Excel)
  ↓
Text extraction (PyMuPDF / oEmbed / httpx+BeautifulSoup)
  ↓
LLM → structured JSON node {label, desc, fragmento, conceptos}
  ↓
sentence-transformers → 384d embedding vector (multilingüe)
  ↓
UMAP → (x3d, y3d, z3d) coordinates
  ↓
HDBSCAN → cluster assignment
  ↓
Relation engine → kNN por nodo (top-5) + piso data-driven (percentil del corpus)
                  o ≥2 conceptos compartidos por palabra completa
                  cada arista guarda método, base (explícita/semántica/inferida/manual),
                  evidencia numérica y revisión humana
  ↓
React 3D graph
```

---

## Supported sources

| Type | How |
|---|---|
| PDF | File upload — text via PyMuPDF, native base64 for Anthropic |
| YouTube | URL — metadata via oEmbed (no API key needed) |
| Web page / HTML | URL — scraped with httpx + BeautifulSoup |
| Excel | File upload — first 20 rows via openpyxl |
| Plain text / Markdown | File upload |

---

## LLM provider notes

**On a machine without a dedicated GPU, the cloud providers (Gemini / Anthropic) are
by far the smoothest** — a 27B local model runs at a few tokens/sec on CPU, which makes
ingestion slow. The app handles transient provider errors (429 rate-limit, 503) with
automatic retry + backoff. Use Ollama when you want fully offline/local processing.

### Local models (Ollama, no GPU)

Tested on Intel Core Ultra 9 185H, 32GB RAM:

| Model | Size | Notes |
|---|---|---|
| `qwen3.5:27b` | 17GB | Best quality, ~2–4 tok/s on CPU |
| `qwen3.5:9b` | 6.6GB | Good balance, ~8–10 tok/s |
| `qwen3.5:4b` | 3.4GB | Fast, lower quality on structured JSON |

```bash
ollama pull qwen3.5:27b
ollama serve
```

> **Note:** Qwen3 models emit a `<think>...</think>` block before responding. The system strips this automatically before JSON parsing.

---

## Project structure

```
llm-wiki/
├── main.py                 # FastAPI server + API routes
├── processor.py            # LLM calls, text extraction, cosine similarity
├── vigencia.py             # Reglas puras de vigencia de fuentes (sin LLM, offline)
├── embeddings_engine.py    # UMAP + HDBSCAN pipeline
├── database/               # Modelos SQLAlchemy, esquema e inicialización
├── tests/                  # Suite unittest (corre sin Docker ni modelos)
├── docs/                   # Visión, arquitectura y plan de producto
├── entregables/            # Material del TP (canvas, notas, deck)
├── requirements-fastapi.txt
├── requirements-dev.txt    # Sólo lo necesario para correr los tests
├── .env.example
└── frontend/
    └── src/
        ├── App.jsx
        └── components/
            ├── Graph3D.jsx
            ├── NodePanel.jsx
            ├── AgentPanel.jsx
            ├── IssuePanel.jsx
            ├── RelationPanel.jsx
            ├── SynthesisPanel.jsx
            └── LibraryPanel.jsx
```

---

## Roadmap / known limitations

- [ ] Node collision in dense graphs (fix in progress)
- [ ] AI-generated study notes per document (in progress)
- [ ] MCP federation — connect to external corporate knowledge bases
- [ ] Embed model upgrade path without full re-ingestion
- [ ] Export graph as interactive HTML

---

## Context

Algedi es un proyecto independiente orientado a transformar problemas reales en soluciones
fundamentadas. Puede reutilizar ideas generales de RAG, grafos y verificación, pero no comparte
repositorio, datos ni ciclo de desarrollo con otros proyectos.

---

## Author

**Lucas Brusasca**  
Data & AI — Córdoba, Argentina  
[LinkedIn](https://linkedin.com/in/lucasbrusasca) · [GitHub](https://github.com/LucasBrusasca)
