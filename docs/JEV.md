# JEV en Algedi: de una necesidad a la herramienta justa

JEV decide, ante cada pedido al agente, **qué camino tomar** y, si es un análisis,
**qué herramienta usar y con qué parámetros**. No genera texto ni ejecuta nada: propone
con un recibo y la persona confirma. Cuando duda, pregunta con opciones para tocar.

La idea viene de los «modelos de decisión» (TypeSafe JEV, Laya, etc.): en vez de que un
LLM escriba una respuesta libre, un decisor elige entre opciones CERRADAS y da una
probabilidad por opción. Así la respuesta siempre es válida (una columna sólo puede
ser una columna de la tabla) y se puede medir.

## Cómo decide

```
pedido ──► 1. CAMINO      biblioteca · herramienta · grafo
             │  (forma del pedido + parecido con ejemplos + dato seleccionado)
             ├─ biblioteca ► el agente de siempre: busca pasajes y cita
             ├─ grafo      ► responde con el grafo: relaciones de un documento,
             │               documentos y temas de la sección
             └─ herramienta
                 2. CUÁL       entre los scripts con ficha (la «navaja»)
                 │  (ficha + pedido típico más parecido + palabras distintivas)
                 3. PARÁMETROS  cada uno entre valores válidos
                 │  tabla: la seleccionada / la única / la más parecida
                 │  columnas: las nombradas en el pedido, por su clase; si no, la
                 │            más parecida; si hay duda, se pregunta
                 4. PROPUESTA con recibo ─► la persona confirma ─► sandbox ─► Corridas
```

- Código: `jev.py` (caminos, herramienta, parámetros), `decisor.py` (decisión tipada),
  `main.py` → `_proponer_accion`, `_responder_grafo`, `/api/herramientas`.
- El decisor es local (similitud e5 + reglas, sin LLM, ~60 ms). El de TypeSafe u otro se
  enchufa con la misma firma (`Decision`: elección + probabilidad por opción) y se
  compara con las mismas preguntas.
- Lo que pidió la persona, la herramienta y la decisión quedan con cada corrida
  (`script_runs.inputs`): es la experiencia con la que JEV va a aprender.

## Medición

`python eval/evaluar_jev.py` con `eval/preguntas_jev_v1.json`: 43 pedidos sobre la tabla de
prueba `clientes_demo.csv`.

| | resultado |
|---|---|
| camino | 40/40 |
| herramienta | acierta 19 · pregunta 5 · se equivoca 0 · la correcta está en las 3 primeras en 24/24 |
| parámetros | 19/19 con todos los esperados bien |
| ninguna herramienta sirve | 3/3 sin forzar una |

**Optimista.** Los pedidos, los ejemplos de las fichas y los ajustes los hizo Claude
mirando estos mismos pedidos: es un conjunto de desarrollo. Hace falta sumar pedidos
escritos por Lucas (al mismo JSON) para tener la medida real.

Las decisiones que se tomaron midiendo están anotadas en el código (`PESO_PALABRAS`,
`SESGO_PREGUNTA_CONCEPTO`, ejemplos sin tema).

## Sumar un script a la navaja

Cualquier script de Python se vuelve herramienta si trae **ficha** en el docstring y un
literal `PARAMETROS`. Lo demás (descripción del nodo, relaciones con los documentos que
explican el método, elección por JEV) sale solo.

```python
"""Comparar grupos.

Sirve para: comparar una variable numérica entre grupos y saber si la diferencia es
significativa.
Necesita: una tabla con una columna de grupos y una numérica.
Entrega: media y mediana por grupo, y la prueba que corresponde.
Toca: nada, sólo lee.
Pedidos típicos:
- Compará el gasto entre regiones
- ¿Hay diferencia significativa de satisfacción entre planes?
"""
import json, os
import pandas as pd

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "grupo": {"tipo": "columna", "de": "datos", "clase": "categorica"},
    "valor": {"tipo": "columna", "de": "datos", "clase": "numerica"},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")
df = pd.read_csv(P["datos"], sep=None, engine="python")   # la tabla llega copiada, por nombre
```

- Tipos de parámetro: `tabla`, `columna`, `columnas`, `numero`, `texto`, `opcion`
  (con `opciones`). Clases de columna: `numerica`, `categorica`, `binaria`, `fecha`.
  `opcional`, `defecto` y `desc` son optativos.
- **Pedidos típicos** es lo que más ayuda a elegir bien: escribí 4 o 5 como los diría
  alguien, sin repetir el nombre de la herramienta.
- **Toca**: si el script escribe archivos o usa la red, Algedi lo detecta igual (lee el
  código) y lo avisa en la propuesta.
- Para que entre en la navaja: ponelo en `herramientas/data_science/` y corré
  «Instalar o actualizar la navaja» (Ctrl+K), o crealo desde el Workbench.

## Lo que sigue

1. Pedidos de Lucas para medir de verdad.
2. Experiencia: usar las corridas (pedido → herramienta → si sirvió) para elegir mejor.
3. JEV de TypeSafe como decisor alternativo, medido contra el local con las mismas
   preguntas (sólo viajan el pedido, las fichas y los nombres de columnas).
4. Valores de categoría en el pedido («¿los Premium gastan más que los Básicos?» →
   la columna `plan`).
5. Consultas SQL como herramientas, y resultados de las corridas como nodos.
