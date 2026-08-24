# Algedi — Consultora de IA multi-agente

> Un equipo de agentes de IA que analiza una empresa, detecta dónde la IA genera valor
> y produce diagnósticos, oportunidades y *canvases* accionables — preservando todo el
> razonamiento en un grafo de conocimiento vivo.

---

## 1. El problema

Las organizaciones intuyen que la IA puede ayudarlas, pero **no saben dónde**. Contratar una
consultora es caro y lento, el conocimiento del diagnóstico se pierde en un PDF, y la mayoría
de los proyectos de IA arrancan sin un problema bien definido (la causa nº1 de fracaso).

**El dolor concreto:** pasar de *"queremos usar IA"* a *"acá está el problema exacto, la solución
adecuada y si conviene construirla"* — hoy eso depende de un experto escaso y no queda registrado.

## 2. La solución

**Algedi** deja de ser un grafo de conocimiento y se convierte en una **consultora hecha de agentes**.
Le cargás información de una empresa (procesos, dolores, documentos) y un **equipo de agentes
especializados** la analiza como lo haría una consultora real, aplicando el método del curso
(AI Canvas Unificado), y **guarda todo conectado** en el grafo.

No es un chatbot que responde y se olvida: es un sistema que **diagnostica, propone y preserva**.

## 3. El equipo de agentes (arquitectura)

Patrón **supervisor / subagentes** (Módulo 2 del curso). Un orquestador coordina a cuatro especialistas:

| Agente | Rol | Salida |
|---|---|---|
| 🔍 **Diagnóstico** | Lee la info de la empresa y detecta problemas y debilidades | Lista de dolores priorizados |
| 💡 **Oportunidades** | Por cada dolor, evalúa si va automatización, workflow o agente | Oportunidades de IA rankeadas |
| 📋 **Canvas** | Arma el AI Canvas de la mejor oportunidad (12 bloques) | Canvas accionable |
| 💰 **Viabilidad** | Estima ROI y riesgos | Recomendación construir / no construir |

El **humano (HITL)** revisa y ajusta en cada paso: el sistema propone, la persona decide.

## 4. Cómo funciona (flujo)

1. **Entrada:** se carga la información de la empresa al grafo (ingesta ya existente en Algedi).
2. **Diagnóstico:** el agente detecta las problemáticas y debilidades.
3. **Oportunidades:** se traduce cada dolor en una oportunidad de IA, clasificada por tipo de solución.
4. **Canvas + Viabilidad:** se desarrolla la oportunidad top en un canvas completo con ROI y riesgos.
5. **Preservación:** todo queda en el grafo, conectado: `dolor → oportunidad → canvas → decisión`.
6. **Salida:** un informe navegable — *"3 problemas detectados, 2 oportunidades priorizadas, 1 canvas listo"*.

## 5. Qué lo hace distinto (el rol de Algedi)

Un LLM suelto te da un canvas y lo olvida. Acá el valor está en la **memoria conectada**:
cada diagnóstico, oportunidad y decisión queda enlazado en un grafo que **crece**. Al cargar más
empresas, empiezan a emerger **patrones entre ellas**. Ese es el ADN de Algedi (conexiones
emergentes + preservación) puesto al servicio de un problema real.

## 6. Encaje con el curso

El proyecto **es** la metodología del curso ejecutada por agentes:

- **Módulo 1 — Radar de Problemas** → el Agente Diagnóstico + Oportunidades.
- **Módulo 2 — Diseño y orquestación multi-agente** → el equipo supervisor/subagentes.
- **Módulo 3 — Viabilidad y ROI** → el Agente Viabilidad.
- **AI Canvas Unificado** → el artefacto de salida.

Cumple la entrega (el canvas) **y** la supera con un producto funcionando.

## 7. Alcance del MVP — 15 días

**Se apoya en lo que Algedi ya tiene** (~70% del plumbing): ingesta multimodal, llamadas al LLM,
grafo/memoria y el módulo *Issue* (que ya razona un problema por etapas). Lo único nuevo real es
pasar de **un** cerebro a **un equipo**.

**Entra en el MVP:**
- Orquestador que corre los 4 agentes en secuencia sobre la info de una empresa.
- Cada agente = un rol especializado (prompt + método del canvas).
- Resultados guardados y conectados en el grafo (dolor → oportunidad → canvas).
- Panel simple para disparar el análisis y ver el informe (reutiliza el patrón del módulo *Issue*).
- Revisión humana (editar / aprobar) en cada etapa.

**Queda fuera (roadmap):**
- Agentes autónomos con herramientas propias y *handoffs* en vivo.
- Visualización del equipo como organigrama animado en el grafo 3D.
- Detección de patrones entre múltiples empresas.
- Memoria episódica por agente.

## 8. Por qué es buen proyecto de portfolio

- **Se demuestra solo:** *"aprendí a construir agentes → construí un equipo de agentes que ayuda a
  construir proyectos de IA"*. Meta y memorable.
- **Usa todo el temario a la vez:** orquestación multi-agente, RAG, memoria, tools, HITL, ROI.
- **Funciona, no es una maqueta:** produce canvases reales sobre información real.

---

### Una frase para presentarlo

> *"Algedi es una consultora de IA hecha de agentes: le das la información de una empresa y un equipo
> de agentes detecta sus problemas, propone dónde la IA genera valor y arma el proyecto listo para
> ejecutar — preservando todo el conocimiento en un grafo que aprende con cada caso."*
