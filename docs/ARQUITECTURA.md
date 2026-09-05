# Algedi — Arquitectura y Forma

> Cómo está organizado por dentro, cómo **escala** y cómo se **suman fuentes** sin romper nada.
> Documento hermano de [`VISION.md`](VISION.md): la visión dice *por qué*; esto dice *cómo*.

El criterio de diseño es **no sobre-construir**. Algedi es un sistema de conocimiento
personal y de equipo, no una plataforma de datos a escala petabyte. Por eso adopta **dos**
patrones que sí le sirven —arquitectura medallón y conectores— y **descarta a propósito** el
resto del zoológico de data (lake, warehouse, mesh, Fabric), explicando por qué.

---

## 1. El principio: arquitectura medallón (bronze → silver → gold)

Es el esqueleto. Algedi **ya la tiene implícita**; nombrarla da orden y un lugar exacto
para cada fuente nueva.

| Capa | Qué es en Algedi | Dónde vive |
|---|---|---|
| 🥉 **Bronze** — crudo | El archivo/URL original, tal cual se subió, **intocado** | `uploads/` (volumen Docker) · `fuente_path` / `fuente_url` en la DB |
| 🥈 **Silver** — limpio + estructurado | Texto extraído → nodo `{label, desc, fragmento, conceptos}` (vía LLM) → **embedding** de 384-d | `processor.py` · `sentence-transformers` · columna `embedding` (pgvector) |
| 🥇 **Gold** — listo para consumir | El **grafo conectado**: aristas por similitud, clusters (HDBSCAN), coordenadas 3D (UMAP), y mañana los **Descubrimientos** | tablas `nodes` / `edges` · `embeddings_engine.py` · la visualización 3D |

**Regla de oro:** nunca se pierde el bronze. Si mañana cambiás el modelo de embeddings o el
prompt de extracción, **regenerás silver y gold desde el crudo** sin re-descargar nada.

---

## 2. Conectores: cómo se suman fuentes sin romper nada

La **escalabilidad de fuentes** sale de un patrón de **adaptadores**. Cada fuente solo tiene
que hacer **una** cosa: producir *texto crudo + metadatos* (bronze → silver). De ahí en
adelante, **todo fluye por el mismo pipeline** hacia el grafo.

```
                            ┌──────────────┐
   PDF ───►  procesar_pdf   │              │
   Word ──►  procesar_word  │              │   (silver)            (gold)
   PPT ───►  procesar_pptx  │  texto +     │   embedding   ┌───────────────────┐
   Excel ─►  procesar_excel ├─► metadatos ─┼─► + nodo ────►│ relaciones (coseno)│
   Web ───►  procesar_html  │  {nodo}      │   estructur.  │ clusters (HDBSCAN) │
   YouTube►  procesar_youtube│             │               │ posición 3D (UMAP) │
   …futuras (RSS, Notion, API)            │               └───────────────────┘
                            └──────────────┘
        ↑ CONECTORES (un adaptador por fuente)      ↑ PIPELINE COMÚN (no se toca)
```

> **Agregar una fuente nueva = escribir UN adaptador.** No tocás el pipeline, ni el grafo, ni
> la UI del agente. Eso es escalabilidad real.

### El contrato de un conector
Un conector recibe una **entrada** (ruta de archivo o URL) y devuelve:
```python
{ "nodos": [ { "label", "desc", "fragmento", "conceptos",
               "fuente", "fuente_path" | "fuente_url", "fuente_label" } ],
  "relaciones": [] }   # las relaciones las arma el gold, no el conector
```

### Conectores actuales
| Fuente | Conector | Estado |
|---|---|---|
| PDF / Tesis | `procesar_pdf` | ✅ |
| Word `.docx` | `procesar_word` | ✅ |
| PowerPoint `.pptx` | `procesar_pptx` | ✅ |
| Excel `.xlsx/.xls` | `procesar_excel` | ✅ |
| HTML / Web | `procesar_html` / `procesar_url_web` | ✅ |
| YouTube (metadatos) | `procesar_youtube` | ✅ (hoy solo título; ver roadmap) |
| Texto / Markdown | `procesar_txt` | ✅ |

### Conectores en el roadmap (la escalabilidad de fuentes)
- **YouTube con transcripción real + playlists** (vía `yt-dlp`): hoy el video entra casi vacío
  (solo título); con los subtítulos entra **todo lo que se dice**, y una *playlist* se expande
  en todos sus videos.
- **RSS / blogs**, **imágenes (OCR/visión)**, **Notion**, **APIs genéricas**.

> Nota sobre NotebookLM: no se "conecta" (no tiene API pública). Lo que se replica es su
> **facilidad de carga multi-fuente** — exactamente lo que da este framework de conectores.

---

## 2.bis El contrato de una arista

Una arista no es un hecho: es el resultado de un cálculo concreto. Por eso, además de
`source`, `target`, `score`, `shared_concepts`, `label` y `description`, cada arista
guarda **su procedencia**:

| Campo | Qué responde |
|---|---|
| `metodo` | Con qué camino se calculó: `knn_incremental` (ingesta, top-K del nodo nuevo, piso heredado), `recalculo_global` (todos los pares, piso medido sobre el corpus) o `manual`. |
| `base_relacion` | Qué la sostiene: `explicita` (≥2 conceptos compartidos por palabra completa), `semantica` (coseno sobre un piso **medido**), `inferida` (coseno sobre un piso **no medido**, el default de la ingesta) o `manual`. |
| `evidencia` | Los números crudos: coseno, piso aplicado, si ese piso fue medido, si lo supera, conceptos compartidos, K y modelo de embeddings. |
| `revision` | La decisión de una persona: `confirmada` / `rechazada`, con comentario y fecha. `NULL` = nunca revisada. |

Dos reglas que sostienen esto:

1. **`label` y `description` son interpretación, no medición.** `COMPLEMENTA_A` no
   significa que un documento complemente al otro: significa que el coseno pasó 0.75.
   La UI los muestra separados de `evidencia` y rotulados como derivados.
2. **El recálculo no borra decisiones humanas.** Recalcular relaciones borra y rehace
   las aristas calculadas, pero rescata y repone `revision` y las aristas manuales.
   El cálculo se puede rehacer; el juicio de una persona no.

Las aristas anteriores a esta trazabilidad quedan con estos campos en `NULL` a
propósito, y la UI las muestra como *origen no registrado*. Inventarles un método
sería exactamente el error que estos campos existen para evitar.

## 2.ter Vigencia de una fuente

`created_at` dice **cuándo se incorporó** una fuente, no si su contenido sigue valiendo.
Confundir las dos cosas es el error más fácil de cometer acá, así que la regla es dura y
está aislada en `vigencia.py`:

> **La antigüedad no es señal de desactualización.** Un documento de 2019 puede seguir
> siendo la referencia vigente y uno de ayer puede haber quedado obsoleto.

Una fuente sólo cambia de estado por una **observación concreta** o por una **persona**:

| Estado | Cuándo lo pone el sistema |
|---|---|
| `vigente` | El archivo en disco es byte a byte el que se incorporó — o no hay nada que indique lo contrario (y el motivo lo aclara). |
| `posiblemente_desactualizado` | El archivo cambió después de la ingesta, o desapareció. El nodo del grafo describe una versión que ya no existe. |
| `reemplazado` | Sólo por decisión humana: el sistema no puede saber que salió una norma nueva. |

### Observación y decisión, separadas

`Source.estado_vigencia` + `Source.vigencia` guardan **lo que observó el sistema**.
`Source.revision_vigencia` guarda **lo que decidió una persona**. El estado efectivo sale
de combinarlos (`resolver_estado`), y ambos quedan visibles en el panel del nodo.

Están separados a propósito: si la decisión humana escribiera sobre la observación,
quitarla después dejaría el estado humano pegado y "lo que observó el sistema" pasaría a
ser mentira.

### Qué significa cada motivo

Cada estado viaja con su motivo, porque `vigente` a secas es ambiguo. No es lo mismo
"comparé el archivo y no cambió" que "nunca tuve con qué comparar":

- `contenido_sin_cambios` — verificado contra la huella guardada.
- `linea_base_establecida_ahora` — no había huella; se fijó con el archivo actual.
  Habilita detectar cambios futuros, **no dice nada del pasado**.
- `sin_archivo_local_verificable` — URL o video: no se puede comprobar offline. No
  verificable **no** es lo mismo que desactualizado.
- `archivo_modificado_despues_de_la_ingesta` / `archivo_ausente` — las dos únicas
  observaciones que degradan el estado.
- `decision_humana` — lo fijó una persona.

### Versión y duplicados

Reingerir el mismo locator con contenido distinto sube `version` y empuja la huella
anterior al `historial`: es la única prueba de que la fuente cambió. Y dos fuentes con la
misma huella se marcan con `duplicado_de` — **sin** degradar el estado: dos copias del
mismo archivo no vuelven vieja a ninguna.

## 3. Organización de nodos a escala

Cuando el corpus crezca a cientos de documentos, el cuello de botella **no** es el
almacenamiento (Postgres + pgvector escala de sobra) — es que el **grafo se satura
visualmente**. El objetivo es que **se mantenga ordenado, agradable e intuitivo a cualquier
tamaño** — como los demos virales, pero útil.

> **Principio rector: nivel de detalle (LOD).** Los demos virales se ven limpios porque son
> *puntitos*, no tarjetas. Algedi debe ser **ambas cosas según el zoom**:
> - **Lejos (vista general):** los nodos se reducen a **puntos/etiquetas** agrupados por color de
>   cluster → la imagen limpia tipo "constelación" de los videos.
> - **Cerca (inspección):** las tarjetas ricas con miniatura y preview → más útil que los videos.
>
> Lindo de lejos, útil de cerca. Ese es el norte visual.

La organización a escala se apoya, además, en:

- **Clusters colapsables** *(roadmap)*: un grupo temático se ve como un **super-nodo**; lo
  expandís al click. Los clusters de HDBSCAN ya existen; falta el plegado visual.
- **Workspaces / proyectos**: las **etiquetas** (tags) que ya tenés son la semilla — filtrás el
  grafo por proyecto/tema y trabajás en un subconjunto.
- **Vistas por búsqueda**: la búsqueda semántica ya ilumina/filtra; es la forma de "ver solo lo
  relevante" sin renderizar todo.
- **Render-on-demand** *(ya implementado)*: el motor 3D solo dibuja cuando hay actividad → la
  GPU integrada aguanta más nodos.

---

## 4. Lo que deliberadamente NO somos (rechazo informado)

Descartar con criterio es señal de diseño, no de falta de ambición.

| Patrón | Por qué NO (todavía / nunca) |
|---|---|
| **Data Lake / Warehouse / Lakehouse** | Son para **petabytes de data estructurada/analítica**. Acá manejamos documentos + embeddings a escala personal; **Postgres + pgvector alcanza**. Sumar un lake es complejidad sin retorno. |
| **Data Mesh / Microsoft Fabric** | Gobernanza descentralizada a escala organización. La versión que **sí** corresponde es el **multi-silo + federación vía MCP** que ya está en `VISION.md`. Implementar mesh literal sería prematuro. |
| **Dashboards tipo PowerBI** | Algedi es **exploratorio (grafo)**, no reporting tabular. De PowerBI tomamos **solo** la idea de *conectores*, no el tablero. |

---

## 5. El stack por capa (quién hace qué)

| Capa medallón | Tecnología |
|---|---|
| Bronze | FastAPI (ingesta) · volumen Docker `uploads/` · Postgres |
| Silver | `processor.py` (extracción + LLM intercambiable: Gemini/Ollama/Anthropic) · `sentence-transformers` (all-MiniLM-L6-v2, 384-d) |
| Gold | `embeddings_engine.py` (UMAP + HDBSCAN) · similitud coseno · pgvector · React + `react-force-graph-3d` (Three.js) |

---

## 6. Receta concreta: cómo agregar una fuente nueva

1. **Escribir el conector** en `processor.py`:
   `procesar_X(entrada)` → extraer texto → `query_llm(prompt + _PROMPT_SUFIJO)` →
   `parsear_json` → setear `fuente` / `fuente_path|url` / `fuente_label` →
   `generar_embedding(nodo)` → `return {"nodos": [nodo], "relaciones": []}`.
2. **Rutear** la extensión/URL en `main.py` → `_run_ingest`.
3. **(Opcional) UI**: agregar la extensión al `accept` del input y un ícono/glyph del tipo.
4. **Listo.** El silver (embedding) y el gold (relaciones, cluster, UMAP) se aplican **solos** —
   no tocás nada más.

---

*Autor: Lucas Brusasca — Maestría en Ciencia de Datos, Universidad Austral.*
