import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Hash, Calendar, Type, ToggleLeft, KeyRound, Link2, ChevronRight, Table2, Eye, X, Loader2, RotateCw,
  Download, Image as ImageIcon, BarChart3, Rows3, Columns3, Sigma, Filter, Database, Save, Network, Check,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { fetchModelo, pivotDatos, agregarRelacionModelo, quitarRelacionModelo } from '@/lib/api';
import { cruzar, aCSV, descargar, graficoSugerido } from '@/lib/pivot';
import Grafico, { TIPOS_GRAFICO, motivoNoDisponible } from '@/app/Grafico';
import { cn } from '@/lib/utils';

// El diagrama (React Flow) sólo se baja si se abre la vista Modelo.
const ModeloDatos = lazy(() => import('@/app/ModeloDatos'));

const ICONO_CLASE = { numerica: Hash, fecha: Calendar, texto: Type, booleano: ToggleLeft };
const AGREGACIONES = [
  ['suma', 'Suma'], ['promedio', 'Promedio'], ['conteo', 'Cantidad'], ['distintos', 'Distintos'],
  ['min', 'Mínimo'], ['max', 'Máximo'],
];
const FECHAS = [['', 'sin agrupar'], ['año', 'por año'], ['trimestre', 'por trimestre'], ['mes', 'por mes'], ['dia', 'por día']];
const OPERADORES = ['=', '!=', '>', '>=', '<', '<=', 'contiene'];
const POZOS = [
  { id: 'filas', label: 'Filas', icon: Rows3 },
  { id: 'columnas', label: 'Columnas', icon: Columns3 },
  { id: 'valores', label: 'Valores', icon: Sigma },
  { id: 'filtros', label: 'Filtros', icon: Filter },
];
const VACIO = { filas: [], columnas: [], valores: [], filtros: [] };
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const sel = 'h-6 rounded-xs border border-hair bg-surface-2 px-1 text-[11px] text-ink focus:border-accent/60 focus:outline-none';

/** Lo que se agrega al soltar un campo en un pozo, con valores por defecto sensatos. */
function nuevo(pozo, t, c) {
  const base = { tabla: t.clave, columna: c.nombre };
  if (pozo === 'valores') {
    const sumable = c.clase === 'numerica' && !c.pk && !c.ref;
    return { ...base, agregacion: sumable ? 'suma' : 'conteo' };
  }
  if (pozo === 'filtros') return { ...base, op: c.clase === 'texto' ? 'contiene' : '=', valor: '' };
  return c.clase === 'fecha' ? { ...base, fecha: 'mes' } : base;
}

/** El árbol de la fuente, como el navegador de DBeaver: tablas → campos. */
function ArbolCampos({ modelo, abiertas, onAlternar, onAgregar }) {
  return (
    <ul className="flex flex-col">
      {modelo.tablas.map((t) => {
        const abierta = abiertas.has(t.clave);
        return (
          <li key={t.clave}>
            <button type="button" onClick={() => onAlternar(t.clave)}
              className="flex w-full items-center gap-1.5 rounded-xs px-1.5 py-1 text-left text-[12px] text-ink hover:bg-surface-2">
              <ChevronRight className={cn('size-3 shrink-0 text-ink-dim transition-transform', abierta && 'rotate-90')} />
              {t.vista ? <Eye className="size-3.5 shrink-0 text-ink-dim" /> : <Table2 className="size-3.5 shrink-0 text-ink-dim" />}
              <span className="min-w-0 flex-1 truncate">{t.clave}</span>
              {t.filas_aprox != null && <span className="text-[10.5px] tabular-nums text-ink-dim">{fmt.format(t.filas_aprox)}</span>}
            </button>
            {abierta && (
              <ul className="mb-1 ml-4 border-l border-hair pl-1">
                {t.campos.map((c) => {
                  const Icon = ICONO_CLASE[c.clase] || Type;
                  return (
                    <li key={c.nombre}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-campo', JSON.stringify({ tabla: t.clave, campo: c.nombre }));
                              e.dataTransfer.effectAllowed = 'copy';
                            }}
                            title={[c.tipo, c.pk && 'clave primaria', c.ref && `apunta a ${c.ref.tabla}.${c.ref.columna}`].filter(Boolean).join(' · ')}
                            className="flex w-full cursor-grab items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-left text-[11.5px] text-ink-muted hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
                          >
                            <Icon className="size-3 shrink-0 text-ink-dim" />
                            <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                            {c.pk && <KeyRound className="size-3 shrink-0 text-warn/80" />}
                            {c.ref && <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-ink-dim"><Link2 className="size-3" />{c.ref.tabla}</span>}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="right">
                          <DropdownMenuLabel>{c.nombre}</DropdownMenuLabel>
                          {POZOS.map((p) => (
                            <DropdownMenuItem key={p.id} onSelect={() => onAgregar(p.id, t, c)}>
                              <p.icon /> A {p.label.toLowerCase()}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Un campo puesto en un pozo, con lo que se puede ajustar ahí mismo. */
function Ficha({ pozo, x, campo, onCambio, onQuitar }) {
  const etiqueta = x.columna === '*' ? 'filas' : (x.tabla === 'datos' ? x.columna : `${x.tabla}.${x.columna}`);
  return (
    <span className="flex items-center gap-1 rounded-xs border border-hair-strong bg-surface-2 py-0.5 pl-1.5 pr-0.5 text-[11.5px] text-ink">
      {pozo === 'valores' && (
        <select className={sel} value={x.agregacion} onChange={(e) => onCambio({ agregacion: e.target.value })}>
          {AGREGACIONES.filter(([id]) => campo?.clase === 'numerica' || ['conteo', 'distintos', 'min', 'max'].includes(id))
            .map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      )}
      <span className="max-w-[180px] truncate">{etiqueta}</span>
      {(pozo === 'filas' || pozo === 'columnas') && campo?.clase === 'fecha' && (
        <select className={sel} value={x.fecha || ''} onChange={(e) => onCambio({ fecha: e.target.value || undefined })}>
          {FECHAS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      )}
      {pozo === 'filtros' && (
        <>
          <select className={sel} value={x.op} onChange={(e) => onCambio({ op: e.target.value })}>
            {OPERADORES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input className={cn(sel, 'w-24')} value={x.valor ?? ''} placeholder="valor"
            onChange={(e) => onCambio({ valor: e.target.value })} />
        </>
      )}
      <button type="button" onClick={onQuitar} aria-label="Quitar" className="grid size-4 place-items-center rounded-xs text-ink-dim hover:bg-surface-3 hover:text-ink">
        <X className="size-3" />
      </button>
    </span>
  );
}

const textoRel = (r) => `${r.desde.tabla}.${r.desde.columna} → ${r.hacia.tabla}.${r.hacia.columna}`;

/** Las relaciones del modelo: las de la base, las marcadas a mano (se pueden sacar) y
 *  las que sugieren los nombres de los campos (se aceptan con un clic). */
function PanelRelaciones({ modelo, onAceptar, onQuitar, onVerModelo }) {
  const sugeridas = modelo.sugeridas || [];
  if (modelo.tablas.length < 2) return null;
  return (
    <div className="mt-3 px-1.5">
      <p className="flex items-center text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">
        Relaciones
        <button type="button" onClick={onVerModelo} className="ml-auto flex items-center gap-1 normal-case tracking-normal hover:text-ink">
          <Network className="size-3" /> ver modelo
        </button>
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-[11px]">
        {modelo.relaciones.map((r) => (
          <li key={textoRel(r)} className="group flex items-center gap-1 text-ink-dim"
            title={r.origen === 'manual' ? 'Marcada a mano' : 'Clave foránea de la base'}>
            <Link2 className={cn('size-3 shrink-0', r.origen === 'manual' && 'text-accent')} />
            <span className="min-w-0 flex-1 truncate">{textoRel(r)}</span>
            {r.origen === 'manual' && (
              <button type="button" onClick={() => onQuitar(r)} aria-label="Sacar la relación"
                className="invisible grid size-4 place-items-center rounded-xs hover:bg-surface-3 hover:text-ink group-hover:visible">
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
        {sugeridas.map((r) => (
          <li key={`s-${textoRel(r)}`} className="flex items-center gap-1 text-warn/90" title="Los nombres sugieren esta relación">
            <Link2 className="size-3 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{textoRel(r)}</span>
            <button type="button" onClick={() => onAceptar(r)}
              className="flex shrink-0 items-center gap-0.5 rounded-xs px-1 text-[10.5px] hover:bg-surface-3 hover:text-ink">
              <Check className="size-3" /> unir
            </button>
          </li>
        ))}
      </ul>
      {!modelo.relaciones.length && !sugeridas.length && (
        <p className="mt-1 text-[11px] leading-snug text-ink-dim">
          Ninguna todavía. En <button type="button" onClick={onVerModelo} className="underline hover:text-ink">Modelo</button> arrastrá de un campo a otro para unir dos tablas.
        </p>
      )}
    </div>
  );
}

export function TablaCruzada({ cruce }) {
  const { dimsFilas, medidas, filas, columnas, totales } = cruce;
  const sumables = medidas.every((m) => /^(Suma|Cantidad)/.test(m.etiqueta));
  const unaMedida = medidas.length === 1;
  return (
    <div className="max-h-full overflow-auto rounded-md border border-hair">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 z-[1] bg-surface-2">
          <tr>
            {dimsFilas.map((d) => <th key={d.clave} className="hairline-b px-2 py-1.5 text-left font-medium text-ink">{d.etiqueta}</th>)}
            {columnas.map((c) => medidas.map((m) => (
              <th key={`${c.clave}-${m.clave}`} className="hairline-b px-2 py-1.5 text-right font-medium text-ink">
                {c.etiqueta && unaMedida ? c.etiqueta : [c.etiqueta, m.etiqueta].filter(Boolean).join(' · ')}
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.clave} className={cn(i % 2 && 'bg-surface-2/40')}>
              {f.etiquetas.map((e, j) => <td key={j} className="max-w-[260px] truncate px-2 py-1 text-ink-muted" title={e}>{e}</td>)}
              {columnas.map((c) => medidas.map((m, k) => {
                const v = f.celdas.get(c.clave)?.[k];
                return <td key={`${c.clave}-${m.clave}`} className="px-2 py-1 text-right tabular-nums text-ink">{v == null ? '' : fmt.format(v)}</td>;
              }))}
            </tr>
          ))}
        </tbody>
        {sumables && filas.length > 1 && (
          <tfoot className="sticky bottom-0 bg-surface-2">
            <tr>
              {dimsFilas.length > 0 && <td colSpan={dimsFilas.length} className="px-2 py-1.5 font-medium text-ink">Total</td>}
              {columnas.map((c, ci) => medidas.map((m, k) => (
                <td key={`${c.clave}-${m.clave}`} className="px-2 py-1.5 text-right font-medium tabular-nums text-ink">{fmt.format(totales[ci][k])}</td>
              )))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Explorador de una fuente de datos, como DBeaver + Power BI: el árbol de tablas y
 * campos, y una tabla dinámica (filas, columnas, valores, filtros) que une las tablas
 * por sus relaciones. Se ve como tabla cruzada o como gráfico, con el SQL a la vista,
 * y se exporta. Todo en sólo lectura.
 */
export default function ExploradorDatos({ open, onOpenChange, nodo, tablaInicial, onGuardarReporte, specInicial }) {
  const [modelo, setModelo] = useState(null);
  const [error, setError] = useState(null);
  const [abiertas, setAbiertas] = useState(() => new Set());
  const [spec, setSpec] = useState(VACIO);
  const [res, setRes] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState('tabla');
  const [tipo, setTipo] = useState(null);           // null = el sugerido
  const [sobre, setSobre] = useState(null);         // pozo con un campo arrastrado encima
  const [guardando, setGuardando] = useState(false);
  const grafico = useRef(null);

  const cargarModelo = useCallback((fresco = false) => {
    if (!nodo) return;
    setError(null);
    fetchModelo(nodo.id, { fresco }).then((m) => {
      setModelo(m);
      setAbiertas((a) => (a.size ? a : new Set([tablaInicial || m.tablas[0]?.clave].filter(Boolean))));
    }).catch((e) => setError(e.message));
  }, [nodo, tablaInicial]);

  useEffect(() => {
    if (!open) return;
    setModelo(null); setRes(null); setTipo(null); setVista(specInicial?.vista || 'tabla');
    setSpec({ ...VACIO, ...specInicial?.spec });   // un reporte viejo puede no traer todos los pozos
    if (specInicial?.tipo) setTipo(specInicial.tipo);
    setAbiertas(new Set(tablaInicial ? [tablaInicial] : []));
    cargarModelo();
  }, [open, nodo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const campos = useMemo(() => {
    const m = new Map();
    for (const t of modelo?.tablas || []) for (const c of t.campos) m.set(`${t.clave}.${c.nombre}`, c);
    return m;
  }, [modelo]);

  const listo = spec.filas.length + spec.columnas.length + spec.valores.length > 0;
  useEffect(() => {
    if (!open || !nodo || !modelo || !listo) { setRes(null); return undefined; }
    const enviable = { ...spec, filtros: spec.filtros.filter((f) => String(f.valor ?? '').trim() !== '') };
    let vivo = true;
    const t = setTimeout(() => {
      setCargando(true);
      pivotDatos(nodo.id, enviable)
        .then((r) => { if (vivo) { setRes(r); setError(null); } })
        .catch((e) => { if (vivo) { setRes(null); setError(e.message); } })
        .finally(() => vivo && setCargando(false));
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [spec, open, nodo, modelo, listo]);

  const cruce = useMemo(() => (res ? cruzar(res) : null), [res]);
  const tipoGrafico = tipo || (cruce ? graficoSugerido(spec, cruce) : 'barras');

  const agregar = (pozo, t, c) => setSpec((s) => {
    const x = nuevo(pozo, t, c);
    const repetido = s[pozo].some((y) => y.tabla === x.tabla && y.columna === x.columna && pozo !== 'filtros' && pozo !== 'valores');
    return repetido ? s : { ...s, [pozo]: [...s[pozo], x] };
  });
  const cambiar = (pozo, i, cambios) => setSpec((s) => ({ ...s, [pozo]: s[pozo].map((x, j) => (j === i ? { ...x, ...cambios } : x)) }));
  const quitar = (pozo, i) => setSpec((s) => ({ ...s, [pozo]: s[pozo].filter((_, j) => j !== i) }));

  function soltar(pozo, e) {
    e.preventDefault(); setSobre(null);
    try {
      const { tabla, campo } = JSON.parse(e.dataTransfer.getData('application/x-campo'));
      const t = modelo.tablas.find((x) => x.clave === tabla);
      const c = t?.campos.find((x) => x.nombre === campo);
      if (t && c) agregar(pozo, t, c);
    } catch { /* no era un campo */ }
  }

  // Marcar o sacar una relación devuelve el modelo nuevo: la tabla dinámica se recalcula
  // sola (ahora puede unir tablas que antes no).
  const relacionar = useCallback(async (accion, rel) => {
    try {
      setModelo(await accion(nodo.id, { desde: rel.desde, hacia: rel.hacia }));
      setError(null);
    } catch (e) { setError(e.message); }
  }, [nodo]);

  const nombreArchivo = `${(nodo?.label || 'datos').replace(/[^\p{L}\p{N}.-]+/gu, '_')}_tabla_dinamica`;

  async function guardar() {
    if (!onGuardarReporte || !res) return;
    setGuardando(true);
    try {
      await onGuardarReporte({ spec: { ...spec, filtros: spec.filtros.filter((f) => String(f.valor ?? '').trim() !== '') },
        vista: vista === 'modelo' ? 'tabla' : vista, tipo: tipoGrafico });
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] max-h-[90vh] w-[min(1440px,96vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Database className="size-3.5 text-accent" /> Explorar {nodo?.label}</DialogTitle>
          <DialogDescription>
            Arrastrá campos (o hacé clic en uno) a Filas, Columnas, Valores o Filtros. Las tablas se unen solas por sus relaciones. Sólo lectura.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[260px] shrink-0 flex-col hairline-r">
            <div className="flex items-center gap-2 hairline-b px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">
              Campos
              <button type="button" onClick={() => cargarModelo(true)} title="Volver a leer el modelo" className="ml-auto text-ink-dim hover:text-ink">
                <RotateCw className="size-3" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {!modelo && !error && <p className="flex items-center gap-1.5 p-2 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo el modelo…</p>}
              {modelo && (
                <ArbolCampos modelo={modelo} abiertas={abiertas} onAgregar={agregar}
                  onAlternar={(k) => setAbiertas((a) => { const n = new Set(a); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
              )}
              {modelo && (
                <PanelRelaciones modelo={modelo} onAceptar={(r) => relacionar(agregarRelacionModelo, r)}
                  onQuitar={(r) => relacionar(quitarRelacionModelo, r)} onVerModelo={() => setVista('modelo')} />
              )}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="grid shrink-0 grid-cols-2 gap-2 hairline-b p-2.5 xl:grid-cols-4">
              {POZOS.map((p) => (
                <div
                  key={p.id}
                  onDragOver={(e) => { e.preventDefault(); setSobre(p.id); }}
                  onDragLeave={() => setSobre((s) => (s === p.id ? null : s))}
                  onDrop={(e) => soltar(p.id, e)}
                  className={cn('min-h-[58px] rounded-md border border-dashed p-1.5 transition-colors',
                    sobre === p.id ? 'border-accent bg-accent/[0.06]' : 'border-hair-strong')}
                >
                  <p className="mb-1 flex items-center gap-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">
                    <p.icon className="size-3" /> {p.label}
                    {p.id === 'valores' && modelo && (
                      <button type="button" className="ml-auto normal-case tracking-normal text-ink-dim hover:text-ink"
                        onClick={() => setSpec((s) => ({ ...s, valores: [...s.valores, { tabla: (s.filas[0] || s.columnas[0] || { tabla: modelo.tablas[0]?.clave }).tabla, columna: '*', agregacion: 'conteo' }] }))}>
                        + cantidad de filas
                      </button>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {spec[p.id].map((x, i) => (
                      <Ficha key={`${x.tabla}.${x.columna}.${i}`} pozo={p.id} x={x} campo={campos.get(`${x.tabla}.${x.columna}`)}
                        onCambio={(c) => cambiar(p.id, i, c)} onQuitar={() => quitar(p.id, i)} />
                    ))}
                    {!spec[p.id].length && <span className="text-[11px] text-ink-dim/70">soltá un campo acá</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-ink-dim">
              <div className="flex rounded-sm border border-hair p-0.5">
                {[['tabla', 'Tabla', Table2], ['grafico', 'Gráfico', BarChart3], ['modelo', 'Modelo', Network]].map(([id, l, I]) => (
                  <button key={id} type="button" onClick={() => setVista(id)}
                    className={cn('flex items-center gap-1 rounded-xs px-2 py-0.5', vista === id ? 'bg-surface-3 text-ink' : 'hover:text-ink')}>
                    <I className="size-3" /> {l}
                  </button>
                ))}
              </div>
              {vista === 'grafico' && (
                <select className={sel} value={tipoGrafico} onChange={(e) => setTipo(e.target.value)}>
                  {TIPOS_GRAFICO.map((g) => (
                    <option key={g.id} value={g.id} disabled={!!(cruce && motivoNoDisponible(g.id, cruce))}>{g.label}</option>
                  ))}
                </select>
              )}
              {cargando && <Loader2 className="size-3.5 animate-spin" />}
              {res && !cargando && (
                <span>{res.filas.length} filas{res.truncado ? ' (recortado)' : ''} · {res.duracion_ms} ms</span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {cruce && (
                  <Button variant="ghost" size="sm" onClick={() => descargar(`${nombreArchivo}.csv`, aCSV(cruce))}>
                    <Download /> CSV
                  </Button>
                )}
                {cruce && vista === 'grafico' && (
                  <Button variant="ghost" size="sm" onClick={() => {
                    const url = grafico.current?.png();
                    if (url) Object.assign(document.createElement('a'), { href: url, download: `${nombreArchivo}.png` }).click();
                  }}>
                    <ImageIcon /> PNG
                  </Button>
                )}
                {onGuardarReporte && (
                  <Button variant="outline" size="sm" onClick={guardar} disabled={!res || guardando}>
                    {guardando ? <Loader2 className="animate-spin" /> : <Save />} Guardar como reporte
                  </Button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-2.5 pb-2.5">
              {error && <pre className="mb-2 whitespace-pre-wrap rounded-sm border border-danger/30 bg-danger/[0.06] p-2 text-[11.5px] text-danger">{error}</pre>}
              {!listo && !error && vista !== 'modelo' && (
                <div className="grid h-full place-items-center text-center text-[12.5px] text-ink-dim">
                  <p>Elegí qué querés ver: por ejemplo, una fecha en Filas, una categoría en Columnas y un importe en Valores.</p>
                </div>
              )}
              {cruce && vista === 'tabla' && <TablaCruzada cruce={cruce} />}
              {cruce && vista === 'grafico' && <Grafico ref={grafico} tipo={tipoGrafico} cruce={cruce} alto="100%" />}
              {vista === 'modelo' && modelo && (
                <Suspense fallback={<p className="flex items-center gap-1.5 p-2 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Armando el diagrama…</p>}>
                  <ModeloDatos modelo={modelo} onAgregar={(r) => relacionar(agregarRelacionModelo, r)}
                    onQuitar={(r) => relacionar(quitarRelacionModelo, r)} />
                </Suspense>
              )}
            </div>

            {res?.sql && (
              <details className="shrink-0 border-t border-hair px-2.5 py-1.5">
                <summary className="cursor-pointer list-none text-[11px] text-ink-dim hover:text-ink">SQL que se corrió ▸</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-ink-muted">{res.sql}</pre>
              </details>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
