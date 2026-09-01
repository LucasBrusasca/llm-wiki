# Algedi — Visión de producto y plan de evolución

## Propósito de este documento

Este documento es la referencia canónica para evolucionar Algedi desde el prototipo actual
hacia una plataforma de inteligencia aplicada. Separa explícitamente:

- lo que existe hoy;
- lo que debe validarse como MVP;
- la arquitectura objetivo;
- lo que queda fuera de alcance por ahora.

Algedi es un proyecto independiente. No debe mezclar código, datos, configuración ni historia
con otros repositorios o proyectos.

## Visión

Algedi transforma problemas reales en soluciones fundamentadas combinando:

1. conocimiento privado del usuario o la organización;
2. papers, métodos, modelos, código y evidencia externa;
3. comprensión de procesos y restricciones;
4. generación de alternativas;
5. revisión crítica y verificación;
6. aprobación o corrección humana;
7. trazabilidad completa desde cada recomendación hasta sus fuentes.

El grafo 3D es memoria, navegación y explicación. No es el valor central. El valor central es
producir una solución implementable, verificable y revisable.

## Los tres motores

### Algedi Context

Administra el conocimiento privado:

- documentos y archivos originales;
- páginas web y videos;
- proyectos y espacios;
- procesos actuales;
- conceptos, relaciones y grafos;
- fragmentos recuperables con procedencia;
- historial y decisiones del usuario.

### Algedi Research

Incorpora evidencia externa seleccionada:

- papers y revisiones;
- métodos y modelos aplicables;
- datasets y código;
- condiciones de aplicación;
- limitaciones y calidad de evidencia;
- procedencia bibliográfica estable.

Research no debe convertirse inicialmente en una biblioteca universal. Para el MVP recupera
un número pequeño de fuentes relevantes y conserva metadatos y citas.

#### Flujo futuro de Research

```text
pregunta de investigación
→ descomposición en consultas
→ búsqueda en proveedores académicos
→ deduplicación por DOI/identidad bibliográfica
→ selección por relevancia y calidad
→ extracción de método, resultados y limitaciones
→ identificación de modelos, código y datasets
→ vinculación con conocimiento privado
→ entrega de evidencia a Solve
→ actualización controlada cuando aparece evidencia nueva
```

Research debe distinguir explícitamente:

- evidencia primaria, revisiones y fuentes secundarias;
- texto completo, abstract y simple mención bibliográfica;
- resultado reportado, interpretación de Algedi y supuesto;
- método aplicable y condiciones bajo las cuales deja de ser aplicable;
- evidencia favorable, contradictoria o insuficiente;
- fecha de consulta y posibilidad de que la evidencia haya quedado desactualizada.

Cada paper puede representarse como un subgrafo: problema, método, datos, métricas,
resultados, limitaciones, código, autores y trabajos relacionados. Solve no consume el paper
como un bloque opaco: consume estas piezas con su procedencia.

### Algedi Solve

Orquesta una corrida de resolución de problema:

1. recibe problema, proceso, objetivo, datos y restricciones;
2. reconstruye el proceso actual (AS-IS);
3. recupera evidencia privada;
4. solicita evidencia externa acotada a Research;
5. identifica métodos y modelos aplicables;
6. genera dos o tres alternativas;
7. verifica restricciones, evidencia y viabilidad;
8. recomienda una alternativa o se abstiene;
9. genera proceso futuro (TO-BE), arquitectura y roadmap;
10. explicita riesgos, costos, supuestos y KPIs;
11. queda en borrador hasta revisión humana;
12. registra aprobación, rechazo o correcciones.

## Flujo de producto objetivo

```text
Problema
→ comprensión y flujograma AS-IS
→ recuperación de conocimiento privado
→ búsqueda acotada de evidencia externa
→ identificación de métodos/modelos
→ generación de 2–3 alternativas
→ revisión crítica
→ verificación de restricciones y citas
→ recomendación o abstención
→ flujograma TO-BE
→ arquitectura y roadmap
→ riesgos, costos y KPIs
→ revisión y aprobación humana
→ artefacto final trazable
```

## Estado actual verificado

### Implementado

- Backend FastAPI.
- Frontend React/Vite.
- PostgreSQL y pgvector.
- Ingesta de PDF, Word, PowerPoint, Excel, HTML/web, texto/Markdown y YouTube.
- Transcripts de YouTube cuando están disponibles y expansión de playlists.
- Embeddings multilingües de 384 dimensiones.
- UMAP, PCA y HDBSCAN.
- Grafo semántico por similitud y conceptos compartidos.
- Visualización 3D con distintas disposiciones.
- Secciones o dominios.
- Búsqueda semántica.
- Agente con tres modos explícitos: pasajes citables, resúmenes orientativos y conocimiento general etiquetado.
- Trazabilidad `Source → Document → Chunk`, embeddings de pasajes y citas con página cuando está disponible.
- Biblioteca, backup/importación, reportes y síntesis.
- Issue con perspectivas de procesos, riesgos, creatividad y Red Team.
- Primer flujo Algedi Solve persistido dentro del Issue: entrada estructurada, 2-3 alternativas,
  recomendación, proceso futuro, roadmap, riesgos, KPIs y vacíos de información.
- Verificador crítico separado del planificador y decisión humana persistida (`pending`,
  `approved` o `revision_requested`) con historial.
- Generación de procesos y flujogramas.
- Descubrimientos heurísticos de puentes, silos, huecos y nodos aislados.

### Experimental

- Umbral de veto del agente, todavía sin calibración empírica.
- Solve MVP: implementado como vertical experimental sobre Issue; todavía no tiene entidades
  independientes `Problem`, `Constraint` y `SolveRun` ni versionado reproducible completo.
- Procesos: el resultado no tiene persistencia de dominio completa.
- Descubrimientos: son heurísticas estructurales, no verificación de contradicciones.
- Ingesta continua por carpeta `vault/`, todavía sin integrar formalmente al historial Git.
- Taxonomía generada por LLM.
- HTML enriquecido generado por LLM.

### Sólo visión o pendiente

- Algedi Research y conectores científicos.
- Modelo explícito de claims y evidencia.
- Costos y restricciones como objetos verificables.
- Arquitectura técnica generada como artefacto independiente.
- Aprobación humana con identidad, roles y firma; el MVP actual registra decisión y comentario local.
- Multiusuario y control de acceso por workspace.
- Evolución temporal del conocimiento.
- Federación mediante MCP.
- Grafo de grafos y teseracto visual.

## MVP prioritario

El MVP debe demostrar un único recorrido completo sobre un problema real pequeño.

### Entrada

- descripción del problema;
- objetivo;
- proceso actual;
- datos disponibles;
- restricciones duras y blandas;
- criterios de éxito;
- fuentes privadas seleccionadas.

### Salida

- flujograma AS-IS;
- fuentes privadas recuperadas y sus pasajes;
- entre tres y ocho papers o fuentes externas relevantes;
- métodos/modelos candidatos;
- dos o tres soluciones alternativas;
- matriz alternativa × restricción;
- revisión crítica y estado de verificación;
- recomendación o abstención;
- flujograma TO-BE;
- arquitectura propuesta;
- roadmap incremental;
- riesgos, supuestos, costos y KPIs;
- citas y trazabilidad;
- estado de aprobación humana.

### Criterios de aceptación

1. Cada afirmación relevante debe enlazar con evidencia o quedar marcada como supuesto.
2. Una restricción incumplida debe ser visible y puede bloquear una alternativa.
3. El verificador debe poder devolver `aprobable`, `requiere_revision` o `bloqueada`.
4. El usuario debe poder corregir el problema, proceso, evidencia o recomendación.
5. Una corrida debe ser reproducible: modelo, prompts, fuentes y versiones quedan registrados.
6. El resultado no se considera final hasta aprobación humana.
7. El sistema debe poder abstenerse si la evidencia no alcanza.

## Arquitectura objetivo

Se mantiene inicialmente un monolito modular para evitar complejidad operativa prematura.

```text
React
  ├─ Context workspace
  ├─ Research evidence
  ├─ Solve workspace
  └─ Review/approval

FastAPI
  ├─ identity/access
  ├─ sources/ingestion
  ├─ retrieval
  ├─ graph
  ├─ research
  ├─ solve orchestration
  ├─ verification
  └─ artifacts/approvals

PostgreSQL + pgvector
Object/file storage
Durable job queue backed by PostgreSQL initially
```

### Entidades principales

- `Workspace`: límite de aislamiento.
- `Source`: archivo, URL, paper o dataset original.
- `Document`: versión procesada de una fuente.
- `Chunk`: pasaje recuperable con posición/página.
- `Concept` y `Relation`: capa de grafo derivada.
- `Claim`: afirmación usada en un análisis.
- `EvidenceLink`: vínculo entre claim y chunk/fuente.
- `Problem`: definición versionada del problema.
- `Constraint`: restricción verificable.
- `SolveRun`: ejecución reproducible.
- `Alternative`: solución candidata.
- `Verification`: resultado por restricción, evidencia y riesgo.
- `Artifact`: flujograma, arquitectura, roadmap o informe.
- `HumanReview`: comentario, corrección, aprobación o rechazo.

### Estados de una corrida

```text
draft
→ retrieving_context
→ researching
→ generating_alternatives
→ verifying
→ needs_human_review
→ approved | changes_requested | rejected | blocked
```

## Visión de grafo de grafos y 4D

Esta visión forma parte del norte de Algedi, pero se implementa después de demostrar el MVP.
No significa simplemente dibujar más dimensiones ni crear un efecto visual. Significa modelar
la evolución del conocimiento y las relaciones entre distintos espacios.

### Grafo de grafos

Cada unidad importante puede tener su propio grafo:

- una sección o workspace de conocimiento privado;
- un proyecto;
- un proceso;
- una investigación;
- una corrida de Solve;
- una persona o equipo, cuando exista multiusuario;
- un dominio experto o agente especializado.

Estas unidades se representan además como supernodos dentro de un grafo superior. Los puentes
entre grafos deben tener significado explícito: fuente compartida, concepto común, dependencia,
contradicción, transferencia de método, persona participante o decisión derivada.

Ejemplo:

```text
Grafo Operaciones ── comparte proceso ──► Solve #18
       │                                  │
       └─ contradice definición ─► Grafo Finanzas

Grafo Research RAG ── aporta método ─────► Solve #18
```

La federación no debe copiar indiscriminadamente todo entre espacios. Cada puente conserva
permisos, procedencia, versión y razón de existencia.

### La cuarta dimensión: tiempo

Las coordenadas `x/y/z` representan una proyección semántica. La cuarta dimensión `t` representa
el tiempo y la versión del conocimiento:

- cuándo apareció una fuente o concepto;
- cómo cambió su interpretación;
- cómo evolucionaron clusters y relaciones;
- qué conocimiento estaba disponible al tomar una decisión;
- cuándo una evidencia fue reemplazada, contradicha o quedó obsoleta;
- cómo una solución aprobada impactó posteriormente en procesos y KPIs.

No se deben sobrescribir silenciosamente los estados anteriores. Algedi conserva snapshots o
eventos que permitan reconstruir el grafo tal como era en un momento determinado.

### Experiencia 4D futura

La interfaz puede usar la metáfora de teseracto o hipercubo para navegar cuatro ejes, pero su
utilidad debe expresarse mediante acciones comprensibles:

- deslizador temporal para ver el grafo en una fecha;
- comparación antes/después entre dos snapshots;
- trayectorias de nodos o conceptos que cambian de cluster;
- aparición y desaparición de puentes;
- capas por Context, Research y Solve;
- expansión de un supernodo hacia su grafo interno;
- vista de decisiones y evidencia disponible en cada momento;
- reproducción de la evolución de un problema hasta su solución.

La visualización 4D se considera exitosa sólo si ayuda a responder preguntas como:

- “¿Qué cambió desde que tomamos esta decisión?”
- “¿Qué evidencia no existía cuando aprobamos esta solución?”
- “¿Qué concepto conectó dos áreas que antes estaban aisladas?”
- “¿Qué solución produjo una mejora medible y cuál quedó obsoleta?”

### Requisitos previos para construir 4D

Antes deben existir:

1. identidad estable de fuentes, documentos, chunks y conceptos;
2. versionado y eventos temporales;
3. procedencia de relaciones;
4. workspaces y permisos;
5. Solve Runs persistentes;
6. métricas históricas y decisiones humanas registradas;
7. una experiencia 2D/3D clara que pueda extenderse sin perder usabilidad.

Por eso 4D es una consecuencia de tener datos temporales confiables, no una feature visual que
se construye primero.

## Trazabilidad

Cada corrida debe conservar:

- identidad y versión de las fuentes;
- hashes de archivos;
- chunks/páginas recuperados;
- scores de recuperación;
- consultas externas y fecha;
- modelo, proveedor y versión de prompts;
- claims producidos;
- citas por claim;
- restricciones evaluadas;
- hallazgos del crítico/verificador;
- intervención y decisión humana;
- versiones de todos los artefactos.

Una referencia a un título de documento no alcanza: la unidad mínima de evidencia debe ser un
pasaje localizable dentro de una fuente.

### Conocimiento documental y conocimiento general

Algedi no debe quedar mudo cuando la biblioteca privada no cubre una pregunta. Puede aportar
conocimiento general del modelo, siempre que no lo presente como evidencia recuperada.

La interfaz y la auditoría distinguen tres modos:

- `chunks`: respuesta respaldada por pasajes citables de la biblioteca;
- `summaries`: orientación basada en resúmenes documentales, todavía sin cita fina;
- `general`: conocimiento general, identificado explícitamente como no respaldado por la biblioteca.

Una respuesta puede combinar evidencia y conocimiento general, pero debe separarlos visualmente.
Para decisiones de alto impacto o datos específicos, la falta de evidencia puede igualmente
bloquear una recomendación aunque se permita ofrecer una explicación general.

## Seguridad mínima

Antes de exponer Algedi fuera de localhost:

- autenticación para toda la API;
- autorización por workspace;
- CORS restringido;
- protección CSRF cuando corresponda;
- sanitización de Markdown y HTML;
- sandbox estricto para previews;
- protección SSRF en URLs;
- límites y validación de uploads;
- rate limiting para operaciones costosas;
- secretos fuera del repositorio;
- PostgreSQL no expuesto públicamente;
- auditoría de acciones y corridas;
- jobs durables, sin depender de estado global en memoria.

## Roadmap incremental

### Fase 0 — estabilización

- Preservar e integrar correctamente el vault.
- Corregir arranque Docker y healthchecks.
- Ejecutar con un único worker mientras haya estado en memoria.
- Corregir aislamiento entre secciones e Issues.
- Corregir consistencia de UMAP incremental.
- Agregar pruebas focalizadas y migraciones versionadas.
- Resolver riesgos de seguridad críticos.

### Fase 1 — Context trazable

- Implementar `Source → Document → Chunk`.
- Conservar archivos originales por hash.
- Recuperar pasajes y páginas.
- Mostrar citas clickeables.
- Mantener el grafo 3D como vista explicativa.

Estado: base implementada. Falta conservar originales por hash de forma completa y mejorar la
navegación directa desde cada cita.

### Fase 2 — Solve vertical

- Crear `Problem`, `Constraint` y `SolveRun`.
- Persistir AS-IS, alternativas, TO-BE y artefactos.
- Implementar matriz de restricciones.
- Generar recomendación en estado borrador.

Estado: primer vertical implementado sobre `Node.solve`. Permite generar y conservar alternativas,
proceso futuro, roadmap, riesgos, KPIs, revisión crítica y decisión humana. La siguiente evolución
debe separar estas estructuras en entidades versionadas y agregar una matriz formal de restricciones.

### Fase 3 — Research acotado

- Integrar uno o dos proveedores académicos.
- Recuperar pocos papers relevantes.
- Guardar DOI y metadatos bibliográficos.
- Extraer método, condiciones, resultados y limitaciones.

### Fase 4 — verificación reflexiva

- Verificador independiente.
- Auditoría de citas y cobertura de restricciones.
- Detección de claims sin respaldo.
- Una iteración automática controlada de revisión.

Estado: existe un primer verificador independiente con veredicto, hallazgos, vacíos de evidencia y
cambios requeridos. Aún falta auditoría determinista de cada claim y la iteración automática.

### Fase 5 — aprobación humana

- Solicitar cambios, aprobar, rechazar o bloquear.
- Versionar artefactos y evidencia.
- Exportar un informe final aprobado.

Estado: aprobación o solicitud de corrección persistidas localmente con historial. Faltan rechazo,
bloqueo, identidad del revisor, versionado de artefactos y exportación final.

## Fuera de alcance del MVP

- biblioteca masiva de papers;
- multiusuario empresarial completo;
- todos los conectores posibles;
- temporalidad avanzada;
- grafo de grafos;
- teseracto o nueva visualización compleja;
- arquitectura distribuida de microservicios;
- ejecución autónoma de cambios sin aprobación humana.

## Principios de decisión

1. Construir verticalmente, no por acumulación de features aisladas.
2. Evidencia antes que elocuencia.
3. Abstención antes que una recomendación no respaldada.
4. Artefactos persistentes antes que respuestas transitorias.
5. Revisión humana antes que autonomía irreversible.
6. El grafo explica y conecta; Solve entrega el valor.
7. No ampliar el alcance hasta demostrar el recorrido completo del MVP.
