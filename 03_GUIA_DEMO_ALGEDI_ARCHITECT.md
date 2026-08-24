# Guía de demo — Algedi Architect

## Qué se demuestra

La interfaz no contiene un árbol `if/else`. Envía el caso a Algedi y sólo representa el expediente devuelto por el backend.

```text
Caso + corpus
  → recuperación semántica y marcadores de cita
  → planner: seis rutas + alternativas + matriz
  → verifier: objeción, gaps y cambios requeridos
  → decisión humana
  → expediente JSON
```

El prototipo puede razonar con conocimiento general si la biblioteca no contiene evidencia suficiente, pero debe declararlo. No debe presentar ese conocimiento como fuente del corpus.

## Preparación

1. Iniciar Algedi con `start.bat` o `docker compose up -d`.
2. Confirmar que el backend responde en `http://localhost:8000`.
3. Cargar previamente un corpus controlado si se quieren mostrar citas reales.
4. Abrir `http://localhost:8000/architect-demo`.

No abrir la demo principal desde un servicio estático ajeno. Servirla desde FastAPI evita problemas de CORS y garantiza que la UI y el endpoint correspondan a la misma versión.

## Secuencia sugerida — 90 segundos

**Apertura.** “Esto no es Architect dibujado con reglas. El flujograma visualiza una clasificación generada por recuperación, comparación y verificación en el backend.”

1. Elegir **Reporte mensual de planillas**. El ejemplo sólo completa el brief.
2. Mostrar que problema, objetivo, proceso, datos, restricciones y valor esperado son editables.
3. Presionar **Analizar con Architect**.
4. Señalar la ruta activa. Una respuesta razonable puede ser Datos/BI, reglas o rediseño según el corpus y los supuestos; la demo no fuerza una clase.
5. Abrir **Matriz comparativa** y mostrar que la recomendación se contrastó contra otras rutas.
6. Leer la **objeción del verificador**. El segundo agente no adorna la propuesta: intenta detectar exceso tecnológico, contradicciones y evidencia insuficiente.
7. Abrir **Fuentes recuperadas**. Distinguir “biblioteca Algedi” de “conocimiento general declarado”.
8. Aprobar, pedir cambio o descartar. Descargar el expediente JSON.

## Qué decir si cambia la salida

“La salida no está cableada. Lo evaluable no es que siempre diga Datos/BI, sino que compare alternativas, cite evidencia válida, exponga faltantes y deje la decisión final a una persona. La estabilidad se mide aparte con cinco repeticiones por caso.”

## Qué no afirmar

- No decir que 10/12, 82,7% o 1,6 meses son resultados obtenidos.
- No decir que planner y verifier son independientes; pueden compartir sesgos.
- No decir que el prototipo está validado hasta ejecutar el banco bloqueado de doce casos.
- No decir que el HTML es el agente. Es un cliente visual.
- No prometer ejecución autónoma: Architect recomienda; el control operacional sigue siendo humano.

## Contingencia

Si el backend o el proveedor LLM no responden, la interfaz muestra el error y no genera una clasificación simulada. En ese caso, continuar con las slides 3–5 de la presentación y explicar el contrato; no presentar una captura prefabricada como ejecución en vivo.

