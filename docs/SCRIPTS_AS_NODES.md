# Scripts como Nodos en Algedi

Este documento describe cómo funcionan los scripts como nodos de primera clase en el grafo de conocimiento de Algedi.

## Concepto

Los scripts en Algedi son **nodos tipados** que representan consultas o transformaciones automatizadas sobre el grafo. A diferencia de los documentos tradicionales (PDFs, videos, etc.), los scripts:

- Son ejecutables: el usuario puede correrlos y ver resultados
- Son versionados: cada script tiene una versión semántica
- Son vinculables: pueden conectarse a documentos relevantes
- Son proponibles: el agente puede sugerir qué script ejecutar según el contexto

## Estructura del Registry

El registry de scripts vive en `scripts_registry/registry.json`:

```json
{
  "version": "1.0.0",
  "scripts": [
    {
      "id": "summarize-nodes",
      "name": "Resumir nodos seleccionados",
      "version": "1.0.0",
      "description": "Genera un resumen de los nodos indicados...",
      "path": "examples/summarize_nodes.py",
      "inputs": {
        "type": "object",
        "properties": {
          "node_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Lista de IDs de nodos a resumir"
          }
        },
        "required": ["node_ids"]
      },
      "outputs": {
        "type": "object",
        "properties": {
          "summary": {"type": "string"}
        }
      },
      "tags": ["análisis", "resumen"],
      "safe": true,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### Campos obligatorios

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único del script (slug) |
| `name` | string | Nombre legible para la UI |
| `version` | string | Versión semántica (ej: "1.0.0") |
| `description` | string | Descripción del propósito del script |
| `path` | string | Ruta al archivo Python, relativa a `scripts_registry/` |
| `inputs` | object | JSON Schema de los parámetros de entrada |
| `tags` | array | Etiquetas para búsqueda y propuestas |
| `safe` | boolean | Si es true, el script solo lee datos |

## Cómo agregar un script nuevo

### 1. Crear el archivo Python

Crea un archivo en `scripts_registry/examples/mi_script.py`:

```python
#!/usr/bin/env python3
"""Descripción del script."""
import json
from typing import Any

def run(inputs: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Función principal del script.
    
    Args:
        inputs: Parámetros definidos en el schema de inputs
        context: Funciones de acceso a datos:
            - get_nodes(ids): Obtiene nodos por IDs
            - list_section_nodes(seccion): Lista nodos de una sección
            - get_edges(seccion): Obtiene aristas de una sección
    
    Returns:
        dict con los resultados (debe coincidir con outputs schema)
    """
    # Tu lógica aquí
    return {"resultado": "valor"}

if __name__ == "__main__":
    # Modo CLI para testing local
    result = run({"param": "valor"}, {})
    print(json.dumps(result, indent=2))
```

### 2. Registrar en registry.json

Agrega una entrada al array `scripts`:

```json
{
  "id": "mi-script",
  "name": "Mi Script Personalizado",
  "version": "1.0.0",
  "description": "Hace algo útil con los datos del grafo.",
  "path": "examples/mi_script.py",
  "inputs": {
    "type": "object",
    "properties": {
      "param": {"type": "string"}
    },
    "required": ["param"]
  },
  "outputs": {
    "type": "object",
    "properties": {
      "resultado": {"type": "string"}
    }
  },
  "tags": ["mi-tag", "otra-tag"],
  "safe": true,
  "created_at": "2024-01-20T00:00:00Z"
}
```

### 3. Reiniciar el backend

El registry se carga desde el archivo cada vez que se llama a `/api/scripts`.

## API Endpoints

### Listar scripts disponibles

```
GET /api/scripts
```

Respuesta:
```json
{
  "version": "1.0.0",
  "scripts": [...],
  "count": 4
}
```

### Crear un nodo script en el grafo

```
POST /api/scripts/nodes
Content-Type: application/json

{
  "script_id": "summarize-nodes",
  "seccion": "personal",
  "link_to_nodes": ["doc-123", "doc-456"]
}
```

Esto crea un nodo de tipo `SCRIPT` en la sección indicada y opcionalmente lo enlaza con los documentos especificados.

### Proponer scripts según contexto

```
POST /api/scripts/propose
Content-Type: application/json

{
  "query": "quiero resumir estos documentos",
  "node_ids": ["doc-123"],
  "limit": 3
}
```

El agente analiza la consulta y los nodos seleccionados para sugerir scripts relevantes.

### Ejecutar un script

```
POST /api/scripts/run
Content-Type: application/json

{
  "script_id": "summarize-nodes",
  "inputs": {"node_ids": ["doc-123", "doc-456"]},
  "confirm": true,
  "context_node_ids": ["doc-123", "doc-456"]
}
```

**Importante**: `confirm: true` es obligatorio para ejecutar. Sin él, el endpoint devuelve un aviso de confirmación.

### Ver historial de ejecuciones

```
GET /api/scripts/runs?limit=20
GET /api/scripts/runs?script_id=summarize-nodes&limit=10
```

### Vincular script a documento

```
POST /api/scripts/link
Content-Type: application/json

{
  "script_node_id": "script-summarize-nodes-abc123",
  "target_node_id": "doc-456"
}
```

## UI

### Panel de Scripts

Accesible desde el botón **⚙ Scripts** en el header. Permite:

1. **Ver registry**: Lista todos los scripts disponibles con sus tags y descripción
2. **Proponer scripts**: Escribe una consulta y el sistema sugiere scripts relevantes
3. **Ejecutar**: Botón de confirmación antes de correr cada script
4. **Ver ejecuciones**: Historial de las últimas corridas con resultados

### Nodos Script en el grafo

Los nodos de tipo script aparecen con:
- **Color turquesa distintivo** (#00CED1)
- **Glyph ⚙** en la tarjeta
- **Badge "SCRIPT"** en la biblioteca

## Flujo completo de uso

1. El usuario abre el panel de Scripts
2. Escribe una consulta: "quiero resumir mis documentos de onboarding"
3. El sistema propone scripts relevantes (ej: "Resumir nodos seleccionados")
4. El usuario selecciona un script y confirma la ejecución
5. El resultado aparece en el panel
6. Opcionalmente, añade el script al grafo como nodo vinculado a los documentos

## Seguridad

- Los scripts solo pueden leer datos del grafo a través del `context`
- No tienen acceso al filesystem ni a la red
- La ejecución requiere confirmación explícita (`confirm: true`)
- Todas las ejecuciones quedan registradas en el log

## Scripts incluidos

| ID | Nombre | Descripción |
|----|--------|-------------|
| `summarize-nodes` | Resumir nodos seleccionados | Genera un resumen de títulos y conceptos |
| `list-section-docs` | Listar documentos de sección | Inventario de documentos con metadatos |
| `validate-json` | Validar estructura JSON | Verifica JSON y campos requeridos |
| `find-orphan-nodes` | Detectar nodos huérfanos | Encuentra nodos sin conexiones |
