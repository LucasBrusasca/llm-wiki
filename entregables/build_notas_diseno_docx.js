const fs = require('fs');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
} = require('docx');

const COLORS = { ink: '172033', cyan: '087F9C', muted: '5F6B7E', pale: 'E8F7FB', border: 'CBD5E1' };

function p(text, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 150, line: 282 },
    alignment: options.align || AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, size: options.size || 21, font: 'Calibri', color: options.color || COLORS.ink, bold: options.bold || false, italics: options.italics || false })],
  });
}

function h(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 170, after: 90 },
    children: [new TextRun({ text, size: 26, font: 'Cambria', bold: true, color: COLORS.ink })],
  });
}

const info = new Table({
  width: { size: 10300, type: WidthType.DXA },
  columnWidths: [2350, 7950],
  rows: [
    ['Curso', 'AI Agents — De la Idea a la Implementación 2026'],
    ['Autor', 'Lucas Brusasca'],
    ['Iniciativa', 'Architect, módulo de decisión sobre la plataforma Algedi'],
  ].map(([a, b]) => new TableRow({ children: [
    new TableCell({ width: { size: 2350, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: COLORS.pale }, borders: { top:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, bottom:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, left:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, right:{style:BorderStyle.SINGLE,color:COLORS.border,size:4} }, children: [p(a, { bold: true, size: 19, after: 0, align: AlignmentType.LEFT })] }),
    new TableCell({ width: { size: 7950, type: WidthType.DXA }, borders: { top:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, bottom:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, left:{style:BorderStyle.SINGLE,color:COLORS.border,size:4}, right:{style:BorderStyle.SINGLE,color:COLORS.border,size:4} }, children: [p(b, { size: 19, after: 0, align: AlignmentType.LEFT })] }),
  ] }))
});

const page1 = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 170 }, children: [new TextRun({ text: 'Algedi Architect', font: 'Cambria', size: 38, bold: true, color: COLORS.ink }), new TextRun({ text: ' — Contexto y notas de diseño', font: 'Cambria', size: 28, color: COLORS.cyan })] }),
  info,
  h('Contexto y elección del problema'),
  p('El problema elegido ocurre antes de construir una solución de inteligencia artificial. En muchas organizaciones aparece un pedido formulado como “necesitamos un agente”, aunque todavía no se determinó si el problema real está en el proceso, en reglas que podrían automatizarse de forma determinística, en la calidad o integración de los datos, en una tarea probabilística que requiere asistencia o, efectivamente, en una actividad que justifica un agente. Cuando esa clasificación no se realiza, la herramienta se elige antes de comprender la necesidad.'),
  p('El usuario del piloto es un responsable de innovación o datos de una PyME que recibe aproximadamente seis iniciativas tecnológicas por trimestre y no cuenta con un arquitecto de soluciones dedicado. Para disponer de un escenario calculable —todavía no validado en campo— se supone que preparar cada iniciativa consume ocho horas y que el costo profesional es de USD 25 por hora. Esto representa USD 1.200 trimestrales de preparación. Se incorpora por separado un desarrollo incorrecto de referencia de USD 2.000 por trimestre. Estas cifras son hipótesis explícitas del piloto, no benchmarks externos ni resultados observados.'),
  p('Elegí este problema porque construir prototipos se volvió más rápido y accesible, pero esa facilidad aumenta el riesgo de implementar soluciones técnicamente posibles que no corresponden al problema. El cuello de botella se desplaza desde “¿podemos programarlo?” hacia “¿qué merece construirse, con qué arquitectura y bajo qué evidencia?”. Además, la decisión suele terminar en una presentación estática: se conserva la conclusión, pero no siempre los pasajes utilizados, las alternativas descartadas, las objeciones ni la aprobación del responsable.'),
  h('Arquetipo de solución y decisiones de arquitectura'),
  p('Architect es un sistema de decisión con agentes especializados y Human-in-the-Loop. Recibe la descripción de una necesidad y un corpus acotado; recupera pasajes con cita; clasifica la intervención entre seis rutas —rediseño, reglas, datos/BI, IA asistiva, agente o no implementar—; compara dos o tres alternativas; somete la propuesta a un verificador crítico; y registra la decisión humana en un expediente persistente.'),
  p('En el espectro presentado por el curso, el diseño corresponde al Nivel 4: multiagentes + HITL, porque combina roles especializados y un checkpoint humano. Esa etiqueta no implica autoridad plena: Architect sólo recomienda. Nunca aprueba una inversión, ejecuta cambios ni elimina controles de la organización. El responsable puede aprobar la ruta, solicitar modificaciones o descartar la iniciativa.'),
  new Paragraph({ children: [new PageBreak()] }),
  p('La elección de un sistema de agentes, en lugar de un clasificador aislado, se justifica por el recorrido completo. Una etiqueta no alcanza: la recomendación debe estar conectada con evidencia, alternativas comparables, objeciones y una decisión auditada. La base disponible en Algedi ya incluye ingesta, recuperación por chunks, citas, el objeto Issue/Solve, alternativas, un verificador crítico, persistencia de revisión humana e interfaz React. Sobre esa base se implementó un prototipo Architect: endpoint de seis rutas, matriz común y una interfaz visual que representa —pero no decide— la salida del backend. El benchmark, la persistencia específica y la exportación quedan pendientes del piloto.'),
];

const page2 = [
  h('Riesgo principal y mitigación'),
  p('El riesgo más importante es que el sistema produzca una recomendación convincente pero incorrecta. El planificador y el verificador pueden compartir sesgos y coincidir en una conclusión débil; separar prompts reduce la correlación, pero no demuestra independencia. También existe el riesgo de citar un pasaje real que no respalda la afirmación formulada. Un tercer riesgo es construir un benchmark autoconfirmatorio mediante paráfrasis de los ejemplos usados para definir las seis rutas. Para evitarlo, al menos tres casos serán ambiguos, redactados por un tercero y etiquetados a ciegas antes de ejecutar Architect.'),
  p('La mitigación combina controles probabilísticos y determinísticos. Architect sólo puede utilizar marcadores de cita existentes; registra la evidencia faltante; compara la salida contra casos con clasificación esperada; conserva las objeciones del verificador; y exige una decisión humana antes de cerrar el expediente. Si falta evidencia relevante, la salida correcta es abstenerse o pedir información, no completar el hueco con una afirmación plausible. La demostración utilizará material propio, ficticio o públicamente accesible y excluirá documentación confidencial de empleadores, clientes o terceros.'),
  h('Qué aprendí durante el diseño'),
  p('Antes de este proceso tendía a considerar que el diferencial de un agente estaba principalmente en la arquitectura técnica: recuperación, memoria, orquestación y modelos. El Canvas me obligó a reconocer que esos componentes no constituyen valor por sí solos. El diseño sólo se vuelve defendible cuando el usuario, el costo actual, el cambio esperado y el criterio para detener el proyecto están formulados con la misma precisión que el stack.'),
  p('También aprendí que “no implementar” debe ser una salida de producto y no una excepción incómoda. Si el sistema siempre recomienda construir algo, optimiza la producción de proyectos, no la calidad de la decisión. Finalmente, entendí que un verificador no garantiza verdad ni independencia: su utilidad depende de un protocolo evaluable, citas auditables, casos de prueba y una frontera humana explícita. El resultado valioso de Architect no es una respuesta ni un grafo atractivo, sino un expediente que permite reconstruir por qué se eligió una ruta y qué tendría que cambiar para revisarla.'),
  new Paragraph({ spacing: { before: 260, after: 90 }, border: { top: { style: BorderStyle.SINGLE, color: COLORS.border, size: 6 } }, children: [new TextRun({ text: 'Nota metodológica', font: 'Calibri', size: 18, bold: true, color: COLORS.cyan })] }),
  p('El AI Canvas y la terminología de bloques se atribuyen a la metodología del curso. Cuando la nomenclatura del skill difiere de las diapositivas de clase, esta entrega sigue el material docente: B5 Arquitectura & Tools y B6 Behaviour / To-Be con HITL.', { size: 18, color: COLORS.muted, italics: true }),
];

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri', size: 21, color: COLORS.ink } } } },
  sections: [{
    properties: { page: { margin: { top: 850, right: 900, bottom: 800, left: 900 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Lucas Brusasca · Algedi Architect · ', size: 16, color: COLORS.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLORS.muted })] })] }) },
    children: [...page1, ...page2],
  }],
});

Packer.toBuffer(doc).then((buffer) => fs.writeFileSync('01_NOTAS_DE_DISENO_ALGEDI_ARCHITECT.docx', buffer));
