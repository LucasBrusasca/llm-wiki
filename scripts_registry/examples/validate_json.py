#!/usr/bin/env python3
"""
Validar estructura JSON.
Verifica que un texto sea JSON válido y opcionalmente que contenga campos requeridos.

Uso desde el API:
POST /api/scripts/run
{
    "script_id": "validate-json",
    "inputs": {"json_text": "{\"name\": \"test\"}", "required_fields": ["name", "id"]},
    "confirm": true
}
"""
import json
import sys
from typing import Any


def run(inputs: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Valida JSON y verifica campos requeridos.
    
    Args:
        inputs: Parámetros (json_text, required_fields)
        context: No usado en este script
    
    Returns:
        dict con 'valid', 'error', 'missing_fields'
    """
    json_text = inputs.get("json_text", "")
    required_fields = inputs.get("required_fields", [])
    
    if not json_text:
        return {
            "valid": False,
            "error": "No se proporcionó texto JSON",
            "missing_fields": []
        }
    
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError as e:
        return {
            "valid": False,
            "error": f"JSON inválido: {str(e)}",
            "missing_fields": []
        }
    
    missing = []
    if isinstance(parsed, dict) and required_fields:
        for field in required_fields:
            if field not in parsed:
                missing.append(field)
    
    if missing:
        return {
            "valid": False,
            "error": f"Faltan campos requeridos: {', '.join(missing)}",
            "missing_fields": missing
        }
    
    return {
        "valid": True,
        "error": None,
        "missing_fields": [],
        "parsed_type": type(parsed).__name__,
        "key_count": len(parsed) if isinstance(parsed, dict) else None
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        inputs = json.loads(sys.argv[1])
    else:
        inputs = {
            "json_text": '{"name": "test", "value": 42}',
            "required_fields": ["name"]
        }
    
    result = run(inputs, {})
    print(json.dumps(result, ensure_ascii=False, indent=2))
