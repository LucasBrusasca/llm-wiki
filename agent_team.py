"""Equipo de agentes (LangGraph) — PASO 1: el "hola mundo" con un solo nodo.

═══════════════════════════════════════════════════════════════════════════
MODELO MENTAL DE LANGGRAPH (los 3 únicos conceptos que necesitás hoy)
═══════════════════════════════════════════════════════════════════════════

1) ESTADO  → un diccionario compartido que VIAJA por todo el flujo.
             Es el "cuaderno" donde cada agente lee lo anterior y escribe lo suyo.

2) NODO    → es SOLO UNA FUNCIÓN. Recibe el estado, hace algo (llamar al LLM),
             y devuelve un diccionario con lo que quiere agregar al estado.
             (No hay magia: un "agente" acá = una función + un prompt de rol.)

3) GRAFO   → el cableado: qué nodo corre, y qué viene después.
             START → nodo(s) → END.

Hoy armamos: START → [Diagnóstico] → END.
Mañana sumamos Oportunidades, Canvas, Viabilidad al mismo grafo.
"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

# Reusamos TU función de LLM (respeta LLM_PROVIDER: gemini/ollama/claude).
from processor import query_llm


# ── 1) EL ESTADO ────────────────────────────────────────────────────────
# El "cuaderno compartido". Por ahora tiene la entrada del usuario y el
# resultado del diagnóstico. A medida que sumemos agentes, sumamos campos acá.
class ConsultaState(TypedDict):
    entrada: str          # lo que trae el usuario: empresa / problema / tema
    diagnostico: str      # lo que escribe el agente Diagnóstico


# ── 2) UN NODO = un agente = una función ────────────────────────────────
# El "rol" del agente vive en el system prompt. Esto es lo que lo hace
# especialista: le decimos QUIÉN es y QUÉ tiene que devolver.
DIAGNOSTICO_SYS = """Sos un consultor senior experto en detectar problemas y debilidades
en organizaciones y procesos. Te dan información (una empresa, un proceso o un tema) y tu
trabajo es encontrar los DOLORES reales, no obviedades.

Devolvé exactamente una lista de 3 a 5 problemas concretos. Un problema por línea, empezando
con "- ". Sé específico y accionable. No propongas soluciones todavía: solo el diagnóstico."""


def nodo_diagnostico(state: ConsultaState) -> dict:
    """Lee la entrada del cuaderno, llama al LLM con el rol de Diagnóstico,
    y devuelve lo que hay que escribir en el cuaderno."""
    entrada = state["entrada"]
    respuesta = query_llm(
        [{"role": "user", "content": f"Información a analizar:\n\n{entrada}"}],
        system=DIAGNOSTICO_SYS,
    )
    # Lo que devolvés se FUSIONA en el estado (LangGraph actualiza el campo "diagnostico").
    return {"diagnostico": respuesta}


# ── 3) EL GRAFO ─────────────────────────────────────────────────────────
def construir_grafo():
    g = StateGraph(ConsultaState)      # el grafo trabaja sobre nuestro estado
    g.add_node("diagnostico", nodo_diagnostico)   # registramos el nodo
    g.add_edge(START, "diagnostico")   # el flujo entra al Diagnóstico
    g.add_edge("diagnostico", END)     # y termina ahí (por ahora)
    return g.compile()                 # compile() = "flujograma listo para correr"


# ── Prueba rápida (correr como script) ──────────────────────────────────
if __name__ == "__main__":
    app = construir_grafo()

    entrada = (
        "Una pyme de logística: los pedidos se cargan a mano en planillas Excel, "
        "se pierden envíos porque nadie controla el estado, los reclamos se responden "
        "por WhatsApp sin registro, y el dueño no tiene idea de cuánto factura por cliente."
    )

    # invoke() arranca el flujo con el estado inicial y devuelve el estado final.
    resultado = app.invoke({"entrada": entrada})

    print("\n═══ DIAGNÓSTICO ═══\n")
    print(resultado["diagnostico"])
