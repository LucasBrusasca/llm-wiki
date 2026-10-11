# Búsqueda: MiniLM → multilingual-e5-small (2026-10-11)

Medido con `eval/evaluar_busqueda.py` sobre `preguntas_busqueda_v1.json`: 38 preguntas
en lenguaje natural, cada una con los documentos que la responden. 231 documentos y
11.657 fragmentos.

**Ojo con el sesgo.** Las preguntas las escribió Claude mirando los títulos y resúmenes
de los documentos. Eso favorece al vector del documento entero (que se arma con ese
mismo resumen). Hacen falta preguntas escritas por Lucas para confirmar; se agregan al
mismo JSON y se vuelve a correr el script.

## Documentos (buscador y «documentos relevantes» del agente)

| método | acierto@1 | acierto@5 | recall@10 | MRR |
|---|---|---|---|---|
| MiniLM · documento entero (antes) | 0.47 | 0.74 | 0.73 | 0.61 |
| MiniLM · mejor fragmento | 0.34 | 0.68 | 0.63 | 0.49 |
| **e5 · documento entero (ahora)** | **0.61** | **0.89** | **0.80** | **0.73** |
| e5 · mejor fragmento | 0.45 | 0.68 | 0.65 | 0.54 |
| BM25 (palabras) · mejor fragmento | 0.34 | 0.63 | 0.53 | 0.45 |
| híbrido e5 fragmento + BM25 (RRF) | 0.50 | 0.71 | 0.62 | 0.59 |
| híbrido e5 documento + fragmento + BM25 | 0.53 | 0.76 | 0.66 | 0.62 |
| ídem con el documento ×3 | 0.53 | 0.79 | 0.74 | 0.64 |

- e5 lee 512 tokens; MiniLM cortaba en 128 (veía la mitad de cada fragmento y nunca los
  conceptos del final del texto del documento).
- Para DOCUMENTOS, fusionar con fragmentos o con palabras empeora: las otras listas son
  bastante más flojas y RRF las promedia. Se queda el vector del documento solo.
- Para PASAJES (lo que cita el agente) la fusión sí suma: MRR 0.54 → 0.59 frente a e5
  solo, 0.49 → 0.59 frente a lo que había. Es lo que usa `_chunks_relevantes_scored`.

## Umbrales

Cada modelo tiene su escala de coseno (con e5 la mediana de los pares de documentos es
0.82; con MiniLM era 0.40). `eval/calibrar_umbrales.py` traslada cada umbral con datos;
resultado en `calibracion_e5.json` y en `processor.UMBRALES_POR_MODELO`.

| umbral | MiniLM | e5 | cómo |
|---|---|---|---|
| piso de relación | 0.62 | 0.862 | mismo percentil de los pares (deja arriba el 6 %) |
| piso con conceptos compartidos | 0.52 | 0.841 | mismo percentil (19 %) |
| «complementa» | 0.75 | 0.895 | mismo percentil (1 %) |
| citar (agente) | 0.62 | 0.86 | preguntas con y sin respaldo |
| abstenerse sin consultar (agente) | 0.28 | 0.784 | ídem |

Con 0.86 el agente cita en 35 de 38 preguntas con respaldo y en 1 de 15 fuera de tema
(MiniLM con 0.62: 34 de 38 y 0 de 15). El margen de e5 es angosto: las preguntas fuera
de tema llegan a 0.86. Es el lugar donde un juez de «¿esto alcanza para responder?»
(reranker o modelo de decisión) rendiría más que un umbral fijo.
