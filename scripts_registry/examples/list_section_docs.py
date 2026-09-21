#!/usr/bin/env python3
"""
Listar documentos de una sección del grafo.
Devuelve metadatos básicos de cada documento (tipo, autor, fecha).

Uso desde el API:
POST /api/scripts/run
{
    "script_id": "list-section-docs",
    "inputs": {"seccion": "personal", "include_concepts": false},
    "confirm": true
}
"""
import json
import sys
from typing import Any


def run(inputs: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Lista documentos de una sección.
    
    Args:
        inputs: Parámetros (seccion, include_concepts)
        context: Contexto con 'list_section_nodes(seccion)'
    
    Returns:
        dict con 'documents' y 'total'
    """
    seccion = inputs.get("seccion", "personal")
    include_concepts = inputs.get("include_concepts", False)
    
    list_nodes = context.get("list_section_nodes")
    if not list_nodes:
        return {"documents": [], "total": 0, "error": "Sin acceso a sección"}
    
    nodes = list_nodes(seccion)
    
    documents = []
    for node in nodes:
        doc = {
            "id": node.get("id"),
            "label": node.get("label"),
            "fuente": node.get("fuente", "concepto"),
            "autor": node.get("autor", ""),
            "created_at": node.get("created_at", ""),
        }
        if include_concepts:
            doc["conceptos"] = node.get("conceptos", [])[:10]
        documents.append(doc)
    
    return {
        "documents": documents,
        "total": len(documents),
        "seccion": seccion
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        inputs = json.loads(sys.argv[1])
    else:
        inputs = {"seccion": "personal"}
    
    mock_context = {
        "list_section_nodes": lambda s: [
            {"id": "1", "label": "Doc 1", "fuente": "pdf", "autor": "Test"},
            {"id": "2", "label": "Doc 2", "fuente": "youtube", "autor": "Demo"},
        ]
    }
    
    result = run(inputs, mock_context)
    print(json.dumps(result, ensure_ascii=False, indent=2))
