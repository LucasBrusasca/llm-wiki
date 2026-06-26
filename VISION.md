# PragmaForge — Visión y Concepto Central

> *Knowledge isn't lost in storage. It's lost in the drift between a symbol and its meaning.*
> **PragmaForge is the mechanism that snaps it back — and lets you act on it.**

PragmaForge no es un visor de embeddings bonito ni una app de notas con un chat pegado.
Es un **sistema de anclaje semántico navegable**: ingiere tus documentos reales, modela su
significado como una geometría explorable, lo **mantiene anclado** para que no se desvíe, y
deja que un **agente reflexivo** razone y actúe sobre ese conocimiento anclado.

Este documento explica *por qué* existe, *qué problema profundo* resuelve, *en qué se
diferencia* de lo que ya existe, y *hacia dónde va*.

---

## 1. El problema real: el significado se satura y se desancla

Decí la palabra **"naranja"** treinta veces seguidas en voz alta. Cerca de la repetición
veinte, deja de significar algo y se vuelve un ruido hueco. Los lingüistas lo llaman
**saturación semántica**: el vínculo entre el símbolo y su significado se afloja.

En las personas, eso **se autocorrige** — el vínculo vuelve solo apenas dejás de repetir.
El problema es que **las organizaciones (y los agentes de IA) también se saturan, pero no
se autocorrigen.**

Preguntá a cinco equipos qué es un *"usuario activo"* y te van a dar siete definiciones —
porque algunos equipos manejan dos definiciones en competencia sin saberlo. La brecha entre
la palabra y lo que ancla su significado **se ensancha en silencio** hasta que dos tableros
no coinciden y una reunión entera se quema discutiendo qué número es el real.

Con los agentes es peor: la **deriva semántica se acumula**, porque cada paso del agente se
construye sobre la interpretación **no verificada** del paso anterior. Un grado de desvío al
principio se vuelve un error grande tres pasos después.

> El principio, prestado del trabajo de Modern Data 101 (Animesh Kumar & Travis Thompson)
> sobre *grounding mechanisms*: **"Fix the relationship, not the word."** El significado nunca
> estuvo en la palabra; está en la **relación** entre la palabra y lo que la ancla.

**PragmaForge es, en esencia, un mecanismo anti-saturación a escala personal y de equipo.**

---

## 2. La tesis que lo sostiene

Este proyecto es el prototipo funcional de la arquitectura de mi tesis de Maestría:

> **"Multi-RAG Multimodal con orquestación reflexiva para gestión del conocimiento."**
> *Maestría en Ciencia de Datos — Universidad Austral.*

La tesis explora sistemas RAG multi-silo con mecanismos de **veto epistémico**: en vez de un
RAG que recupera y responde a ciegas, un sistema que **re-ancla el significado y se autocrítica
antes de actuar.** Las "capas semánticas, grafos de conocimiento, ontologías y memoria
estructurada" no son cuatro cosas distintas: son **distintas formas del mismo mecanismo** que
vuelve a anclar el lenguaje a un significado verificado antes de que el agente lo use.

El *"Multi"* del título no es decorativo: en vez de un único agente sabelotodo, la visión es un
**tejido de agentes especializados por dominio** (Finanzas, Operaciones, Auditoría…) que
comparten **la misma base de conocimiento anclada** y se orquestan entre sí. Especialización
jerárquica e interconectada, no un chatbot monolítico.

PragmaForge hace eso **tangible y navegable**.

---

## 3. Qué es, en una frase y en capas

**En una frase:** un grafo de conocimiento 3D que ingiere tus documentos, modela su significado
como geometría, lo mantiene anclado, y deja que un agente reflexivo razone y actúe sobre él.

Unifica tres cosas que normalmente viven separadas:

| Capa | Qué hace | Pregunta que responde |
|---|---|---|
| **Geometría del conocimiento** | Proyecta los embeddings a un espacio navegable (UMAP/PCA/densidad/centroides) | *¿Qué forma tiene lo que sé?* |
| **Anclaje semántico** | Extrae conceptos, los fija como nodos/aristas verificables, evita la deriva | *¿Qué significa, y sigue significando lo mismo?* |
| **Orquestación reflexiva** | Un agente que recupera, se autocrítica contra la evidencia, y recién ahí actúa | *¿Qué hago con esto, sin equivocarme en cadena?* |

---

## 4. En qué se diferencia (el posicionamiento)

La mayoría de lo que circula cae en uno de dos baldes. PragmaForge ocupa el cruce que falta.

| | Lo que ofrece | Su límite |
|---|---|---|
| **Demos virales de embeddings 3D** (mapas de bookmarks, gestos) | Hermoso, espacial, viral | **Pasivos**: solo mirás una nube girar. La gente pide *"how do I use this with my files"* — es un demo, no una herramienta. |
| **Claude + Obsidian / apps de notas** | Útil, con chat | **Sin geometría ni anclaje**: texto plano; el significado se re-deriva en privado y se desvía. |
| **RAG tradicional** | Recupera y responde | **Sin reflexión**: responde a ciegas; la deriva se acumula paso a paso. |
| **PragmaForge** | **Lindo + útil + anclado + reflexivo** | Su trabajo es justo cerrar la brecha que los otros dejan abierta. |

**El diferencial no es hacer el grafo más lindo** (esa es la cancha de los demos virales).
Es hacer que el mapa **te diga algo que no sabías** y que el agente **no se desvíe**. De
*mirar* el conocimiento a *interrogarlo y actuar* sobre él.

---

## 5. Cómo funciona — el pipeline y el lazo reflexivo

### 5.1 De documento a significado anclado

```
Fuente (PDF · Word · PPT · Excel · HTML/web · YouTube · texto)
   │
   ▼  extracción de texto (PyMuPDF / zip-xml / scraping / oEmbed)
LLM (Gemini · Ollama · Anthropic, intercambiable)
   │  → nodo estructurado { título, descripción, fragmento clave, conceptos }
   ▼
sentence-transformers (all-MiniLM-L6-v2) → vector de 384 dimensiones
   │
   ▼
UMAP → coordenadas 3D     ·     HDBSCAN → clusters     ·     coseno → aristas
   │
   ▼
Grafo de conocimiento anclado (Postgres + pgvector)
   │
   ▼
Visualización 3D navegable (React + react-force-graph-3d / Three.js)
```

### 5.2 Las cuatro lentes (cada vista re-ancla de una forma distinta)

No son adornos: son **cuatro maneras de inspeccionar el mismo significado**.

- **Densidad** — *dónde se concentra tu atención*: los focos del corpus, los atractores del
  espacio latente.
- **UMAP** — *la forma real del conocimiento*: la distancia preserva la vecindad semántica.
- **Centroides** — *lo típico vs. lo atípico*: el núcleo en el centro, los outliers (ideas
  disruptivas o de nicho) en la periferia.
- **PCA** — *los ejes dominantes de variación*: las fuerzas que de verdad dividen o agrupan tu
  información.

### 5.3 El lazo que evita la deriva (visión)

El agente no responde de un solo tiro. Sigue el patrón **Interpretar → Actuar → Refinar →
Optimizar**, re-anclándose a la evidencia recuperada **antes** de que la brecha entre símbolo y
significado se ensanche. Eso es la *orquestación reflexiva* del título de la tesis, hecha
producto.

---

## 6. La visión: de mirar a actuar

El estado actual ya ancla y navega el conocimiento. La hoja de ruta lo convierte en algo que
**piensa con vos** — y es lo que lo separa de todo lo demás.

1. **Descubrimientos automáticos** *(el diferenciador #1)*
   El mapa te avisa solo: *"estos dos documentos se contradicen sobre X"*, *"hay un puente
   inesperado entre el cluster de RAG y el de neurociencia vía el concepto Y"*, *"tenés un
   hueco: mucho sobre A, nada sobre B"*. Ningún demo viral hace esto; Obsidian tampoco. Es el
   **veto epistémico** de la tesis hecho función.

2. **Agente reflexivo** *(núcleo de la tesis)*
   Borra una respuesta → la critica contra los nodos recuperados → la refina y recién ahí la
   muestra. La deriva deja de acumularse.

3. **De un agente a un tejido de agentes expertos** *(multi-RAG — el salto corporativo)*
   En vez de un único agente "sabelotodo", una **red de agentes especializados por dominio**
   (Finanzas, Operaciones, Ventas, Auditoría…) sobre la **misma base de conocimiento anclada**.
   Dos piezas concretas que tu stack —embeddings + grafo— ya habilita:
   - **Ruteo semántico de tareas:** cada consulta se compara por distancia vectorial contra los
     dominios y se deriva al **agente experto correcto**, con sus herramientas y su persona —
     bajando el costo en tokens y subiendo la precisión.
   - **Habilidad por nodo:** cada nodo lleva metadatos de *qué dominio/agente puede ejecutarlo*
     (ej. "Clasificación de deuda" → agente de soporte). El grafo deja de ser solo documentos:
     se vuelve un **mapa de habilidades**.

   Cada agente puede portar una **persona/lente** (*escéptico*, *sintetizador*, *analista de
   riesgo*): no solo entiende el significado, **decide bajo un marco** (alineamiento normativo).
   Esto convierte a PragmaForge de *wiki de documentos* en **consola de control desde donde
   orquestás múltiples agentes expertos** para tu entorno o empresa.

4. **Arquitectura de decisión y federación** *(la capa que sigue al significado)*
   Anclado el *qué-significa*, falta el **qué-acción, quién la dueña, bajo qué restricciones**
   (la "decision architecture": interpretación es la base, pero la organización todavía necesita
   decidir acción, dueño y reglas). PragmaForge está diseñado para federar —vía **MCP**— con
   sistemas de conocimiento corporativos, separando la capa personal de la organizacional.

5. **Topología real (Mapper / TDA) y navegación gestual** *(el diferencial sobre los demos virales)*
   Los demos virales de embeddings 3D **visualizan** la forma del corpus, pero son pasivos: una
   nube linda que mirás. El salto es **computar el esqueleto topológico** con Mapper (cubrir la
   proyección, clusterizar dentro de cada bin, conectar bins que comparten documentos) → no solo
   una imagen bonita, sino una **estructura sobre la que se puede preguntar y actuar**. Es la
   versión fiel —y un nivel por encima— de la técnica que hizo virales esos videos. Sumado a
   control espacial por gestos, da el tipo de interfaz que la gente describe como *"el futuro de
   la UI"*.

---

## 7. Stack y estado actual

**Frontend:** React 18 + Vite · `react-force-graph-3d` (Three.js / WebGL) · render-on-demand
para GPU integrada.
**Backend:** FastAPI · PostgreSQL + pgvector · `sentence-transformers` (384-d) · UMAP +
HDBSCAN · proveedor LLM intercambiable (Gemini / Ollama / Anthropic) con reintentos y backoff.
**Infra:** Docker Compose · arranque de un clic (`start.bat` / `start.sh`) · demo estático
de solo-lectura en GitHub Pages.

**Funciona hoy:** ingesta multimodal (PDF, Word, PowerPoint, Excel, web, YouTube, texto),
4 lentes de visualización, panel de nodo con previsualización real del documento y miniaturas,
agente RAG (global y por nodo), módulo de issues, síntesis multi-nodo, inspección de relaciones
(por qué se conectan dos nodos), biblioteca y etiquetas.

---

## 8. El manifiesto, en una línea

> El significado nunca estuvo en la palabra. Está en la **relación** entre la palabra y lo que
> la ancla. **PragmaForge arregla la relación —y te deja actuar sobre ella.**

---

### Referencias e influencias
- *Grounding Mechanisms for Agents / Semantic Satiation* — Modern Data 101 (Animesh Kumar &
  Travis Thompson): la metáfora de la saturación y el caso arquitectónico de la capa semántica.
- *Topological Data Analysis (Mapper) + navegación espacial de embeddings* — demos de la
  comunidad (@poetengineer__ y otros): las tres lentes density / pca / centroid.
- *Agentic AI con sandboxing dinámico y persona como filtro de criterio* — el caso de
  orquestación reflexiva y alineamiento normativo.
- *"Enterprise Second Brain" — especialización jerárquica e interconectada de agentes* (mapas de
  decenas de habilidades distribuidas en directores de IA por dominio): la inspiración del
  tejido de agentes expertos con ruteo semántico y habilidad por nodo.

*Autor: Lucas Brusasca — Maestría en Ciencia de Datos, Universidad Austral.*
