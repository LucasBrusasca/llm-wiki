#!/usr/bin/env python3
"""
Detectar nodos huérfanos (sin conexiones).
Útil para auditoría y mantenimiento del grafo.

Uso desde el API:
POST /api/scripts/run
{
    "script_id": "find-orphan-nodes",
    "inputs": {"seccion": "personal", "exclude_recent": true},
    "confirm": true
}
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any


def run(inputs: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Encuentra nodos sin conexiones en el grafo.
    
    Args:
        inputs: Parámetros (seccion, exclude_recent)
        context: Contexto con 'list_section_nodes' y 'get_edges'
    
    Returns:
        dict con 'orphan_nodes', 'total_nodes', 'orphan_count'
    """
    seccion = inputs.get("seccion", "personal")
    exclude_recent = inputs.get("exclude_recent", True)
    
    list_nodes = context.get("list_section_nodes")
    get_edges = context.get("get_edges")
    
    if not list_nodes or not get_edges:
        return {
            "orphan_nodes": [],
            "total_nodes": 0,
            "orphan_count": 0,
            "error": "Sin acceso a datos del grafo"
        }
    
    nodes = list_nodes(seccion)
    edges = get_edges(seccion)
    
    connected_ids = set()
    for edge in edges:
        connected_ids.add(edge.get("source"))
        connected_ids.add(edge.get("target"))
    
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    
    orphans = []
    for node in nodes:
        if node.get("id") in connected_ids:
            continue
        
        if exclude_recent:
            created = node.get("created_at")
            if created:
                try:
                    if isinstance(created, str):
                        node_time = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    else:
                        node_time = created
                    if node_time > cutoff:
                        continue
                except (ValueError, TypeError):
                    pass
        
        orphans.append({
            "id": node.get("id"),
            "label": node.get("label"),
            "fuente": node.get("fuente", "concepto"),
            "created_at": str(node.get("created_at", ""))
        })
    
    return {
        "orphan_nodes": orphans,
        "total_nodes": len(nodes),
        "orphan_count": len(orphans),
        "seccion": seccion
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        inputs = json.loads(sys.argv[1])
    else:
        inputs = {"seccion": "personal", "exclude_recent": True}
    
    mock_context = {
        "list_section_nodes": lambda s: [
            {"id": "1", "label": "Doc conectado", "created_at": "2024-01-01T00:00:00Z"},
            {"id": "2", "label": "Doc huérfano", "created_at": "2024-01-01T00:00:00Z"},
        ],
        "get_edges": lambda s: [{"source": "1", "target": "3"}]
    }
    
    result = run(inputs, mock_context)
    print(json.dumps(result, ensure_ascii=False, indent=2))
