#!/usr/bin/env python3
"""
Resumir nodos seleccionados.
Extrae títulos, descripciones y conceptos clave de los nodos indicados.

Uso desde el API:
POST /api/scripts/run
{
    "script_id": "summarize-nodes",
    "inputs": {"node_ids": ["id1", "id2"], "max_length": 500},
    "confirm": true
}
"""
import json
import sys
from typing import Any


def run(inputs: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Ejecuta el script de resumen.
    
    Args:
        inputs: Parámetros del script (node_ids, max_length)
        context: Contexto con acceso a la DB vía 'get_nodes(ids)'
    
    Returns:
        dict con 'summary' y 'node_count'
    """
    node_ids = inputs.get("node_ids", [])
    max_length = inputs.get("max_length", 500)
    
    if not node_ids:
        return {"summary": "No se especificaron nodos.", "node_count": 0}
    
    get_nodes = context.get("get_nodes")
    if not get_nodes:
        return {"summary": "Error: contexto sin acceso a nodos.", "node_count": 0}
    
    nodes = get_nodes(node_ids)
    if not nodes:
        return {"summary": "No se encontraron nodos con los IDs especificados.", "node_count": 0}
    
    lines = []
    for node in nodes:
        label = node.get("label", "Sin título")
        desc = node.get("desc", "")[:150] or node.get("fragmento", "")[:150] or "Sin descripción"
        conceptos = node.get("conceptos", [])[:5]
        
        line = f"• {label}"
        if desc:
            line += f": {desc}"
        if conceptos:
            line += f" [{', '.join(conceptos)}]"
        lines.append(line)
    
    full_summary = "\n".join(lines)
    if len(full_summary) > max_length:
        full_summary = full_summary[:max_length-3] + "..."
    
    return {
        "summary": full_summary,
        "node_count": len(nodes)
    }


if __name__ == "__main__":
    # Modo CLI para testing
    if len(sys.argv) > 1:
        inputs = json.loads(sys.argv[1])
    else:
        inputs = {"node_ids": [], "max_length": 500}
    
    # Contexto mock para CLI
    mock_context = {
        "get_nodes": lambda ids: [{"label": f"Nodo {i}", "desc": "Descripción demo"} for i in ids]
    }
    
    result = run(inputs, mock_context)
    print(json.dumps(result, ensure_ascii=False, indent=2))
