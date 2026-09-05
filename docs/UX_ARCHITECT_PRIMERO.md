# UX: Architect primero

Cómo se reordena la experiencia **sin borrar** lo que ya existe (grafo, RAG, vault, secciones, Issue/Solve, paneles).

## Home (nuevo foco)

Al abrir Algedi, el usuario ve:

1. **Empezar decisión** (Architect) — CTA primario.
2. Sección activa (selector).
3. Expedientes recientes.
4. Acceso secundario: Explorar grafo · Biblioteca / vault · Agente RAG · Ajustes.

El grafo 3D deja de ser la primera pantalla por defecto (sigue a un click).

## Pantallas

### A. Architect (camino principal)
- Paso 1: problema + sección(es) de contexto.
- Paso 2: evidencia citada (nodos/chunks) — abstener si no hay grounding.
- Paso 3: rutas (incl. no implementar) + verifier.
- Paso 4: HITL (editar / aprobar / rechazar).
- Paso 5: expediente guardado + puentes `decidido_en`.

### B. Explorar (grafo)
- Misma potencia 3D de hoy.
- Filtro por sección y tags.
- Click nodo → panel; crear puente tipado.
- Mobile: lista / 2D antes que WebGL pesado (mejora posterior).

### C. Biblioteca
- Vault + uploads.
- Ingesta a sección activa.
- Estado de vigencia (si está disponible).

### D. Agente RAG
- Chat anclado a sección (default) o alcance explícito.
- Citas clickeables.

### E. Expedientes
- Lista unificada Issue / Solve / Architect (lo que ya persiste como expediente).
- No tres hogares distintos en la nav.

## Qué no se elimina

APIs, paneles, vault watcher, secciones, RelationPanel, NodePanel, discoverías, demo Architect: se **reordenan** y se enlazan al home nuevo. Features avanzadas pueden vivir bajo "Más".

## Criterio de hecho

- Usuario nuevo entiende en 30 s: "acá decido con evidencia".
- Grafo sigue usable.
- Cero pérdida de datos ni de endpoints sin migración.
