# Algedi — Visión canónica (ALIGNED)

**Para:** Lucas Brusasca  
**Fecha:** 20 sep 2026 (ART)  
**Estado:** Canon de producto. Reemplaza Decision Desk / Architect como *home*.

---

## Una frase

Algedi es un **segundo cerebro vivo**: nodos tipados, secciones dimensionales a gusto del usuario, ingest que alimenta grafo/RAG, y un agente in-app que **cita o se abstiene**.

No es un desk de decisión con stepper. No es “Architect como puerta de entrada”.

---

## Spine ALIGNED (qué sí es)

| Pieza | Qué significa |
|-------|----------------|
| **Nodos tipados** | `doc`, `note`, `chunk`, `link`; más adelante `script`/`query`, vista DB, fuente MCP. Todo es nodo del grafo, no solo texto suelto. |
| **Secciones / rooms** | Dimensiones definidas por el usuario (temas, proyectos, silos). El home es navegar y habitar secciones, no un wizard. |
| **Puentes cross-sección** | Enlaces explícitos entre rooms (primero 2D; Multiverso 3D solo si los puentes 2D ya sirven). |
| **Ingest dinámico → RAG/grafo** | Lo que entra (docs, notas, links) se fragmenta, tipa y conecta; el grafo y la recuperación crecen juntos. |
| **Chat / agente in-app** | Responde con **citas** a nodos/chunks, o **abstención** honesta si no hay evidencia. Sin teatro de certeza. |
| **Más tarde** | MCP outbound; modo problema/pain libre; conectores finanzas/DB; scripts/queries como nodos ligados a docs (solapamiento tipo Graphify = aún más tarde). |

---

## Qué se rechaza como home

| Rechazado | Por qué |
|-----------|---------|
| **Decision Desk + stepper** (Problema → Evidencia → Decisión → Expediente como recorrido forzado) | Convierte el producto en un wizard de caso. Algedi no es un flujo 1-2-3-4; es un cerebro que se explora. |
| **Architect / “gate de iniciativa IA” como home** | Puede vivir *después* como modo o capa (p. ej. Fase 3: problem mode). No define la identidad ni la pantalla de entrada. |
| **Mission-control de agentes / Multiverso 3D primero** | Efecto wow sin spine. 3D solo si los puentes 2D ya demuestran valor. |
| **Chat oráculo sin citas** | Mentir con fluidez. Citar o abstenerse es la regla de honestidad. |

El wireframe Decision Desk (`decision-desk-wireframe.*` en este folder) queda como **exploración descartada para home**, no como canon.

---

## Relación con piezas viejas

- **Algedi (plataforma)** = fábrica: nodos, secciones, ingest, grafo, chat con citas.  
- **Architect / problem mode** = capa opcional *posterior* (entender un lío), no el producto.  
- **llm-wiki / repo Algedi en PC** = base de código a auditar en Fase 0; este doc no inventa inventario.

---

## Cómo se ve si funciona

1. El usuario crea secciones a su gusto y mete material; el grafo se actualiza.  
2. Puede saltar de una sección a otra por un puente 2D real.  
3. Pregunta en chat: recibe respuesta con citas a nodos, o abstención clara.  
4. Nadie lo obliga a “cerrar un expediente” para usar el cerebro.

---

*Canon ALIGNED — BrusAI / Lucas Brusasca. Un página; actualizar solo si cambia el spine.*
