# Algedi Architect — Contexto y notas de diseño

**Curso:** AI Agents — De la Idea a la Implementación 2026  
**Autor:** Lucas Brusasca  
**Iniciativa:** Architect, módulo de decisión sobre la plataforma Algedi  

## Contexto y elección del problema

El problema elegido ocurre antes de construir una solución de inteligencia artificial. En muchas organizaciones aparece un pedido formulado como “necesitamos un agente”, aunque todavía no se determinó si el problema real está en el proceso, en reglas que podrían automatizarse de forma determinística, en la calidad o integración de los datos, en una tarea probabilística que requiere asistencia o, efectivamente, en una actividad que justifica un agente. Cuando esa clasificación no se realiza, la herramienta se elige antes de comprender la necesidad.

El usuario del piloto es un responsable de innovación o datos de una PyME que recibe aproximadamente seis iniciativas tecnológicas por trimestre y no cuenta con un arquitecto de soluciones dedicado. Para disponer de un escenario calculable —todavía no validado en campo— se supone que preparar cada iniciativa consume ocho horas y que el costo profesional es de USD 25 por hora. Esto representa USD 1.200 trimestrales de preparación. Se incorpora por separado un desarrollo incorrecto de referencia de USD 2.000 por trimestre. Estas cifras son hipótesis explícitas del piloto, no benchmarks externos ni resultados observados.

Elegí este problema porque construir prototipos se volvió más rápido y accesible, pero esa facilidad aumenta el riesgo de implementar soluciones técnicamente posibles que no corresponden al problema. El cuello de botella se desplaza desde “¿podemos programarlo?” hacia “¿qué merece construirse, con qué arquitectura y bajo qué evidencia?”. Además, la decisión suele terminar en una presentación estática: se conserva la conclusión, pero no siempre los pasajes utilizados, las alternativas descartadas, las objeciones ni la aprobación del responsable.

## Arquetipo de solución y decisiones de arquitectura

Architect es un sistema de decisión con agentes especializados y Human-in-the-Loop. Recibe la descripción de una necesidad y un corpus acotado; recupera pasajes con cita; clasifica la intervención entre seis rutas —rediseño, reglas, datos/BI, IA asistiva, agente o no implementar—; compara dos o tres alternativas; somete la propuesta a un verificador crítico; y registra la decisión humana en un expediente persistente.

En el espectro presentado por el curso, el diseño corresponde al **Nivel 4: multiagentes + HITL**, porque combina roles especializados y un checkpoint humano. Esa etiqueta no implica autoridad plena: Architect sólo recomienda. Nunca aprueba una inversión, ejecuta cambios ni elimina controles de la organización. El responsable puede aprobar la ruta, solicitar modificaciones o descartar la iniciativa.

La elección de un sistema de agentes, en lugar de un clasificador aislado, se justifica por el recorrido completo. Una etiqueta no alcanza: la recomendación debe estar conectada con evidencia, alternativas comparables, objeciones y una decisión auditada. La base disponible en Algedi ya incluye ingesta, recuperación por chunks, citas, el objeto Issue/Solve, alternativas, un verificador crítico, persistencia de revisión humana e interfaz React. Sobre esa base se implementó un prototipo Architect: endpoint de seis rutas, matriz común y una interfaz visual que representa —pero no decide— la salida del backend. El benchmark bloqueado, la persistencia específica del expediente y su exportación forman parte del piloto pendiente.

## Riesgo principal y mitigación

El riesgo más importante es que el sistema produzca una recomendación convincente pero incorrecta. El planificador y el verificador pueden compartir sesgos y coincidir en una conclusión débil; separar prompts reduce la correlación, pero no demuestra independencia. También existe el riesgo de citar un pasaje real que no respalda la afirmación formulada. Un tercer riesgo es construir un benchmark autoconfirmatorio mediante paráfrasis de los mismos ejemplos usados para definir las seis rutas. Para evitarlo, al menos tres casos serán ambiguos, redactados por un tercero y etiquetados a ciegas antes de ejecutar Architect.

La mitigación combina controles probabilísticos y determinísticos. Architect sólo puede utilizar marcadores de cita existentes; registra la evidencia faltante; compara la salida contra casos con clasificación esperada; conserva las objeciones del verificador; y exige una decisión humana antes de cerrar el expediente. Si falta evidencia relevante, la salida correcta es abstenerse o pedir información, no completar el hueco con una afirmación plausible. La demostración utilizará material propio, ficticio o públicamente accesible y excluirá documentación confidencial de empleadores, clientes o terceros.

## Qué aprendí durante el diseño

Antes de este proceso tendía a considerar que el diferencial de un agente estaba principalmente en la arquitectura técnica: recuperación, memoria, orquestación y modelos. El Canvas me obligó a reconocer que esos componentes no constituyen valor por sí solos. El diseño sólo se vuelve defendible cuando el usuario, el costo actual, el cambio esperado y el criterio para detener el proyecto están formulados con la misma precisión que el stack.

También aprendí que “no implementar” debe ser una salida de producto y no una excepción incómoda. Si el sistema siempre recomienda construir algo, optimiza la producción de proyectos, no la calidad de la decisión. Finalmente, entendí que un verificador no garantiza verdad ni independencia: su utilidad depende de un protocolo evaluable, citas auditables, casos de prueba y una frontera humana explícita. El resultado valioso de Architect no es una respuesta ni un grafo atractivo, sino un expediente que permite reconstruir por qué se eligió una ruta y qué tendría que cambiar para revisarla.
