# PragmaForge

**Local AI-powered knowledge graph with 3D semantic visualization.**  
Ingest PDFs, YouTube videos, web pages and Excel files → the system extracts concepts via LLM, builds a semantic graph, and lets you explore, query, and synthesize knowledge in 3D.

> Built as a personal knowledge management tool and as a demonstration of Multi-RAG orchestration patterns. Thesis project — Maestría en Ciencia de Datos, Universidad Austral.

> 📖 **Leé la [Visión y Concepto Central →](VISION.md)** — el problema profundo que ataca (la deriva del significado / *semantic satiation*), en qué se diferencia de los demos virales y de Obsidian, y hacia dónde va.
> 🏗️ **Y la [Arquitectura y Forma →](ARQUITECTURA.md)** — medallón (bronze/silver/gold), el framework de conectores para sumar fuentes, y cómo escala.

---

## What it does

You drop documents into PragmaForge. It reads them, extracts key concepts using a local or cloud LLM, generates vector embeddings, and positions each document as a node in 3D space based on semantic similarity (UMAP). Nodes that share concepts or have high cosine similarity get connected.

From there you can:

- **Explore the graph** — rotate, zoom, switch between layout modes (UMAP / Density / Centroids)
- **Click any node** — read the AI-generated summary, concepts, and source preview
- **Ask the agent** — RAG-powered chat over your entire knowledge base, or scoped to a single node
- **Create an Issue** — describe a problem, the system finds the most relevant nodes and synthesizes an analysis
- **Synthesize** — select multiple nodes and generate an integrated summary across all of them
- **Inspect relations** — click any edge to see exactly why two nodes are connected (cosine similarity score + shared concepts)

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Python |
| LLM | Anthropic API / Gemini API / Ollama (local) |
| Embeddings | `sentence-transformers` — `all-MiniLM-L6-v2` |
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
              nodes_generated.json
              (graph state + embeddings)
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
sentence-transformers → 768d embedding vector
  ↓
UMAP → (x3d, y3d, z3d) coordinates
  ↓
HDBSCAN → cluster assignment
  ↓
Relation engine → edges by cosine similarity ≥ 0.38 OR ≥2 shared concepts
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
├── embeddings_engine.py    # UMAP + HDBSCAN pipeline
├── server.py               # Lightweight alternative server (no FastAPI)
├── nodes_generated.json    # Graph state (nodes + relations + embeddings)
├── requirements-fastapi.txt
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

This project is a working prototype of the architecture described in my master's thesis:  
**"Multi-RAG Multimodal con orquestación reflexiva para gestión del conocimiento corporativo"**  
Maestría en Ciencia de Datos — Universidad Austral, 2025.

The thesis explores multi-silo RAG systems with epistemic veto mechanisms. PragmaForge is the personal knowledge management layer — separate from the corporate knowledge system, but designed to federate with it via MCP.

---

## Author

**Lucas Brusasca**  
Data & AI — Córdoba, Argentina  
[LinkedIn](https://linkedin.com/in/lucasbrusasca) · [GitHub](https://github.com/LucasBrusasca)
