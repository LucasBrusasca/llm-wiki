# TP Final — Definición canónica de Algedi

**Proyecto:** Algedi — sistema multiagente para diseñar y evaluar iniciativas de IA  
**Subtítulo:** De evidencia dispersa a una decisión trazable  
**Autor:** Lucas Brusasca  
**Fecha:** 20 de agosto de 2026  
**Caso piloto:** una necesidad real y sanitizada de Caminos de las Sierras

> Este documento fija la definición del proyecto para el TP. Reemplaza los encuadres anteriores
> de “grafo 3D con chat”, “second brain” y “consultora genérica” como relato principal. Esos
> componentes pueden seguir existiendo, pero quedan subordinados al recorrido de decisión.

## Definición en una frase

**Algedi es un sistema multiagente que transforma documentos y contexto organizacional en una
iniciativa de IA priorizada, diseñada y evaluada, con evidencia trazable, un AI Canvas completo,
análisis de viabilidad y aprobación humana.**

## El problema que resuelve

Muchas organizaciones expresan la intención de “usar IA”, pero carecen de un proceso repetible
para convertirla en una decisión de inversión. El diagnóstico depende de especialistas escasos,
la evidencia está dispersa en documentos y conversaciones, las alternativas no siempre se
comparan contra mejoras de proceso o automatizaciones simples, y el razonamiento suele terminar
en un informe estático difícil de auditar o actualizar.

El usuario directo es el responsable de innovación, datos o transformación que debe convertir
una necesidad ambigua en un proyecto defendible ante dirección. Los beneficiarios indirectos son
los dueños de procesos y los equipos que implementarían la iniciativa. El decisor es la autoridad
que aprueba presupuesto y asume el riesgo de ejecución.

El costo actual se medirá en el piloto mediante cuatro variables, sin inventar cifras:

- horas profesionales destinadas al discovery y armado de la propuesta;
- tiempo calendario desde la necesidad inicial hasta una decisión;
- costo de apoyo externo, si existe;
- costo esperado de iniciar una solución mal definida.

La hipótesis de valor es reducir al menos un 60 % las horas de preparación de un primer caso de
negocio, preservando el razonamiento y sin reemplazar la decisión humana.

## La solución definitiva

Algedi incorpora la metodología “AI Agents — De la idea a la implementación” como un workflow
ejecutable de cuatro fases:

1. **Problema e inteligencia:** identifica pain point, usuarios afectados, proceso As-Is, datos,
   costo actual e hipótesis de cambio.
2. **Solución y arquitectura:** compara alternativas, selecciona el arquetipo apropiado, define
   arquitectura, herramientas, autonomía, HITL y proceso To-Be.
3. **Producto y negocio:** formula la propuesta de valor, los segmentos, el canal, los costos y
   el modelo de ROI.
4. **Implementación y viabilidad:** revisa datos e integraciones, acota el MVP, registra riesgos,
   fija métricas y produce el roadmap.

El sistema debe considerar explícitamente alternativas que no usen IA. Una corrida puede concluir
que conviene mejorar el proceso, automatizar con reglas, construir analítica tradicional o no
construir nada. Algedi no existe para recomendar IA; existe para mejorar la calidad de la decisión.

## Equipo de agentes

El MVP utiliza un patrón supervisor/subagentes sobre un estado compartido y versionado:

| Nodo | Responsabilidad | Artefacto principal |
|---|---|---|
| Supervisor | Controla el recorrido, estado y criterios de avance | Plan de corrida |
| Diagnóstico | Extrae problemas, usuarios, As-Is, datos y evidencia | Diagnóstico priorizado |
| Diseño | Compara solución de proceso, automatización, analítica y agentes | Alternativas y To-Be |
| Negocio | Estima beneficios, costos, supuestos, ROI y payback | Business case |
| Viabilidad | Define integraciones, MVP, riesgos, métricas y roadmap | Plan de implementación |
| Verificador | Detecta contradicciones, claims sin respaldo y bloques incompletos | Informe crítico |

No se crea un agente por cada bloque del Canvas. Los agentes representan responsabilidades
coherentes; los doce bloques son el contrato estructurado de salida.

## Human-in-the-Loop

El nivel de autonomía es **Nivel 1 — Recomendación**: Algedi analiza y propone; una persona
aprueba, corrige o rechaza antes de avanzar.

Hay tres checkpoints obligatorios:

1. aprobación del diagnóstico y del problema elegido;
2. aprobación de la alternativa y del proceso To-Be;
3. aprobación del Canvas, la viabilidad y la recomendación final.

### Línea roja

Algedi nunca debe:

- aprobar una inversión o decidir “construir” en nombre de la organización;
- presentar conocimiento general del modelo como evidencia documental;
- ocultar ausencia, contradicción o baja calidad de evidencia;
- ejecutar cambios en sistemas externos;
- producir un resultado final sin aprobación humana explícita.

## Trazabilidad

La unidad de valor no es la visualización del grafo, sino una corrida de diseño versionada:

```text
Source → Evidence → Claim → Pain Point → Alternative
       → Canvas Block → Risk → Human Review → Decision
```

Cada afirmación relevante debe registrar la fuente, el fragmento utilizado, su clasificación
como evidencia recuperada o conocimiento general, el agente y modelo que la generó, la versión
del prompt, el nivel de confianza y las correcciones humanas posteriores.

## MVP del TP

El MVP demuestra el 100 % de un solo recorrido sobre un problema real pequeño y sanitizado.

### Entrada

- descripción inicial del problema;
- proceso actual y objetivo esperado;
- restricciones conocidas;
- corpus acotado de documentos del caso piloto;
- datos básicos para estimar tiempo y costo.

### Recorrido

1. Ingesta y recuperación del contexto relevante.
2. Diagnóstico de problemas con citas.
3. Selección humana de un problema.
4. Generación y comparación de dos o tres alternativas, incluida una sin IA.
5. Selección humana de una alternativa.
6. Generación de los doce bloques del AI Canvas.
7. Análisis de viabilidad, riesgos, ROI y MVP.
8. Verificación independiente.
9. Corrección y aprobación humana.
10. Exportación del informe y persistencia de la corrida en el grafo.

### Salida demostrable

- un diagnóstico priorizado;
- dos o tres alternativas comparadas;
- un AI Canvas completo;
- un business case con supuestos editables;
- riesgos, métricas y roadmap;
- recomendación `construir`, `reformular` o `no construir`;
- citas y registro de las decisiones humanas;
- exportación en Markdown y PDF.

### Fuera del MVP

- ejecutar la solución recomendada;
- agentes con herramientas autónomas sobre sistemas productivos;
- comparar patrones entre muchas empresas;
- SaaS empresarial multiusuario;
- investigación académica masiva;
- memoria episódica independiente para cada agente;
- handoffs dinámicos no controlados;
- grafo 4D o teseracto;
- nueva visualización compleja.

## Arquitectura

```text
Fuentes del caso
      ↓
Algedi Context: extracción, chunks, embeddings y grafo
      ↓
LangGraph: Supervisor → Diagnóstico → Diseño → Negocio → Viabilidad
      ↓                                      ↘
      └──────── checkpoints humanos ← Verificador
      ↓
PostgreSQL + pgvector: evidencia, estado, artefactos y revisiones
      ↓
React: recorrido guiado, Canvas, citas, revisión y exportación
```

Se reutiliza la plataforma existente: FastAPI, PostgreSQL/pgvector, ingesta multimodal,
embeddings locales, recuperación, LangGraph, React y Docker Compose. El grafo 3D funciona como
memoria y superficie explicativa; no es la propuesta de valor principal.

## Diferenciación

Algedi no compite por ser otra aplicación de notas, otro visualizador de grafos o un asistente
general. Su posición es **evidencia a decisión**:

- organiza una metodología de diseño completa y repetible;
- compara IA contra alternativas más simples;
- conserva el vínculo entre fuente, afirmación, bloque y decisión;
- aplica verificación, abstención y checkpoints humanos;
- produce artefactos organizacionales versionados, no una conversación descartable;
- mide la calidad técnica, la utilidad para el usuario y el impacto de negocio.

Obsidian puede organizar notas, una herramienta de grafos puede estructurar relaciones y un
agente general puede leer archivos o ejecutar tareas. Algedi agrega el workflow gobernado que
convierte ese conocimiento en una recomendación defendible.

## Métricas de éxito del MVP

### Técnicas

- al menos 90 % de los claims sustantivos con una cita verificable;
- 100 % de las salidas válidas contra el esquema de los doce bloques;
- 100 % de las corridas finales con aprobación humana registrada;
- cero citas inexistentes en el conjunto de evaluación;
- abstención explícita cuando no exista evidencia suficiente.

### Producto

- primer borrador completo en un máximo de cuatro horas desde que el corpus está preparado;
- al menos 80 % de los bloques aceptados con cambios menores por el revisor;
- máximo de dos ciclos de corrección para llegar a una versión aprobada;
- utilidad percibida por el usuario piloto igual o superior a 4 sobre 5.

### Negocio

- reducción de al menos 60 % de las horas profesionales frente al baseline del caso piloto;
- reducción del tiempo calendario hasta una decisión;
- un caso de inversión completo que dirección pueda revisar;
- ROI y payback calculados con supuestos visibles y editables.

Los targets son hipótesis de aceptación del MVP. El baseline y los valores económicos deben
medirse durante el piloto; no se presentarán como hechos antes de esa medición.

## Riesgo principal

El riesgo más importante es que una recomendación elocuente pero débilmente respaldada sea
interpretada como diagnóstico profesional. Se mitiga mediante citas obligatorias, separación
entre evidencia y conocimiento general, verificador independiente, abstención, alternativas
sin IA y aprobación humana antes de cualquier resultado final.

Otros riesgos relevantes son la mala calidad del corpus, el sesgo hacia soluciones complejas,
la exposición de información sensible, el bajo uso y un alcance excesivo. El MVP los reduce con
un corpus pequeño y curado, ejecución local, permisos mínimos, un único caso de uso y criterios
de aceptación explícitos.

## Roadmap de tres semanas

### Semana 1 — Flujo estructurado

- definir el estado `DesignRun` y los esquemas de salida;
- encadenar Diagnóstico, Diseño, Negocio y Viabilidad;
- incorporar evidencia y alternativas sin IA.

### Semana 2 — Gobernanza y producto

- agregar verificador y checkpoints HITL;
- persistir versiones, decisiones y citas;
- construir el recorrido guiado en la interfaz.

### Semana 3 — Validación y entrega

- ejecutar el caso piloto sanitizado;
- medir baseline, tiempos, cobertura de citas y correcciones;
- ajustar el Canvas;
- preparar notas de diseño, presentación y demo.

## Pitch definitivo

> Las organizaciones no fracasan con IA sólo por elegir mal el modelo; muchas fracasan antes,
> cuando convierten una intención vaga en un proyecto sin problema, evidencia ni criterio de
> éxito claros. Algedi transforma documentos y contexto organizacional en una iniciativa de IA
> evaluada de punta a punta. Un equipo de agentes diagnostica, compara alternativas, completa el
> Canvas y analiza la viabilidad, mientras un verificador controla la evidencia y una persona
> aprueba cada decisión. El resultado no es otro chat ni un grafo bonito: es una recomendación
> trazable, versionada y lista para decidir si construir, reformular o no avanzar.

## Decisión final de alcance

Para el TP se construye y presenta **Algedi como sistema de diseño y decisión de iniciativas de
IA**, validado con un caso real pequeño de Caminos de las Sierras. La visualización 3D, la tesis
de deriva semántica y la visión de múltiples empresas permanecen como fundamentos y roadmap,
pero no compiten por protagonismo con el MVP.
