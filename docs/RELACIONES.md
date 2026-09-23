# Relaciones: por qué dos documentos quedan unidos

Una arista en Algedi afirma algo: "estos dos documentos tienen que ver". Si entra
cualquier par, el grafo deja de ser información y pasa a ser decoración. Este documento
fija los umbrales que decidí, y sobre todo **con qué medición**.

Todos los números salen de medir el corpus real (222 documentos, embeddings
`paraphrase-multilingual-MiniLM-L12-v2`), no de elegirlos a ojo.

## Qué estaba mal

La regla anterior admitía un par si `coseno >= piso` **o** si compartían ≥2 conceptos.
Ese `o` era la puerta ancha:

- El piso era el **percentil 40** de las similitudes observadas: 0.387. Por construcción,
  un percentil deja pasar siempre la misma proporción del corpus, tenga sentido o no.
- Compartir conceptos salteaba el piso **por completo**. Medido sobre la sección
  `personal`: **1079 pares compartían ≥2 conceptos con coseno menor a 0.5**. Ejemplos
  reales: coseno 0.31 con `["Gestión de datos", "Entrada manual de datos", "Fuentes de
  datos heterogéneas"]`; coseno 0.44 con `["Eficiencia operativa", "Flujo de trabajo"]`.
  Son dos documentos que no tienen nada que ver y comparten la palabra "datos".
- Los conceptos se comparaban sin filtrar el vocabulario de fondo del silo. En `personal`
  la palabra "modelos" aparecía en el **49%** de los documentos; en `maestria`, "datos" en
  el **46%**. Compartir eso no es evidencia de nada.

## La regla actual

Un par se admite si:

1. `coseno >= PISO` — **0.62** por defecto, o
2. `coseno >= PISO - 0.10` **y** comparten **≥2 conceptos no genéricos**.

Y además la arista tiene que estar en el **top-K** (K=4) de alguno de sus dos extremos.

### De dónde sale 0.62

| distribución de pares | `personal` | `maestria` |
|---|---|---|
| percentil 40 (piso viejo) | 0.387 | 0.402 |
| percentil 75 | 0.501 | 0.547 |
| percentil 90 | 0.579 | 0.649 |
| percentil 95 | **0.624** | 0.704 |

0.62 es aproximadamente el percentil 95 de los pares posibles: de cada cien pares, se
consideran relacionados los cinco más parecidos. Coincide además con
`ALGEDI_CITA_UMBRAL = 0.62`, el piso que ya se exigía para que un pasaje sea citable,
medido aparte (pasajes relevantes 0.69–0.88 contra irrelevantes 0.52–0.58). El criterio
queda coherente: **si un pasaje no es lo bastante parecido como para citarlo, tampoco lo
es para dibujar una línea.**

El piso efectivo es `max(0.62, percentil 90 medido)`. El número configurado pone el
mínimo; el percentil lo **sube** si el corpus es tan homogéneo que hasta los pares
mediocres lo pasarían. Nunca lo baja.

### Por qué compartir conceptos vale 0.10 y no más

Compartir vocabulario propio es evidencia inspeccionable: son palabras que están escritas
en los dos documentos, el usuario puede verlas. Por eso compra algo. Pero no puede
comprar todo, porque el ejemplo de coseno 0.31 de arriba compartía tres conceptos.

### Conceptos genéricos

Una palabra que aparece en **≥15% de los documentos de la sección** no distingue nada y no
cuenta como concepto compartido. Es un filtro medido por sección, no una lista de palabras
prohibidas: "datos" es ruido en el silo de estadística y podría ser el término distintivo
de otro. Debajo de 12 documentos no se filtra nada, porque con esa cantidad la frecuencia
documental no mide (3 de 6 es ruido, no es una frecuencia).

Medido hoy sobre el corpus unificado: `analisis`, `datos`, `lenguaje`, `modelos`.

### Un solo concepto no rescata nada

Hacen falta **2** conceptos no genéricos (`ALGEDI_CONCEPTOS_MINIMOS`). Con uno solo basta
un término medianamente común para fabricar un vínculo.

## Resultado sobre el corpus real

| | antes | después |
|---|---|---|
| aristas | 815 | **575** |
| score mediano | 0.64 | **0.70** |
| score percentil 10 | 0.50 | **0.59** |
| grado mediano por nodo | 6 | **5** |
| grado percentil 90 | 12 | **9** |
| grado máximo | 29 | **21** |
| nodos con más de 12 aristas | 20 | **7** |
| nodos sin ninguna arista | 0 | **10** de 222 |

Diez nodos quedaron aislados. Es el precio correcto: antes tenían aristas que no
significaban nada. Un documento sin relaciones es una afirmación honesta.

De las 575 aristas, **482 entraron por similitud** y **93 por conceptos compartidos**
(`evidencia.admitida_por`), y 455 tienen conceptos compartidos para mostrar
(`base_relacion = explicita`).

## Parámetros

| variable de entorno | default | qué hace |
|---|---|---|
| `ALGEDI_PISO_RELACION` | 0.62 | piso de coseno para unir sólo por vector |
| `ALGEDI_PISO_CONCEPTOS` | 0.52 | piso rebajado cuando comparten conceptos |
| `ALGEDI_CONCEPTOS_MINIMOS` | 2 | conceptos no genéricos necesarios |
| `ALGEDI_DF_GENERICO` | 0.15 | frecuencia documental desde la cual una palabra es genérica |
| `ALGEDI_K_RELACIONES` | 4 | vínculos que conserva cada nodo |

Cambiar cualquiera **exige correr `POST /api/recompute-relations`**: si no, las aristas
viejas siguen en la base afirmando algo que la regla actual ya no sostiene.

## Qué NO se tocó

`ALGEDI_CITA_UMBRAL` (0.62) sigue igual. Bajarlo sin medir haría que el agente cite
pasajes que no sostienen la respuesta, que es el problema opuesto al que resuelve este
documento.
