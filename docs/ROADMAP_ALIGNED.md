# Algedi — Roadmap de producto (ALIGNED)

**Para:** Lucas Brusasca  
**Fecha:** 20 sep 2026 (ART)  
**Canon de visión:** `VISION.md` (segundo cerebro vivo — **no** Decision Desk como home)

---

## Principio

Fabricar el spine ALIGNED de a fases demoables. No abrir Multiverso 3D, MCP out, ni conectores de apps/finanzas hasta que nodos + secciones + ingest→grafo + chat citar/abstener + un puente 2D existan y se puedan enseñar.

**Inventario de código:** este doc **no** lista archivos del repo. Fase 0 debe correrse en la máquina de Lucas.

**Ruta local a auditar (PC usuario):**  
`C:\Users\brusa\LucasBrusasca\Proyectos\`  
— buscar repos **llm-wiki** y/o **Algedi** (nombre exacto a confirmar en disco; no inventar árbol aquí).

---

## Fase 0 — Esta semana: auditoría de lo que hay

**Objetivo:** saber qué existe ya (llm-wiki / Algedi) vs. qué hay que construir, sin inventar features.

**Hacer en el PC (ruta arriba):**
- Localizar el/los repos (llm-wiki, Algedi u homólogos).
- Inventario real: modelos de doc/nota, ingest, RAG, grafo/UI de secciones, chat, citas, abstención, auth, stack.
- Gap vs spine ALIGNED (nodos tipados, secciones a gusto, puente cross-sección, chat cita/abstiene).
- Decisión escrita: reutilizar / adaptar / descartar (p. ej. restos Decision Desk / Architect como *home*).

**Criterio de éxito (demoable):**
- Una página o sección “Estado actual” con hallazgos + gaps + decisión de base.
- Lista explícita de lo que **no** se toca en Fase 1.

---

## Fase 1 — 2–3 semanas: MVP del segundo cerebro

**Entregar (mínimo viable del spine):**
1. **Nodos tipados mínimos:** al menos `doc`, `note`, `chunk`, `link`.
2. **Secciones / rooms a gusto** del usuario (crear, nombrar, habitar).
3. **Ingest dinámico** que alimente grafo + RAG (lo nuevo entra y se conecta).
4. **Chat in-app** que **cite** nodos/chunks o **se abstenga** si no hay evidencia.
5. **Un puente cross-sección 2D** real (saltar entre dos rooms con enlace visible).

**Criterio de éxito (demoable en ~5 min):**
- Crear 2 secciones → ingerir material en ambas → ver nodos en grafo.
- Usar el puente 2D entre ellas.
- Pregunta con evidencia → citas clicables; pregunta sin evidencia → abstención explícita.
- Home = cerebro/secciones, **no** stepper Decision Desk.

---

## Fase 2 — Scripts/queries + puentes mejores

**Entregar:**
- Nodos `script` / `query` tipados, **vinculados a docs** (no scripts huérfanos).
- Mejora de bridges: más de un puente, claridad visual, navegación cross-sección usable.
- (Opcional fino) tipado `vista` preliminar solo si no frena lo anterior.

**Criterio de éxito:**
- Demo: un script/query nodo aparece en el grafo, apunta a ≥1 doc, y se puede abrir desde sección o chat con contexto.
- Al menos 2–3 puentes 2D estables entre secciones distintas.

---

## Fase 3 — MCP out + problem mode libre

**Entregar:**
- **MCP outbound:** Algedi como fuente/herramienta consumible desde afuera (alcance acotado).
- **Problem / pain mode libre:** explorar un lío *sin* stepper obligatorio; capa opcional sobre el cerebro, no el home.
- Chat sigue la regla: citar o abstenerse.

**Criterio de éxito:**
- Un cliente MCP externo lista/lee (o invoca) algo útil del grafo Algedi.
- Entrar en problem mode, explorar, salir al cerebro sin “cerrar expediente” forzado.

---

## Fase 4+ — Solo si el 2D ya sirve

**Candidatos (orden sugerido, no compromiso de fecha):**
- Conectores DB / vistas como nodos.
- Scripts de similitud / solapamiento automático (estilo Graphify) — **después** de scripts-as-nodes manuales.
- **Multiverso 3D** — únicamente si los puentes 2D ya demuestran valor diario.
- Conectores de apps / finanzas (bancos, ERPs, etc.).
- Fuentes MCP inbound ricas como nodos de primer clase.

**Criterio de éxito (por ítem):** demo aislada + no romper Fase 1–2.

---

## Fuera de alcance (near-term)

Explicitamente **no** en Fase 0–2 (y no como home nunca):

| Fuera | Nota |
|-------|------|
| Decision Desk / stepper como home | Rechazado; ver `VISION.md`. |
| Multiverso 3D / mission-control de agentes | Solo Fase 4+ si 2D funciona. |
| MCP outbound | Fase 3. |
| Problem mode / Architect como puerta | Fase 3 como capa, no home. |
| Conectores finanzas / bancos / ERPs | Fase 4+. |
| Auto-similarity / overlap Graphify | Después de script/query nodes (Fase 2+). |
| Colaboración multi-usuario real, auth enterprise | No bloquea MVP personal. |
| Oráculo sin citas; ROI inventado; catálogo de tools | Contra el spine. |
| Inventar inventario de archivos del repo sin auditar en PC | Fase 0 es obligatoria. |

---

## Resumen de fases

| Fase | Horizonte | Entrega clave |
|------|-----------|----------------|
| **0** | Esta semana | Audit llm-wiki/Algedi en `C:\Users\brusa\LucasBrusasca\Proyectos\` |
| **1** | 2–3 sem | Nodos mín. + secciones + ingest→grafo + chat cita/abstiene + 1 puente 2D |
| **2** | Siguiente | Script/query nodes ligados a docs; bridges mejores |
| **3** | Luego | MCP out + problem mode libre |
| **4+** | Condicional | DB, auto-similarity, 3D si 2D ok, app/finance connectors |

---

*Roadmap ALIGNED — BrusAI / Lucas Brusasca. Actualizar tras cerrar Fase 0 con inventario real.*
