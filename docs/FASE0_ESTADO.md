# Algedi — Estado Fase 0: Auditoría del Repositorio

**Fecha:** 20 sep 2026  
**Canon:** [`VISION_ALIGNED.md`](VISION_ALIGNED.md) + [`ROADMAP_ALIGNED.md`](ROADMAP_ALIGNED.md)  
**Tag de recuperación:** `algedi-pre-fase0-20260920`

---

## 1. Resumen ejecutivo

La auditoría confirma la hipótesis inicial: **mucho de lo que necesita el spine ALIGNED ya existe**. El trabajo de Fase 1 es **reshape + tipado de nodos + puentes explícitos**, no greenfield.

| Pieza del spine | Estado |
|-----------------|--------|
| Secciones/rooms a gusto del usuario | ✅ Funciona completo |
| Ingest dinámico → grafo + RAG | ✅ Pipeline maduro |
| Chat que cita o se abstiene | ✅ Implementado con chunks y umbral |
| Nodos tipados (doc/note/chunk/link) | ⚠️ Parcial: falta tipado explícito |
| Puente cross-sección 2D visible | ❌ No existe aún |

**Decisión clave:** el home del producto es el **grafo de secciones** (segundo cerebro), **no** el stepper Decision Desk ni Architect. Estos últimos pueden vivir como capa opcional (Fase 3+), pero no definen la identidad.

---

## 2. Stack actual

| Capa | Tecnología |
|------|------------|
| **Frontend** | React 18 + Vite, `react-force-graph-3d` (Three.js/WebGL), CSS puro |
| **Backend** | FastAPI (Python), SQLAlchemy async |
| **LLM** | Intercambiable: Gemini / Anthropic / Ollama (local) |
| **Embeddings** | `sentence-transformers` — `paraphrase-multilingual-MiniLM-L12-v2` (384d) |
| **Reducción dimensional** | UMAP → coordenadas 3D |
| **Clustering** | HDBSCAN |
| **Base de datos** | PostgreSQL + pgvector (índices HNSW) |
| **Infraestructura** | Docker Compose, arranque de un clic |

---

## 3. Qué existe hoy

### 3.1 Secciones / rooms

**Estado: ✅ COMPLETO**

Las secciones son grafos de conocimiento independientes por `dominio`. La implementación cubre:

- Crear, renombrar, eliminar secciones desde la UI
- Filtrado de nodos por sección activa
- Persistencia en localStorage + backend
- Endpoints: `/api/sections`, `/api/sections/rename`, `/api/sections/delete`

**Código relevante:**
- `App.jsx`: `cambiarSeccion()`, `nuevaSeccion()`, `renombrarSeccion()`, `eliminarSeccion()`
- `database/models.py`: campo `dominio` en `Node`

### 3.2 Tipos de nodo

**Estado: ⚠️ PARCIAL**

El modelo `Node` tiene un campo `type` pero solo usa dos valores:
- `"DOCUMENTO"` (default)
- `"FRAGMENTO"` (para chunks en vista de fragmentos)

Además existe `is_issue: Boolean` para marcar nodos como issues/problemas.

**Gap:** No hay tipado explícito `doc`, `note`, `chunk`, `link` como pide el ROADMAP. Los chunks viven en tabla separada (`Chunk`) pero no como nodos de primera clase en el grafo principal.

### 3.3 Ingesta dinámica

**Estado: ✅ MADURO**

Pipeline completo que soporta múltiples fuentes:

| Fuente | Método |
|--------|--------|
| PDF | PyMuPDF (texto + miniatura) |
| YouTube | oEmbed + transcripción (yt-dlp) |
| Web/HTML | httpx + BeautifulSoup |
| Excel | openpyxl (primeras 20 filas) |
| Word (.docx) | xml interno |
| PowerPoint | xml interno |
| Texto/Markdown | directo |

El flujo: extracción → LLM estructura (label, desc, fragmento, conceptos) → embeddings → UMAP → clustering → aristas por similitud.

**Código relevante:**
- `IngestPanel.jsx`: UI con drag-drop, carga de carpetas, URLs
- `main.py`: `/api/ingest`, `/api/ingest/status`
- `processor.py`: `procesar_documento()`, `query_llm()`

### 3.4 RAG y chat

**Estado: ✅ FUNCIONAL**

El chat (`AgentPanel.jsx`) recupera evidencia del grafo antes de responder:

1. Busca chunks relevantes por similitud (`_chunks_relevantes_scored`)
2. Si la afinidad máxima supera `AGENT_VETO_UMBRAL` → responde con **citas** (marcadores `[C1]`, `[C2]`...)
3. Si no hay evidencia suficiente → responde con **abstención** declarada ("conocimiento general · sin respaldo suficiente en la biblioteca")

**Modos de evidencia:**
- `chunks`: citas precisas a pasajes con página y extracto
- `summaries`: resúmenes de nodos (fallback)
- `general`: conocimiento general declarado (sin respaldo)

**Código relevante:**
- `main.py`: `/api/agent`, `AGENT_VETO_UMBRAL`, lógica de citations
- `AgentPanel.jsx`: renderizado de fundamentos y citas clicables

### 3.5 Visualización del grafo

**Estado: ✅ RICO**

`Graph3D.jsx` implementa un grafo 3D navegable con:

- **Tres modos de layout:**
  - `components` (UMAP): preserva vecindad semántica
  - `density`: agrupa por tema/cluster
  - `force` (Relacional): física de vínculos, muestra hubs y puentes
  
- **LOD dinámico:** puntos de lejos, tarjetas con miniatura de cerca
- **Colores por tema/cluster:** paleta de tonos joya
- **Inspección de aristas:** procedencia (método, base, evidencia, revisión humana)

### 3.6 Architect / Decision Desk

**Estado: PRESENTE (pero no es el home)**

`ArchitectPanel.jsx` implementa un stepper de 7 pasos:
1. Recibe (problema + restricciones)
2. Recupera (pasajes con cita)
3. Clasifica (6 rutas: rediseño, reglas, datos/BI, IA asistiva, agente, no implementar)
4. Compara (matriz de criterios)
5. Verifica (objeción separada)
6. Escala (decisión humana)
7. Persiste (expediente)

**Endpoints:** `/api/architect/intake`, `/api/architect/analyze`

**Evaluación según canon:**
> "Convierte el producto en un wizard de caso. Algedi no es un flujo 1-2-3-4; es un cerebro que se explora." — VISION.md

Architect puede vivir como capa posterior (Fase 3: problem mode), pero **no define el home**.

### 3.7 Issues y procesos

**Estado: PRESENTE**

`IssuePanel.jsx` permite crear issues (problemas/procesos), ver flujogramas, chat por etapa. Los issues se marcan con `is_issue: true` en el modelo.

Igual que Architect: útil como complemento, pero el home es el cerebro navegable.

### 3.8 Puentes cross-sección

**Estado: ❌ NO EXISTE EXPLÍCITAMENTE**

Las aristas pueden conectar nodos de distintas secciones (implícito por la tabla `Edge`), pero:
- No hay UI que muestre "puentes entre secciones" como concepto de primera clase
- El módulo `DiscoveriesPanel` detecta "puentes" y "silos", pero dentro de UNA sección
- No hay navegación visual de sección a sección por un puente 2D

**Este es el gap principal para Fase 1.**

### 3.9 Otras funcionalidades existentes

| Feature | Estado |
|---------|--------|
| Síntesis multi-nodo | ✅ `SynthesisPanel.jsx` |
| Descubrimientos (puentes/silos internos) | ✅ `DiscoveriesPanel.jsx` |
| Vigencia de fuentes (hash, no fecha) | ✅ `vigencia.py`, `/api/vigencia/verificar` |
| Export/import de grafo | ✅ `/api/export`, `/api/import` |
| Biblioteca con gestión | ✅ `LibraryPanel.jsx` |
| Seguridad con clave | ✅ `/api/security`, `pedirClave()` |
| Taxonomía con IA | ✅ `/api/taxonomy` |
| Vault watcher | ✅ `vault_watcher.py` |

---

## 4. Matriz de gaps vs Fase 1 MVP

| Requisito Fase 1 | Estado actual | Gap | Esfuerzo |
|------------------|---------------|-----|----------|
| **Nodos tipados** (doc, note, chunk, link) | Solo DOCUMENTO/FRAGMENTO genérico | Agregar enum de tipos, migrar chunks a nodos | MEDIO |
| **Secciones a gusto** | ✅ Completo | — | CERRADO |
| **Ingest → grafo + RAG** | ✅ Pipeline maduro | — | CERRADO |
| **Chat cita o se abstiene** | ✅ Con umbral y marcadores | — | CERRADO |
| **1 puente cross-sección 2D** | No existe | Diseñar UI + endpoint | MEDIO-ALTO |

---

## 5. Recomendaciones: reutilizar / adaptar / descartar

### ✅ REUTILIZAR DIRECTO

- Sistema de secciones/rooms completo
- Pipeline de ingesta multimodal
- Chat RAG con citas y abstención
- Graph3D con tres layouts
- Inspección de aristas con procedencia
- Vigencia de fuentes
- Biblioteca y gestión de nodos

### 🔧 ADAPTAR

| Componente | Adaptación necesaria |
|------------|---------------------|
| `Node.type` | Expandir a enum: `doc`, `note`, `chunk`, `link`, `script`, `query` (futuro) |
| Tabla `Chunk` | Opción: promover chunks a nodos del grafo principal con tipo `chunk` |
| `DiscoveriesPanel` | Extender para mostrar puentes **entre** secciones |
| Selector de sección | Agregar visualización de conexiones hacia otras secciones |

### ⏸️ NO TOCAR EN FASE 1 (pero no eliminar)

Estos componentes quedan intactos para Fase 3+:

```
frontend/src/components/
├── ArchitectPanel.jsx    ← stepper de decisión, Fase 3 como capa
├── IssuePanel.jsx        ← issues/problemas, complemento
├── ProcessPanel.jsx      ← flujogramas de proceso
├── SynthesisPanel.jsx    ← síntesis multi-nodo (útil, no prioritario)
└── ReportPanel.jsx       ← reportes 4-agentes por issue
```

**Endpoints que no se tocan:**
- `/api/architect/*`
- `/api/issues/*`
- `/api/process`

### 🚫 FUERA DE ALCANCE FASE 0–2

(Explícito del ROADMAP — no implementar ni prometer)

- Decision Desk / stepper como home
- Multiverso 3D / mission-control de agentes
- MCP outbound (Fase 3)
- Problem mode / Architect como puerta (Fase 3 como capa)
- Conectores finanzas / bancos / ERPs
- Auto-similarity / overlap tipo Graphify
- Colaboración multi-usuario, auth enterprise
- Oráculo sin citas

---

## 6. Sugerencia: primer PR de Fase 1

**Objetivo:** establecer el tipado de nodos y preparar el terreno para puentes cross-sección.

### Tareas concretas (3–5)

1. **Migrar `Node.type` a enum explícito**
   - Archivo: `database/models.py`
   - Agregar valores: `doc`, `note`, `chunk`, `link` (+ mantener `DOCUMENTO` por compatibilidad)
   - Script de migración para nodos existentes

2. **Crear endpoint para nodos tipo `note`**
   - `POST /api/note` para crear notas rápidas (sin archivo adjunto)
   - Similar a `/api/ingest` pero sin extracción de archivo

3. **Agregar columna `linked_sections` a Edge**
   - Para marcar explícitamente cuando una arista cruza secciones
   - Facilita queries de puentes cross-sección

4. **Extender `/api/graph` para incluir puentes salientes**
   - Parámetro `include_bridges=true`
   - Devuelve nodos de otras secciones conectados a la actual

5. **Prototipo UI de puente cross-sección**
   - En el selector de secciones, mostrar badge con cantidad de conexiones hacia otras secciones
   - Al hacer clic, resaltar los nodos que son "portales"

---

## 7. Archivos clave para Fase 1

```
database/
├── models.py          ← Node.type enum, Edge.linked_sections
└── migrate.py         ← migraciones

main.py                ← endpoints /api/note, modificar /api/graph

frontend/src/
├── App.jsx            ← lógica de secciones, badge de puentes
├── components/
│   ├── Graph3D.jsx    ← visualización de puentes
│   └── IngestPanel.jsx ← extender para notas rápidas
```

---

## 8. Conclusión

El repositorio llm-wiki/Algedi tiene una base sólida:

- **70-80%** del spine Fase 1 ya existe (secciones, ingest, chat cita/abstiene)
- **El gap principal** es el puente cross-sección 2D visible
- **El tipado de nodos** es una extensión natural del modelo actual
- **Architect/Decision Desk** se conservan pero no definen el producto

**Próximo paso:** aprobar este documento y arrancar el primer PR de Fase 1 con el tipado de nodos.

---

*Documento generado como parte de la auditoría Fase 0. El código actual está respaldado en el tag `algedi-pre-fase0-20260920`.*
