# AI Canvas Unificado — Algedi Architect

**Proyecto:** Algedi Architect — gate de decisión trazable para iniciativas de IA  
**Organización:** iniciativa aplicable a responsables de innovación o datos de PyMEs  
**Autor:** Lucas Brusasca  
**Versión:** entrega final — agosto de 2026  

> Los valores de volumen, horas y costos se presentan como un escenario de piloto a validar. No son resultados observados ni benchmarks externos. El Canvas sigue la nomenclatura de las diapositivas del curso; cuando el skill difiere, prevalece el material de clase.

---

## FASE 1 — Problema

### B1 — Pain points & usuarios afectados

**Pain point.** Las iniciativas tecnológicas pueden comenzar con una herramienta elegida de antemano —por ejemplo, “hagamos un agente”— sin clasificar si la necesidad corresponde a rediseño de proceso, reglas, datos/BI, IA asistiva, agente o no implementación. El responsable prepara el caso desde cero y el fundamento de la decisión no queda preservado como expediente reabrible.

**Usuario directo del piloto.** Responsable de innovación o datos de una PyME, sin arquitecto de soluciones dedicado. Escenario: un usuario que evalúa aproximadamente seis iniciativas por trimestre.

**Afectados indirectos.** Dueños de proceso, dirección que aprueba la inversión y equipo que implementaría la alternativa elegida.

**Costo actual — escenario a validar.**

- Preparación: 6 iniciativas × 8 h × USD 25/h = **USD 1.200 por trimestre**.
- Desarrollo incorrecto de referencia: **USD 2.000 por trimestre**.
- Exposición trimestral de referencia: **USD 3.200**.

**Por qué ahora.** Prototipar es más rápido y barato; por eso aumenta el costo relativo de decidir mal qué construir.

### B2 — Proceso As-Is & Data

**Proceso actual.**

| Paso | Actividad | Tiempo supuesto | Fricción |
|---|---|---:|---|
| 1 | Recibir el pedido y reconstruir el problema | 2 h | La necesidad llega expresada como herramienta |
| 2 | Buscar documentos y conversar con referentes | 2 h | Evidencia dispersa, sin inventario ni trazabilidad |
| 3 | Elegir una alternativa técnica | 1 h | No siempre se compara contra “no IA” o “no implementar” |
| 4 | Preparar presentación y estimación | 3 h | Se repite trabajo y se mezclan evidencia y supuestos |
| 5 | Aprobar o descartar | — | Queda la conclusión, no el razonamiento completo |

**Inventario de datos del piloto.**

| Fuente | Formato / volumen | Estado | Gap principal |
|---|---|---|---|
| Descripción inicial del problema | Texto, 1–3 páginas | Disponible | Puede estar sesgada hacia una herramienta |
| Documentos del proceso | 3–10 PDF/MD/planillas | Disponibles y controlados | Calidad variable; requieren chunking y metadatos |
| Costos y tiempos del As-Is | Campos manuales | Sólo supuestos | Deben medirse mediante entrevista o registro horario |
| Historial de decisiones | No existe estructurado | Ausente | No hay alternativas, objeciones ni motivos persistidos |
| Banco de evaluación | 12 casos controlados | A construir y bloquear | Al menos 3 casos ambiguos redactados por un tercero; etiqueta ciega consensuada por dos evaluadores |

**Gaps críticos.** Baseline real de horas, frecuencia y costo; corpus representativo; segunda etiqueta humana; independencia entre los ejemplos usados para definir la taxonomía y los casos de evaluación; criterios comunes para comparar alternativas; y evidencia suficiente para no confundir conocimiento general del modelo con información del caso.

### B3 — Valor de Cambio

**Hipótesis a validar.**

- **H1 técnica:** Architect coincide con la etiqueta consensuada en al menos **10 de 12 casos**, produce **cero referencias inexistentes** y obtiene la misma clase en al menos **4 de 5 repeticiones**.
- **H2 de proceso:** reduce la preparación de una iniciativa de **8 h a 2 h de revisión**.
- **H3 de gobernanza:** el **100% de los expedientes cerrados** conserva evidencia, objeción y decisión humana.

**Valor esperado.** Menos horas de preparación, menor probabilidad de construir una solución incorrecta, comparación explícita contra alternativas simples y memoria organizacional de la decisión.

**Stakeholders beneficiados.** El usuario directo gana tiempo y consistencia; dirección obtiene un caso defendible; los dueños de proceso reciben una alternativa alineada con su necesidad; el equipo técnico evita comenzar con una arquitectura prematura.

**Criterio de abandono.** Si el piloto no alcanza 10/12, registra referencias inexistentes o permite cerrar un expediente sin decisión humana, no avanza a un caso real.

---

## FASE 2 — Solución

### B4 — Solución propuesta

Architect ejecuta el siguiente recorrido funcional:

1. **Recibe** el problema, el objetivo, las restricciones y los documentos del caso.
2. **Recupera** pasajes relevantes y los identifica con citas válidas.
3. **Clasifica** la intervención en una de seis rutas: rediseño, reglas, datos/BI, IA asistiva, agente o no implementar.
4. **Compara** dos o tres alternativas con los mismos criterios: impacto, disponibilidad de datos, complejidad, riesgo y costo.
5. **Verifica** supuestos, restricciones, citas y vacíos de evidencia en un paso separado.
6. **Escala** la recomendación al responsable, que aprueba, solicita cambios o descarta.
7. **Persiste y exporta** un expediente con problema, fuentes, matriz, objeciones, decisión, comentario, fecha y versión.

**Interacción.** Aplicación web de Algedi conectada al endpoint `POST /api/architect/analyze`. El HTML no clasifica mediante reglas: carga el caso, representa la salida del backend y permite registrar la revisión humana. Si el backend no responde, no simula una recomendación.

**Resultado.** Un expediente reabrible y no una conversación descartable. Puede terminar en “no implementar”.

### B5 — Arquitectura & Tools

**Arquitectura de alto nivel.**

```text
Problema + corpus
      ↓
FastAPI / ingesta → chunks + embeddings → PostgreSQL/pgvector
      ↓
retrieve_evidence
      ↓
Planner: clasificación + alternativas + matriz
      ↓
Verifier: objeciones + auditoría de citas
      ↓
Checkpoint humano
      ↓
Expediente persistido → React / exportación
```

**Base verificada en el repositorio.** FastAPI, PostgreSQL/pgvector, ingesta y chunking, recuperación con citas, modelo `Issue.solve`, alternativas, verificador crítico, historial de revisión humana e interfaz React.

**Prototipo Architect implementado.** Endpoint de seis rutas, recuperación, matriz formal, secuencia planner/verifier e interfaz visual conectada. **Pendiente para cerrar el MVP:** benchmark bloqueado, persistencia específica del expediente Architect y exportación Markdown/PDF.

**Tools del agente.**

| Tool | Input | Output | Estado |
|---|---|---|---|
| `ingest_case` | archivos, URL o texto + metadatos | documentos, chunks y nodos | Disponible |
| `retrieve_evidence` | consulta + identificadores del corpus | pasajes, página, fuente y marcador | Disponible |
| `classify_intervention` | problema + evidencia + restricciones | clase, supuestos y faltantes | Prototipo disponible |
| `compare_alternatives` | problema + evidencia + clase | 3–6 alternativas + matriz común | Prototipo disponible |
| `verify_recommendation` | propuesta + citas válidas | veredicto, hallazgos, gaps y cambios | Disponible |
| `record_human_decision` | estado, comentario, usuario y fecha | evento auditable + historial | Disponible |
| `export_dossier` | identificador de expediente | Markdown/PDF versionado | Incremento |

**Stack y trade-offs.** React + FastAPI + PostgreSQL/pgvector + proveedor LLM intercambiable + Docker Compose. Se prioriza reutilizar la plataforma y mantener el piloto local. Esto reduce tiempo y exposición de datos, aunque limita escalabilidad y autenticación empresarial durante el MVP.

### B6 — Behaviour / To-Be

| Paso To-Be | Tiempo estimado | Control |
|---|---:|---|
| Completar brief y cargar corpus | 10–20 min | Usuario confirma objetivo y restricciones |
| Recuperar evidencia | <1 min | Sólo marcadores existentes |
| Clasificar y comparar | 2–5 min | Se muestran supuestos y datos faltantes |
| Verificación crítica | 1–3 min | Puede bloquear o exigir cambios |
| Revisión humana | hasta 90 min | Aprueba, modifica o descarta |
| Persistir y exportar | <10 min | Registro de versión, comentario y fecha |

**Comparación.** As-Is: 8 h de preparación. To-Be: 2 h de revisión total. Es una hipótesis del piloto, no un resultado observado.

**Autonomía y HITL.** Según el espectro del curso, es **Nivel 4 — multiagentes + HITL**. La autoridad operacional permanece acotada a recomendación: ningún cambio se ejecuta sin el responsable.

**Escalamiento.** Se escala cuando falta evidencia relevante, las alternativas tienen riesgos equivalentes, el verificador detecta una cita inválida o la recomendación afectaría presupuesto, políticas o controles. El humano recibe el problema, pasajes, matriz, objeciones y campos faltantes.

**Línea roja.** Architect nunca aprueba inversiones, ejecuta cambios, elimina controles obligatorios, inventa evidencia ni cierra el expediente sin decisión humana.

---

## FASE 3 — Producto

### B7 — Propuesta de valor

**Usuario directo.** Pasa de reconstruir cada caso a revisar un expediente comparable; gana tiempo, consistencia y confianza sobre qué falta.

**Dirección / sponsor.** Recibe una recomendación trazable con alternativas, riesgos, costos y un criterio explícito para no avanzar.

**Dueño de proceso y equipo técnico.** Obtienen una solución proporcional al problema y evitan comenzar por una arquitectura innecesariamente compleja.

**Diferenciación.** Un chat puede recomendar; Architect aplica un protocolo persistente, recupera evidencia, compara también alternativas sin IA, admite “no implementar”, registra objeciones y exige aprobación. Obsidian o una herramienta de grafos organizan conocimiento; Architect gobierna el paso de evidencia a decisión.

### B8 — Customers

**Segmento primario.** Responsable de innovación, datos o transformación en una PyME sin arquitecto dedicado.

**Usuario del piloto.** Una persona que evalúa seis iniciativas trimestrales en el escenario inicial.

**Sponsor.** Dirección o dueño de la inversión. **Stakeholders:** dueños de proceso y equipo implementador.

**Canales.** Aplicación web local de Algedi para el piloto; expediente Markdown/PDF para el decisor; soporte directo del autor. No se define todavía un SaaS ni un canal comercial.

**Adopción.** Piloto guiado de dos semanas, un caso end-to-end y revisión conjunta de aciertos y fallos. Barreras: percepción de “otro chat”, costos no medidos, desconfianza en las citas y resistencia a registrar una decisión. Se mitigan mostrando el expediente, etiquetando supuestos y publicando fallos.

### B9 — Revenue, costos y recursos

**Tipo de iniciativa.** Proyecto interno / activo de validación. No se proyectan ingresos comerciales en el TP.

**Escenario económico.**

| Concepto | Cálculo | Resultado |
|---|---:|---:|
| Ahorro de preparación | USD 1.200 − USD 300 | USD 900/trimestre |
| Error evitado esperado | USD 2.000 × 50% | USD 1.000/trimestre |
| Beneficio esperado | 900 + 1.000 | USD 1.900/trimestre |
| Inversión incremental | 40 h × USD 25 + USD 40 | USD 1.040 |

- **ROI primer trimestre:** (1.900 − 1.040) / 1.040 = **82,7%**.
- **Payback base:** 1,6 meses.
- **Sensibilidad sin ahorro por error evitado:** 1.040 / (900/3) = **3,5 meses**.

Todo el modelo es hipotético. La inversión histórica de Algedi queda fuera del análisis incremental.

**Recursos.** Datos: corpus y benchmark; talento: autor + dos evaluadores para etiquetar; infraestructura: equipo local, Docker y costo de inferencia; propiedad intelectual: taxonomía, prompts, esquemas, benchmark y expediente.

---

## FASE 4 — Implementación y Viabilidad

### B10 — Integración & Infra

**Pipeline.** Archivos/texto → extracción → chunks con página/metadatos → embeddings → PostgreSQL/pgvector → recuperación → agentes → expediente.

**Integraciones del MVP.** Sólo componentes locales de Algedi y proveedor LLM. No se integran ERP, bancos, correo, SharePoint ni sistemas productivos.

**Permisos y seguridad.** Corpus propio, ficticio o público; mínimo privilegio; sin credenciales de terceros; registro de fuentes; ejecución local; validación de URLs públicas; aprobación humana obligatoria.

**Calidad.** Corpus pequeño y curado; duplicados y documentos desactualizados deben marcarse; las cifras ingresadas por el usuario se distinguen de evidencia documental; una cita válida debe respaldar realmente la afirmación, no sólo existir.

**Reality check.** La principal brecha no es un conector: es disponer de baseline real, evidencia suficiente y dos evaluadores que bloqueen la etiqueta esperada antes de ejecutar el benchmark.

### B11 — MVP & Riesgos

**MVP de dos semanas.** Demuestra el 100% de un recorrido: reporte mensual de planillas + corpus controlado → recuperación → clase → alternativas → verificación → decisión humana → expediente.

**MoSCoW.**

- **Must:** seis clases; evidencia citada; 2–3 alternativas; matriz común; verificador; decisión persistida; 12 casos, incluyendo al menos 3 ambiguos no derivados de los ejemplos de diseño.
- **Should:** exportación Markdown/PDF y repetición automatizada.
- **Could:** panel agregado de métricas.
- **Won't:** sistemas productivos, SaaS multiusuario, avatar, grafo 3D como demo central, research académico autónomo.

**Gate, medido al cierre de las dos semanas.** 10/12 clasificaciones; cero referencias inexistentes; 100% de decisiones humanas registradas; al menos 90% de afirmaciones relevantes con fuente o marcadas como supuesto.

**Registro de riesgos.**

| Riesgo | Prob. | Impacto | Mitigación | Responsable |
|---|---|---|---|---|
| Planner y verifier coinciden y se equivocan | Alta | Alto | Benchmark, controles determinísticos, HITL | Autor |
| Cita existente pero irrelevante | Media | Alto | Auditoría claim-cita y muestra manual | Autor + evaluador |
| Baseline y costos no medidos | Cierta | Medio | Etiquetar escenario y medir piloto | Autor |
| Taxonomía ambigua | Media | Alto | Dos etiquetas, resolver discrepancias antes del test | Evaluadores |
| Benchmark autoconfirmatorio | Alta | Alto | Casos ambiguos redactados por un tercero, etiquetado ciego y conjunto bloqueado | Evaluadores |
| Corpus pobre o sesgado | Media | Alto | Curación, faltantes explícitos, abstención | Autor |
| Información confidencial | Baja | Alto | Sólo material propio, ficticio o público | Autor |

### B12 — Métricas, roadmap & próximos pasos

**Métricas técnicas.** 10/12; cero citas inexistentes; 90% claim-cita o supuesto; consistencia 4/5; tiempo de corrida <10 min.

**Métricas de producto.** 100% expedientes con decisión; utilidad del revisor ≥4/5; máximo dos ciclos de corrección; porcentaje de campos completados sin edición.

**Métricas de negocio.** Horas reales As-Is vs To-Be; ahorro realizado; costo de inferencia; payback recalculado; iniciativas que terminan en una alternativa más simple o en no implementar.

**Roadmap del piloto.**

1. **Días 1–2:** cerrar taxonomía y schemas; encargar al menos tres casos ambiguos y bloquear las etiquetas de los doce casos — responsable: autor + evaluadores.
2. **Días 3–7:** implementar clasificación, matriz y expediente — responsable: autor.
3. **Días 8–10:** integrar UI, historial y exportación — responsable: autor.
4. **Días 11–12:** ejecutar benchmark bloqueado y cinco repeticiones — responsable: autor.
5. **Días 13–14:** medir, publicar aciertos/fallos y decidir continuidad — responsable: autor + revisor.

**Post-MVP.** Fase 2: un caso real sanitizado y baseline medido. Fase 3: ampliar corpus y roles sólo si se mantiene el gate. Fase 4: evaluar autenticación, multiusuario e integraciones; no escalar antes de demostrar valor repetible.

**Decisiones pendientes.** Identificar segundo evaluador; reemplazar cifras supuestas por medición; elegir corpus definitivo; y definir quién asumiría el rol de sponsor en un piloto organizacional.

---

## Estado de preparación

| Área | Estado | Observación |
|---|---|---|
| Problema y alcance | Listo para presentar | Cifras rotuladas como hipótesis |
| Base técnica de Algedi | Verificada | Solve y HITL existen; endpoint Architect conectado |
| Canvas 12 bloques | Completo | Remapeado a la nomenclatura del curso |
| Evaluación | Diseñada | Banco y etiquetas todavía deben ejecutarse |
| Caso económico | Calculado | Requiere sensibilidad y datos reales |
