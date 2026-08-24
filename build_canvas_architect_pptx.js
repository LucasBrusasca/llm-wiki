const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Lucas Brusasca';
pptx.company = 'Algedi';
pptx.subject = 'AI Canvas Unificado — TP Final 2026';
pptx.title = 'AI Canvas — Algedi Architect';
pptx.lang = 'es-AR';
pptx.theme = { headFontFace: 'Cambria', bodyFontFace: 'Aptos', lang: 'es-AR' };

const C = {
  navy: '0B172A', panel: '15243A', white: 'FFFFFF', paper: 'F4F7FA', ink: '142238',
  muted: '66748A', line: 'D4DCE7', cyan: '16B9DF', cyanSoft: 'DDF7FC', amber: 'F2A93B',
  amberSoft: 'FFF2D9', mint: '2BC48A', mintSoft: 'DDF8EE', coral: 'E34B69',
  coralSoft: 'FFE5EA', violet: '7C6AEF', violetSoft: 'ECE9FF', slate: '98A6BA',
};
const ST = pptx.ShapeType;
const W = 13.333;

function tx(s, text, x, y, w, h, o = {}) {
  s.addText(text, { x, y, w, h, fontFace: o.fontFace || 'Aptos', fontSize: o.fontSize || 13,
    color: o.color || C.ink, bold: !!o.bold, margin: o.margin === undefined ? 0 : o.margin,
    valign: o.valign || 'mid', align: o.align || 'left', fit: 'shrink', breakLine: false,
    isTextBox: true, ...o });
}
function box(s, x, y, w, h, fill = C.white, line = C.line, radius = true) {
  s.addShape(radius ? ST.roundRect : ST.rect, { x, y, w, h, rectRadius: .06,
    fill: { color: fill }, line: { color: line, width: 1 } });
}
function rule(s, x, y, w, h, color = C.line, width = 1.2, endArrowType) {
  s.addShape(ST.line, { x, y, w, h, line: { color, width, endArrowType } });
}
function circle(s, x, y, d, fill, line = fill) {
  s.addShape(ST.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: line, width: 1 } });
}
function pill(s, text, x, y, w, fill, color, fs = 9) {
  box(s, x, y, w, .30, fill, fill, true);
  tx(s, text, x + .06, y + .01, w - .12, .27, { fontSize: fs, color, bold: true, align: 'center' });
}
function page(s, phase, title, pageNo, dark = false) {
  s.background = { color: dark ? C.navy : C.paper };
  tx(s, phase.toUpperCase(), .55, .28, 4.2, .22, { fontSize: 9, color: dark ? C.cyan : '117C98', bold: true, charSpacing: 1.5 });
  tx(s, title, .55, .61, 11.7, .58, { fontFace: 'Cambria', fontSize: 25, bold: true, color: dark ? C.white : C.ink });
  tx(s, `AI Canvas · Algedi Architect · ${pageNo}/7`, 9.78, 7.10, 2.95, .18, { fontSize: 8, color: dark ? '7F8EA7' : '8794A7', align: 'right' });
}
function blockTitle(s, id, name, x, y, w, accent, dark = false) {
  circle(s, x, y, .34, accent);
  tx(s, id, x, y, .34, .34, { fontSize: 9, bold: true, color: dark ? C.navy : C.white, align: 'center' });
  tx(s, name, x + .46, y - .01, w - .46, .34, { fontSize: 12, bold: true, color: dark ? C.white : C.ink });
}
function bullet(s, text, x, y, w, color = C.ink, fs = 10.5) {
  circle(s, x, y + .10, .10, C.cyan);
  tx(s, text, x + .20, y, w - .20, .42, { fontSize: fs, color, valign: 'top' });
}
function table(s, rows, x, y, widths, rowH, opts = {}) {
  const totalW = widths.reduce((a, b) => a + b, 0);
  rows.forEach((row, r) => {
    let cx = x;
    row.forEach((cell, c) => {
      const header = r === 0;
      box(s, cx, y + r * rowH, widths[c], rowH, header ? (opts.headerFill || C.navy) : (r % 2 ? C.white : 'EDF2F7'), header ? (opts.headerFill || C.navy) : C.line, false);
      tx(s, String(cell), cx + .07, y + r * rowH + .03, widths[c] - .14, rowH - .06, {
        fontSize: header ? (opts.headerSize || 8.5) : (opts.fontSize || 8.2),
        color: header ? C.white : C.ink, bold: header, valign: 'mid', align: c === 0 ? 'left' : (opts.align || 'left')
      });
      cx += widths[c];
    });
  });
  return totalW;
}

// 1 — Cover
{
  const s = pptx.addSlide(); s.background = { color: C.navy };
  tx(s, 'AI CANVAS UNIFICADO · ENTREGA FINAL 2026', .70, .48, 6.6, .25, { fontSize: 10, color: C.cyan, bold: true, charSpacing: 1.8 });
  tx(s, 'Algedi Architect', .70, 1.22, 7.3, .82, { fontFace: 'Cambria', fontSize: 36, bold: true, color: C.white });
  tx(s, 'Decidir qué construir antes de elegir la tecnología.', .72, 2.15, 7.1, .52, { fontSize: 19, color: 'A9B7CC' });
  const phases = [
    ['F1', 'PROBLEMA', C.coral], ['F2', 'SOLUCIÓN', C.cyan], ['F3', 'PRODUCTO', C.violet], ['F4', 'IMPLEMENTACIÓN', C.mint],
  ];
  phases.forEach((p, i) => {
    const x = .72 + i * 2.28;
    box(s, x, 3.42, 1.93, 1.25, C.panel, '2B3D58');
    circle(s, x + .18, 3.66, .38, p[2]);
    tx(s, p[0], x + .18, 3.66, .38, .38, { fontSize: 10, bold: true, color: C.navy, align: 'center' });
    tx(s, p[1], x + .18, 4.19, 1.56, .23, { fontSize: 10, color: C.white, bold: true, align: 'center' });
    if (i < 3) rule(s, x + 1.94, 4.04, .32, 0, '52647F', 1.4, 'triangle');
  });
  box(s, 9.95, 1.16, 2.55, 4.38, '102C42', C.cyan);
  pill(s, 'INICIATIVA FOCAL', 10.31, 1.60, 1.82, '173F58', C.cyan, 9);
  tx(s, '6', 10.31, 2.18, 1.82, .72, { fontFace: 'Cambria', fontSize: 34, bold: true, color: C.white, align: 'center' });
  tx(s, 'rutas posibles', 10.31, 2.90, 1.82, .24, { fontSize: 11, color: 'A9B7CC', align: 'center' });
  tx(s, '2', 10.31, 3.55, 1.82, .60, { fontFace: 'Cambria', fontSize: 30, bold: true, color: C.white, align: 'center' });
  tx(s, 'agentes + HITL', 10.31, 4.14, 1.82, .24, { fontSize: 11, color: 'A9B7CC', align: 'center' });
  tx(s, '1', 10.31, 4.64, 1.82, .55, { fontFace: 'Cambria', fontSize: 28, bold: true, color: C.cyan, align: 'center' });
  tx(s, 'expediente auditable', 10.18, 5.15, 2.08, .24, { fontSize: 10, color: C.white, bold: true, align: 'center' });
  pill(s, 'SUPUESTOS, NO RESULTADOS', .72, 5.48, 2.40, C.amberSoft, '704705', 9);
  tx(s, 'Los volúmenes, tiempos y costos se validan en el piloto.', 3.34, 5.47, 5.55, .32, { fontSize: 12, color: C.white, bold: true });
  tx(s, 'Lucas Brusasca · AI Agents — De la Idea a la Implementación', .72, 6.75, 7.1, .22, { fontSize: 9, color: '7F8EA7' });
}

// 2 — F1
{
  const s = pptx.addSlide(); page(s, 'Fase 1 · Problema', 'De “queremos IA” a una hipótesis comprobable', 2);
  box(s, .55, 1.43, 3.86, 4.97); blockTitle(s, 'B1', 'Pain points & usuarios', .82, 1.70, 3.28, C.coral);
  tx(s, 'La herramienta se elige antes de comprender la necesidad.', .82, 2.18, 3.22, .54, { fontFace: 'Cambria', fontSize: 17, bold: true, color: C.ink });
  bullet(s, 'Usuario: responsable de innovación o datos de una PyME sin arquitecto dedicado.', .82, 2.95, 3.20);
  bullet(s, 'Escenario: 6 iniciativas por trimestre; 8 h de preparación por caso.', .82, 3.55, 3.20);
  pill(s, 'ESCENARIO A VALIDAR', .82, 4.35, 1.76, C.amberSoft, '704705', 8);
  tx(s, 'USD 1.200', .82, 4.78, 1.35, .37, { fontFace: 'Cambria', fontSize: 20, bold: true });
  tx(s, 'preparación / trimestre', 2.18, 4.82, 1.60, .27, { fontSize: 9.5, color: C.muted });
  tx(s, '+ USD 2.000', .82, 5.32, 1.48, .34, { fontFace: 'Cambria', fontSize: 16, bold: true, color: C.coral });
  tx(s, 'desarrollo incorrecto de referencia', 2.18, 5.33, 1.78, .33, { fontSize: 9.3, color: C.muted });

  box(s, 4.67, 1.43, 4.02, 4.97); blockTitle(s, 'B2', 'As-Is & Data', 4.94, 1.70, 3.46, C.cyan);
  const asis = [['1','Reconstruir problema','2 h'],['2','Buscar evidencia','2 h'],['3','Elegir alternativa','1 h'],['4','Preparar caso','3 h']];
  asis.forEach((r, i) => {
    const y = 2.23 + i * .63; circle(s, 4.95, y, .30, C.cyanSoft, C.cyan);
    tx(s, r[0], 4.95, y, .30, .30, { fontSize: 8, bold: true, align: 'center' });
    tx(s, r[1], 5.38, y - .01, 2.16, .28, { fontSize: 10.5, bold: true });
    tx(s, r[2], 7.61, y - .01, .62, .28, { fontSize: 10, color: C.muted, align: 'right' });
  });
  rule(s, 4.96, 4.80, 3.40, 0, C.line, 1);
  tx(s, 'INVENTARIO / GAPS', 4.94, 5.02, 1.48, .20, { fontSize: 8.5, color: '117C98', bold: true });
  tx(s, 'Disponibles: brief + 3–10 documentos. Ausentes: baseline real, historial y banco ciego de 12 casos, con 3 ambiguos redactados por un tercero.', 4.94, 5.30, 3.36, .67, { fontSize: 9.6, color: C.muted, valign: 'top' });

  box(s, 8.95, 1.43, 3.83, 4.97); blockTitle(s, 'B3', 'Valor de Cambio', 9.22, 1.70, 3.26, C.mint);
  const gates = [['10 / 12','clasificaciones'],['0','referencias inexistentes'],['4 / 5','consistencia'],['100%','decisión humana']];
  gates.forEach((g, i) => {
    const y = 2.28 + i * .72; box(s, 9.20, y, 3.30, .55, i === 0 ? C.mintSoft : C.white, C.line);
    tx(s, g[0], 9.39, y + .08, .85, .34, { fontFace: 'Cambria', fontSize: 15, bold: true, color: i === 0 ? '176447' : C.ink, align: 'center' });
    tx(s, g[1], 10.38, y + .08, 1.83, .34, { fontSize: 9.5, color: C.muted });
  });
  pill(s, 'ABANDONAR SI FALLA EL GATE', 9.20, 5.41, 2.50, C.coralSoft, '8F233A', 8);
  tx(s, 'El éxito no es “que corra”: es demostrar calidad, trazabilidad y control.', 9.20, 5.82, 3.18, .40, { fontSize: 10, bold: true });
}

// 3 — B4
{
  const s = pptx.addSlide(); page(s, 'Fase 2 · Solución', 'B4 — Un protocolo que puede terminar en “no implementar”', 3, true);
  const steps = [
    ['1','RECIBE','problema + restricciones'], ['2','RECUPERA','pasajes + citas'], ['3','CLASIFICA','seis rutas'],
    ['4','COMPARA','matriz común'], ['5','VERIFICA','objeción separada'], ['6','ESCALA','decisión humana'], ['7','PERSISTE','expediente'],
  ];
  steps.forEach((st, i) => {
    const x = .48 + i * 1.82;
    box(s, x, 1.66, 1.55, 1.22, i === 5 ? '173F58' : C.panel, i === 5 ? C.cyan : '2D405C');
    circle(s, x + .11, 1.84, .30, i === 5 ? C.cyan : '2A405D');
    tx(s, st[0], x + .11, 1.84, .30, .30, { fontSize: 8, bold: true, color: i === 5 ? C.navy : C.cyan, align: 'center' });
    tx(s, st[1], x + .48, 1.82, .95, .24, { fontSize: 9.5, bold: true, color: C.white });
    tx(s, st[2], x + .12, 2.30, 1.30, .30, { fontSize: 8.4, color: 'AAB8CC', align: 'center' });
    if (i < 6) rule(s, x + 1.57, 2.26, .22, 0, '536985', 1.2, 'triangle');
  });
  tx(s, 'SEIS RUTAS COMPARABLES', .62, 3.42, 2.7, .22, { fontSize: 9, bold: true, color: C.cyan, charSpacing: 1.1 });
  const routes = [['Rediseño',C.amber],['Reglas',C.mint],['Datos / BI',C.cyan],['IA asistiva',C.violet],['Agente',C.coral],['No implementar',C.slate]];
  routes.forEach((r, i) => {
    const x = .64 + i * 2.04; box(s, x, 3.82, 1.76, .72, '122239', '354A67');
    circle(s, x + .15, 4.05, .24, r[1]); tx(s, r[0], x + .50, 3.94, 1.10, .32, { fontSize: 10, bold: true, color: C.white, align: 'center' });
  });
  box(s, .64, 4.93, 7.55, 1.35, C.panel, '2D405C');
  tx(s, 'DIFERENCIAL', .92, 5.18, 1.15, .20, { fontSize: 8.5, color: C.amber, bold: true, charSpacing: 1 });
  tx(s, 'No entrega una respuesta descartable: conserva evidencia, alternativas, matriz, objeción, decisión, comentario, fecha y versión.', .92, 5.52, 6.84, .40, { fontSize: 13, color: C.white, bold: true });
  box(s, 8.52, 4.93, 4.20, 1.35, '173F58', C.cyan);
  tx(s, 'INTERFAZ ≠ CEREBRO', 8.84, 5.17, 1.85, .20, { fontSize: 8.5, color: C.cyan, bold: true, charSpacing: 1 });
  tx(s, 'El HTML representa la salida. Planner y verifier corren en el backend de Algedi.', 8.84, 5.50, 3.42, .46, { fontSize: 12, color: C.white, bold: true });
}

// 4 — B5 + B6
{
  const s = pptx.addSlide(); page(s, 'Fase 2 · Solución', 'B5 Arquitectura & Tools · B6 Behaviour / To-Be', 4);
  blockTitle(s, 'B5', 'Arquitectura & Tools', .60, 1.42, 3.4, C.cyan);
  const nodes = [['Brief','input'],['Retrieve','evidencia'],['Planner','clase + matriz'],['Verifier','objeciones'],['Humano','decisión'],['Expediente','registro']];
  nodes.forEach((n, i) => {
    const x = .58 + i * 2.05; box(s, x, 1.91, 1.65, .70, i === 4 ? C.cyanSoft : C.white, i === 4 ? C.cyan : C.line);
    tx(s, n[0], x + .10, 2.03, 1.45, .22, { fontSize: 10, bold: true, align: 'center' });
    tx(s, n[1], x + .10, 2.29, 1.45, .18, { fontSize: 8.2, color: C.muted, align: 'center' });
    if (i < 5) rule(s, x + 1.66, 2.25, .35, 0, '9AA8BB', 1.2, 'triangle');
  });
  const rows = [
    ['Tool','Input','Output','Estado'],
    ['ingest_case','archivos / URL','chunks + nodos','Disponible'],
    ['retrieve_evidence','consulta + corpus','pasajes + fuente','Disponible'],
    ['classify_intervention','problema + evidencia','ruta + supuestos','Prototipo'],
    ['compare_alternatives','rutas + criterios','matriz común','Prototipo'],
    ['verify_recommendation','propuesta + citas','veredicto + gaps','Disponible'],
    ['record_human_decision','estado + nota','historial auditable','Disponible'],
    ['export_dossier','expediente','MD / PDF','Pendiente'],
  ];
  table(s, rows, .60, 2.90, [2.20,2.58,2.48,1.22], .38, { fontSize: 7.8, headerSize: 8.2 });
  box(s, 9.16, 2.90, 3.58, 3.04, C.navy, C.navy);
  blockTitle(s, 'B6', 'Behaviour / To-Be', 9.43, 3.16, 2.98, C.mint, true);
  const tobe = [['Brief + corpus','10–20 min'],['Recuperar','<1 min'],['Comparar','2–5 min'],['Verificar','1–3 min'],['Revisar','hasta 90 min']];
  tobe.forEach((r, i) => {
    tx(s, r[0], 9.47, 3.62 + i * .31, 1.78, .22, { fontSize: 9.2, color: C.white });
    tx(s, r[1], 11.34, 3.62 + i * .31, .98, .22, { fontSize: 9.2, color: C.cyan, bold: true, align: 'right' });
  });
  pill(s, 'NIVEL 4 · MULTIAGENTES + HITL', 9.46, 5.25, 2.80, '203A52', C.cyan, 8);
  tx(s, 'Autoridad acotada: recomienda; nunca ejecuta ni aprueba inversiones.', 9.47, 5.61, 2.84, .23, { fontSize: 8.6, color: 'B4C0D0', bold: true });
  pill(s, 'STACK', .60, 6.19, .74, C.cyanSoft, '117C98', 8);
  tx(s, 'React · FastAPI · PostgreSQL/pgvector · proveedor LLM intercambiable · Docker Compose', 1.48, 6.18, 7.40, .27, { fontSize: 10.5, bold: true });
}

// 5 — F3
{
  const s = pptx.addSlide(); page(s, 'Fase 3 · Producto', 'Valor para decidir, no una promesa de SaaS', 5);
  const cols = [
    { x:.58, id:'B7', title:'Propuesta de valor', accent:C.violet, items:['Expediente comparable y reabrible','Alternativas sin IA y “no implementar”','Evidencia, objeción y aprobación explícitas'] },
    { x:4.57, id:'B8', title:'Customers', accent:C.cyan, items:['Responsable de innovación / datos','Sponsor: dirección o dueño de inversión','Piloto guiado de dos semanas'] },
    { x:8.56, id:'B9', title:'Costos y recursos', accent:C.mint, items:['Activo de validación; sin revenue proyectado','Autor + dos evaluadores','Equipo local + inferencia'] },
  ];
  cols.forEach((c) => {
    box(s, c.x, 1.48, 3.54, 2.30); blockTitle(s, c.id, c.title, c.x + .25, 1.77, 3.05, c.accent);
    c.items.forEach((it, i) => bullet(s, it, c.x + .27, 2.34 + i * .43, 2.96, C.ink, 9.5));
  });
  box(s, .58, 4.15, 7.42, 2.20, C.navy, C.navy);
  tx(s, 'ESCENARIO ECONÓMICO · A VALIDAR', .88, 4.42, 3.40, .22, { fontSize: 9, color: C.amber, bold: true, charSpacing: 1 });
  const econ = [['USD 900','ahorro horas / trimestre'],['USD 1.000','error evitado esperado'],['USD 1.040','inversión incremental']];
  econ.forEach((e, i) => {
    const x = .88 + i * 2.20; tx(s, e[0], x, 4.88, 1.65, .42, { fontFace:'Cambria', fontSize:19, bold:true, color:i===2?C.cyan:C.white, align:'center' });
    tx(s, e[1], x, 5.34, 1.65, .31, { fontSize:8.7, color:'AEBACB', align:'center' });
  });
  tx(s, 'ROI 82,7% · payback 1,6 meses', .88, 5.86, 3.14, .27, { fontSize: 12, color: C.mint, bold: true });
  tx(s, 'Sensibilidad sin error evitado: payback 3,5 meses.', 4.22, 5.84, 3.08, .30, { fontSize: 10, color: C.amber, bold: true });
  box(s, 8.34, 4.15, 4.23, 2.20, C.white, C.line);
  tx(s, 'DIFERENCIACIÓN', 8.68, 4.45, 1.82, .22, { fontSize: 9, color:'117C98', bold:true, charSpacing:1 });
  tx(s, 'Un chat recomienda. Architect gobierna el paso de evidencia a decisión.', 8.68, 4.84, 3.48, .55, { fontFace:'Cambria', fontSize:17, bold:true });
  tx(s, 'La ventaja no es el modelo: es el protocolo persistente, evaluable y con frontera humana.', 8.68, 5.53, 3.48, .44, { fontSize:10.5, color:C.muted, bold:true });
}

// 6 — F4 B10/B11
{
  const s = pptx.addSlide(); page(s, 'Fase 4 · Implementación', 'B10 Integración & Infra · B11 MVP + Riesgos', 6);
  box(s, .58, 1.45, 4.02, 4.98); blockTitle(s, 'B10', 'Integración & Infra', .86, 1.74, 3.44, C.cyan);
  const pipe = ['Archivos / texto','Chunks + metadatos','Embeddings + pgvector','Planner + verifier','Expediente'];
  pipe.forEach((p, i) => {
    box(s, .90, 2.25 + i * .59, 3.26, .40, i === 3 ? C.cyanSoft : C.white, i === 3 ? C.cyan : C.line);
    tx(s, p, 1.08, 2.30 + i * .59, 2.90, .27, { fontSize: 9.5, bold: true, align:'center' });
    if (i < 4) rule(s, 2.53, 2.66 + i * .59, 0, .16, '9AA8BB', 1.2, 'triangle');
  });
  pill(s, 'MÍNIMO PRIVILEGIO', .90, 5.42, 1.78, C.coralSoft, '8F233A', 8);
  tx(s, 'Sólo material propio, ficticio o público. Sin conectores productivos.', .90, 5.82, 3.15, .38, { fontSize: 9.5, color:C.muted, bold:true });

  box(s, 4.86, 1.45, 3.62, 4.98); blockTitle(s, 'B11', 'MVP de 2 semanas', 5.14, 1.74, 3.08, C.mint);
  tx(s, 'MUST', 5.16, 2.28, .70, .20, { fontSize:8.5, color:'176447', bold:true });
  tx(s, '6 clases · citas · 3 alternativas · matriz · verifier · HITL · 12 casos (3 ambiguos)', 5.16, 2.57, 2.88, .60, { fontSize:9.6, bold:true, valign:'top' });
  tx(s, 'WON’T', 5.16, 3.38, .80, .20, { fontSize:8.5, color:'8F233A', bold:true });
  tx(s, 'SaaS · avatar · sistemas productivos · grafo 3D central · research autónomo', 5.16, 3.67, 2.88, .55, { fontSize:10, color:C.muted, valign:'top' });
  pill(s, 'GATE AL DÍA 14', 5.16, 4.54, 1.46, C.amberSoft, '704705', 8);
  tx(s, '10/12 · 0 citas falsas · 100% HITL · 90% claim-cita o supuesto', 5.16, 4.94, 2.84, .58, { fontSize:10, bold:true });
  tx(s, 'El endpoint existe; el benchmark todavía no.', 5.16, 5.78, 2.80, .24, { fontSize:9.5, color:C.coral, bold:true });

  box(s, 8.74, 1.45, 3.99, 4.98, C.navy, C.navy); tx(s, 'REGISTRO DE RIESGOS', 9.04, 1.83, 2.34, .22, { fontSize:9, color:C.amber, bold:true, charSpacing:1 });
  const risks = [
    ['ALTO','Sesgo compartido','benchmark + HITL','Autor'],
    ['ALTO','Cita irrelevante','auditoría claim-cita','Autor + evaluador'],
    ['ALTO','Benchmark circular','casos ambiguos + etiqueta ciega','Evaluadores'],
    ['ALTO','Taxonomía ambigua','dos evaluadores','Evaluadores'],
    ['MEDIO','Baseline supuesto','medir antes/después','Autor'],
    ['ALTO','Corpus pobre','abstención + gaps','Autor'],
  ];
  risks.forEach((r, i) => {
    const y = 2.22 + i * .60; pill(s, r[0], 9.04, y, .72, r[0]==='ALTO'?C.coralSoft:C.amberSoft, r[0]==='ALTO'?'8F233A':'704705', 7.2);
    tx(s, r[1], 9.92, y - .01, 1.44, .20, { fontSize:8.7, color:C.white, bold:true });
    tx(s, `Resp.: ${r[3]}`, 11.31, y - .01, 1.02, .20, { fontSize:6.8, color:C.cyan, bold:true, align:'right' });
    tx(s, r[2], 9.92, y + .23, 2.40, .20, { fontSize:7.7, color:'AEBACB' });
  });
}

// 7 — B12
{
  const s = pptx.addSlide(); page(s, 'Fase 4 · Cierre del loop', 'B12 — Métricas, roadmap y decisión de continuidad', 7, true);
  const metricCols = [
    {x:.58,title:'TÉCNICAS',color:C.cyan,items:['10/12 clasificaciones','0 citas inexistentes','consistencia 4/5','corrida <10 min']},
    {x:4.34,title:'PRODUCTO',color:C.violet,items:['100% con decisión','utilidad ≥4/5','≤2 ciclos de corrección','campos sin edición']},
    {x:8.10,title:'NEGOCIO',color:C.mint,items:['horas As-Is / To-Be','ahorro realizado','costo de inferencia','payback recalculado']},
  ];
  metricCols.forEach((m) => {
    box(s, m.x, 1.42, 3.43, 2.18, C.panel, '2D405C');
    pill(s, m.title, m.x+.24, 1.72, 1.28, '243952', m.color, 8);
    m.items.forEach((it,i)=>bullet(s,it,m.x+.27,2.17+i*.34,2.83,C.white,9));
  });
  tx(s, 'ROADMAP · 14 DÍAS', .60, 4.02, 2.05, .22, {fontSize:9,color:C.cyan,bold:true,charSpacing:1});
  const road = [['1–2','Taxonomía + etiquetas ciegas'],['3–7','Endpoint + matriz'],['8–10','UI + expediente'],['11–12','Benchmark + repeticiones'],['13–14','Medir + decidir']];
  road.forEach((r,i)=>{
    const x=.60+i*2.48; circle(s,x,4.52,.46,i===4?C.mint:C.cyanSoft,i===4?C.mint:C.cyan);
    tx(s,r[0],x,4.52,.46,.46,{fontSize:8.5,bold:true,align:'center',color:C.navy});
    tx(s,r[1],x-.12,5.16,1.86,.45,{fontSize:9.5,color:C.white,bold:true,align:'center'});
    if(i<4) rule(s,x+.47,4.75,1.96,0,'526985',1.4,'triangle');
  });
  box(s, .60, 5.92, 12.12, .78, '173F58', C.cyan);
  tx(s, 'DECISIÓN FINAL', .86, 6.12, 1.42, .22, {fontSize:9,color:C.cyan,bold:true,charSpacing:1});
  tx(s, 'Escalar sólo si el gate se cumple. Si falla, publicar el error, corregir o detener.', 2.58, 6.03, 8.70, .36, {fontFace:'Cambria',fontSize:16,color:C.white,bold:true,align:'center'});
  pill(s, 'RESPONSABLE: AUTOR + REVISOR', 10.27, 6.38, 2.05, '203A52', C.cyan, 7.5);
}

function validateSlides() {
  for (const s of pptx._slides) {
    for (const [i, obj] of (s._slideObjects || []).entries()) {
      const o = obj.options;
      if (!o || [o.x,o.y,o.w,o.h].some(v => typeof v !== 'number')) continue;
      if (o.x < 0 || o.y < 0 || o.x + o.w > W + .01 || o.y + o.h > 7.51) {
        console.warn(`Fuera de límites: slide ${s._slideNum}, objeto ${i}`);
      }
    }
  }
}
validateSlides();
pptx.writeFile({ fileName: '02_AI_CANVAS_ALGEDI_ARCHITECT.pptx' }).catch(err => { console.error(err); process.exitCode = 1; });
