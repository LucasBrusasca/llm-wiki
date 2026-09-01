# Algedi · Consultora de IA multi-agente — Brief del proyecto

> **En una frase:** una consultora de IA hecha de un equipo de agentes que, dada la
> información de una empresa (o un problema, o un tema), detecta problemas, propone la
> solución adecuada (ciencia de datos, analítica, automatización, IA/agentes o mejora de
> proceso), arma el proyecto en un *canvas* y evalúa si conviene — preservando todo en un
> grafo de conocimiento que crece con cada caso.

---

## 0. Para qué lo hago (la vara que decide todo)

**Objetivo: mejor trabajo / ingreso.** No es un negocio ni un producto para vender. Es el
**activo que me vuelve un candidato más valioso** para roles de IA/Datos. Toda decisión se
mide con una sola pregunta: *¿esto me hace más contratable?*

Consecuencia práctica: **la idea no necesita ser única.** Necesita (1) funcionar, (2) que yo
pueda explicar cada pieza, y (3) que se vea (repo, demo, post). Ahí está el retorno.

## 1. Qué demuestra (por qué me contrata alguien)

- **Agentes + orquestación (LangGraph):** de lo más demandado en 2026.
- **End-to-end:** full-stack + ML + agentes + Docker. "Shipea sistemas reales", no notebooks.
- **Mi perfil híbrido:** Contador + auditor + Ciencia de Datos + ingeniería de IA. La consultora
  que recomienda *DS / analítica / IA según el caso* muestra exactamente esa amplitud.
- **Roles que abre:** AI Engineer, AI Solutions Engineer, ML Engineer, Consultor de IA.

## 2. Qué YA existe (la plataforma: Algedi)

El ~70% de la base ya está construida y funcionando:

- **Ingesta multimodal:** PDF, Word, Excel, HTML, PPT, txt/md, YouTube (con transcript), web,
  playlists — y una carpeta vigilada (*Ingesta Continua*) que absorbe archivos y links solos.
- **Embeddings multilingües** (MiniLM-L12, local) + **pgvector** en Postgres.
- **Grafo de conocimiento:** aristas emergentes (similitud semántica + conceptos compartidos),
  clustering honesto (UMAP/HDBSCAN), taxonomía de temas por LLM.
- **Agente RAG** grounded en el grafo + **módulo Issue** (razonamiento por etapas).
- **Front React/Three.js** con grafo 3D + `reactflow` (para diagramas de flujo).
- **Docker Compose** (db + backend + frontend), reproducible.

## 3. Qué construimos NUEVO (el equipo de agentes)

Un sistema **multi-agente en LangGraph**, montado sobre Algedi. Conceptos:

- **Estado** = un "cuaderno" compartido que viaja por el flujo; cada agente lee y escribe.
- **Nodo** = un agente = una función + un *system prompt* de rol (usa el `query_llm` de Algedi).
- **Grafo** = el cableado supervisor → especialistas → síntesis.

**El equipo (5 roles):**

| Agente | Qué hace | Escribe en el cuaderno |
|---|---|---|
| 🧭 **Supervisor** | Orquesta: decide qué correr y con qué entrada | ruteo |
| 🔍 **Diagnóstico** | Detecta problemas y debilidades reales | `diagnostico` |
| 💡 **Oportunidades** | Por cada dolor, propone la solución adecuada: **ciencia de datos / analítica / automatización / IA-agente / mejora de proceso** | `oportunidades` |
| 📋 **Canvas** | Desarrolla la mejor oportunidad en el AI Canvas (12 bloques) | `canvas` |
| 💰 **Viabilidad** | ROI + riesgos → recomendación construir/no | `viabilidad` |

**Preservación:** el resultado se guarda conectado en el grafo (`dolor → oportunidad → canvas → decisión`). Con cada empresa cargada, emergen patrones entre casos.

## 4. Cómo funciona de punta a punta

1. **Entrada:** se carga contexto (empresa / problema / tema / documentos) — ingesta ya existente.
2. **Diagnóstico** → problemas priorizados.
3. **Oportunidades** → solución adecuada por problema (no solo IA: también DS/analítica/proceso).
4. **Canvas + Viabilidad** → la mejor oportunidad, desarrollada y evaluada.
5. **Síntesis** → todo guardado y conectado en Algedi.
6. **Salida:** informe navegable — *"3 problemas, 2 oportunidades priorizadas, 1 canvas, ROI"*.
7. **Humano en el medio (HITL):** reviso y ajusto en cada etapa.

## 5. El stack (y qué señal manda)

`FastAPI + Postgres/pgvector + embeddings transformer locales + UMAP/HDBSCAN + LangGraph
(multi-agente) + React/Three.js (grafo 3D)`. **Modelo de LLM:** desarrollo con **Gemini** (gratis);
arquitectura agnóstica → corre también en **Claude** o **local (Ollama)**. Esa frase sola posiciona.

## 6. Alcance — qué ENTRA y qué NO

**MVP (los 15 días):**
- Estado + los agentes encadenados (Diagnóstico → Oportunidades → Canvas → Viabilidad) en LangGraph.
- Cada agente = rol especializado (prompt) usando `query_llm`.
- Resultados guardados y conectados en el grafo.
- Panel simple para dispararlo y ver el informe (reusa el patrón del módulo Issue).
- Revisión humana por etapa.

**Roadmap (NO ahora):**
- Agentes autónomos con herramientas propias y *handoffs* dinámicos.
- Que un agente **ejecute** análisis de datos real (no solo lo recomiende).
- Organigrama de agentes animado en el grafo 3D.
- Detección de patrones entre múltiples empresas.

## 7. Plan de trabajo (tramos, no días rígidos)

1. **Cimientos LangGraph** *(hecho)*: estado + nodo Diagnóstico corriendo. ✅
2. **Encadenar el equipo**: sumar Oportunidades → Canvas → Viabilidad, pasándose el cuaderno.
3. **Supervisor + salida**: orquestador y guardado conectado en el grafo.
4. **Panel/UI**: disparar el análisis y ver el informe (sobre el patrón del Issue).
5. **Pulido + empaquetado**: README con diagrama, demo grabada, limpieza del repo.

*(Modo de trabajo: construyo entendiendo cada pieza — tengo que poder defenderla, porque el ROI es poder explicarla.)*

## 8. Cómo se traduce en empleo (esto NO es opcional)

El código sin empaquetar no da ingreso. El retorno sale de:
- **Repo prolijo + README** con diagrama de arquitectura (este documento es parte).
- **Demo grabada** (2-3 min) mostrando el flujo real.
- **Post/writeup** (LinkedIn) contando qué construí y por qué.
- **Framing por rol**: contarlo en el idioma del puesto que busco.

## 9. Qué tengo que poder EXPLICAR (checklist de ownership)

Si no lo puedo defender, se vuelve en contra. Tengo que poder explicar:
- [ ] Cómo se crean las aristas del grafo (similitud + conceptos, umbral data-driven).
- [ ] Por qué clusteriza en ~10D y no en 3D.
- [ ] Qué son estado / nodo / grafo en LangGraph y por qué.
- [ ] Cómo se pasan el cuaderno los agentes.
- [ ] Por qué cada decisión de stack (pgvector, embeddings locales, agnóstico de modelo).

---

**Resumen:** un sistema multi-agente (LangGraph) sobre mi propia plataforma (Algedi), que hace un
trabajo concreto de consultoría de IA/datos, construido entendiendo cada pieza y empaquetado para
mostrar. Objetivo: **volverme más contratable.** Vara única: *¿esto me hace más contratable?*
