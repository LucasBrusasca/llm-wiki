# Organización de espacios en Algedi

Documento canónico (2026-09-05). Complementa `PLAN_PRODUCTO_ALGEDI.md` y la entrega Architect.
No reemplaza Context / Research / Solve: define **cómo el usuario organiza conocimiento** y cómo eso alimenta Architect.

## Principio

El usuario define la organización. Algedi no impone taxonomía fija (finanzas, RRHH, etc.).

Tres mecanismos distintos:

| Mecanismo | Qué es | Cuándo usarlo |
|---|---|---|
| **Sección** (`dominio`) | Grafo aparte. Frontera de contaminación. | Mundos que no querés mezclar (cliente A vs maestría vs personal). |
| **Agrupación** (tags / clusters) | Orden **dentro** de una sección. | Temas, materias, proyectos en el mismo mundo. |
| **Puente tipado** | Arista entre nodos (a veces entre secciones). | Cuando algo de un mundo habla con otro. |

**Architect** no es una sección: es el **hilo que cruza** secciones y agrupaciones para llegar a una decisión (o a "no implementar"), con expediente.

El grafo 3D es memoria y explicación. No es el valor central ni el home del producto.

## Reglas

1. Sección = frontera. Si mezclar embeddings/retrieval entre dos corpus ensucia respuestas, van en secciones distintas.
2. Dentro de una sección, preferí tags/clusters antes de abrir otra sección.
3. Un documento con dos temas = un nodo, varias etiquetas. No duplicar secciones por tema.
4. Tiempo = vigencia / versión / `reemplaza` — no un eje 3D extra ("4ª dimensión" visual).
5. Metáforas (Interstellar, teseracto, gravedad) son pitch, no especificación de UI. En producto: secciones + tags + puentes + Architect.

## Tipos de puente (mínimo)

- `mismo_concepto`
- `evidencia_de`
- `contradice`
- `decidido_en` (sale de un expediente Architect)
- `reemplaza` / `vigente_en` (tiempo)

Se pueden ampliar después. Pocos y claros al inicio.

## Relación con Architect

Flujo estrella:

1. Elegir sección(es) de contexto (o "todas las relevantes" con puentes).
2. Plantear problema.
3. Architect: rutas → evidencia → recomendación (incluye **no implementar**).
4. HITL.
5. Expediente persistido y enlazado a nodos/fuentes.

Solve / Issue existentes se alinean a este recorrido; no se borran.

## Fuera de alcance de este doc

- OCR, SQL externo, Research académico, MCP, teseracto UI: ver PLAN (P1/P2).
- Multi-RAG tesis: evidencia transferible como capa, **sin merge** de repos.
