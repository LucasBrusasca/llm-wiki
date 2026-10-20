# Escalabilidad de Algedi

Números medidos en esta VM con embeddings sintéticos (dim=384, sin LLM).
No se escribe la base de producción. El ingest reportado es el costo de kNN
incremental (el paso que escala); extracción LLM queda afuera a propósito.

## Límites observados

| n docs | chunks | payload viejo (KB) | payload nuevo (KB) | graph p50 viejo (ms) | graph p50 nuevo (ms) | edges DB → sección → cap |
|---|---|---|---|---|---|---|
| 1000 | 20000 | 460.8 | 122.6 | 5.85 | 2.72 | 5979 → 1495 → 943 |
| 5000 | 100000 | 2364.1 | 623.0 | 27.26 | 15.68 | 29989 → 7497 → 4712 |

## Búsqueda híbrida (p50 / p95, ms)

| n docs | global p50 | global p95 | sección p50 | sección p95 | doc p50 | doc p95 |
|---|---|---|---|---|---|---|
| 1000 | 25.74 | 32.89 | 37.23 | 40.51 | 0.15 | 0.21 |
| 5000 | 150.38 | 188.53 | 218.85 | 261.34 | 0.28 | 0.29 |

## Relaciones (ms) e ingest sintético

| n docs | incremental p50 (sample) | incremental p95 | all-pairs p50 | docs/s (kNN) |
|---|---|---|---|---|
| 1000 | 1.88 (n=200) | 2.52 | 3.78 | 106103.5 |
| 5000 | 5.21 (n=200) | 6.44 | 106.99 | 38373.3 |

## Qué limita

- **/api/graph**: el costo era `SELECT * FROM edges` (toda la base) + JSON.
  Con filtro SQL por sección y tope de 8 aristas/nodo el payload baja un orden.
  Arriba de ~1500 nodos visibilizados, el servidor agrupa por tema.
- **Ingest**: la extracción/LLM ya no toma el lock global; sólo el write a DB
  (`ALGEDI_INGEST_PARALLEL`, default 4; `ALGEDI_INGEST_WORKERS` por lote).
- **HNSW + filtro**: sin `hnsw.iterative_scan` / `ef_search` alto, un WHERE de
  sección recorta k. Ver `tests/test_hnsw_filter.py`.
- **Búsqueda por sección** en este bench usa el BM25 global y filtra después, por
  eso sale un poco más lenta que la global. En producción el camino es Postgres
  FTS (`WHERE n.dominio = :seccion`) + HNSW con `iterative_scan`.
- **20k docs**: all-pairs de relaciones (~400M floats) no cabe cómodo en esta VM;
  el camino incremental + HNSW sí. Correr 20k contra Postgres+pgvector en un
  host con ≥8 GB si se necesita el número exacto.

## v2 (no construido): multi-usuario

Plan, no implementación:

1. **Auth**: sesión (cookie httpOnly) o JWT corto; dueño en cada request.
2. **Columna `owner` / `workspace`** en `nodes`, `sources`, `watched_sources`,
   `agent_conversations`. RLS en Postgres o filtro obligatorio en cada query.
3. **Scripts en contenedor**: el sandbox actual corre en el mismo proceso.
   v2: job en container (gVisor/Firecracker o Docker one-shot) con CPU/RAM/red
   limitados, volumen de sólo-lectura al documento, artefacto de salida por
   bind mínimo. Sin secretos del host montados.
4. **Cuotas**: techo de nodos/chunks por workspace y de corridas/día.

## Cómo reproducir

```
python3 scripts/bench_scale.py --sizes 1000,5000
```

Corrida: 13.0s, sizes=[1000, 5000], chunks/doc=20, dim=384.
