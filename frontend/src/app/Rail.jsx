import React, { useEffect, useState } from 'react';
import {
  Plus, Upload, Terminal, Hash, ChevronDown, MoreHorizontal, Pencil, Trash2, Sparkles, StickyNote, RefreshCw, Loader2,
  History, ChevronRight, Database, Table2, Eye, Calendar, Type, ToggleLeft, Layers,
} from 'lucide-react';
import { hayNombresAutomaticos } from '@/lib/temas';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { renameSection, deleteSection, fetchFuentesDatos, fetchModelo, fetchContenidoSeccion } from '@/lib/api';
import { abrirExplorador } from '@/lib/eventos';
import { pedirClave, avisarClaveIncorrecta } from '@/security.js';
import { Button } from '@/components/ui/button';
import { BotonPanel } from '@/app/PanelLateral';
import { tipoMeta, fuenteLabel, iconoDe, colorFuente, colorTipo, colorSeccion, TODAS, TIPOS } from '@/lib/nodes';
import { cn } from '@/lib/utils';

function Grupo({ titulo, children, accion, plegable = false }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="px-2.5 pt-5">
      <div className="mb-1 flex h-6 items-center justify-between px-1.5">
        <button
          className={cn('flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim', plegable && 'hover:text-ink-muted')}
          onClick={() => plegable && setAbierto((a) => !a)}
          type="button"
        >
          {titulo}
          {plegable && <ChevronDown className={cn('size-3 transition-transform', !abierto && '-rotate-90')} />}
        </button>
        {accion}
      </div>
      {abierto && <div className="mt-0.5 flex flex-col">{children}</div>}
    </div>
  );
}

function Fila({ activa, onClick, icon: Icon, label, count, marca, title, menu, color }) {
  const boton = (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={color ? { '--c': color } : undefined}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[12.5px] transition-colors',
        activa ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {marca}
      {Icon && <Icon className={cn('size-3.5 shrink-0', color ? 'text-cat' : activa ? 'text-accent' : 'text-ink-dim group-hover:text-ink-muted')} />}
      <span className="flex-1 truncate">{label}</span>
      {count != null && <span className={cn('text-[11px] text-ink-dim', menu && 'group-hover/fila:hidden')}>{count}</span>}
    </button>
  );
  if (!menu) return boton;
  return (
    <div className="group/fila relative">
      {boton}
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover/fila:block has-[[data-state=open]]:block">{menu}</div>
    </div>
  );
}

function Check({ on }) {
  return (
    <span
      className={cn(
        'grid size-3 shrink-0 place-items-center rounded-[3px] border transition-colors',
        on ? 'border-accent bg-accent' : 'border-hair-strong group-hover:border-ink-dim',
      )}
    >
      {on && <svg viewBox="0 0 10 10" className="size-2 text-accent-ink"><path d="M2 5.2 4.1 7.2 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}
    </span>
  );
}

// Espejo de SECCIONES_BASE en el backend: no se eliminan aunque estén en cero.
const SECCIONES_BASE = new Set(['personal', 'finanzas', 'maestria']);
const ICONO_CLASE = { numerica: Hash, fecha: Calendar, texto: Type, booleano: ToggleLeft };

/**
 * Lo que tiene una sección por dentro, como el panel de campos de Power BI: sus fuentes
 * de datos → tablas → campos. Clic en una fuente la abre; en una tabla o un campo, la
 * explora (tabla dinámica y gráficos).
 */
function ArbolDatos({ fuentes, onAbrirNodo }) {
  const [abiertas, setAbiertas] = useState(() => new Set());
  const [modelos, setModelos] = useState(() => new Map());
  const alternar = (clave, fn) => setAbiertas((a) => {
    const n = new Set(a);
    if (n.has(clave)) n.delete(clave); else { n.add(clave); fn?.(); }
    return n;
  });
  const cargar = (f) => {
    if (modelos.has(f.id)) return;
    setModelos((m) => new Map(m).set(f.id, 'cargando'));
    fetchModelo(f.id).then((mo) => setModelos((m) => new Map(m).set(f.id, mo)))
      .catch((e) => setModelos((m) => new Map(m).set(f.id, { error: e.message })));
  };
  if (!fuentes.length) {
    return <p className="py-1 pl-9 pr-2 text-[11px] text-ink-dim/80">Sin fuentes de datos (CSV, Excel o una base).</p>;
  }
  const fila = 'flex h-6 w-full items-center gap-1.5 rounded-xs pr-2 text-left text-[11.5px] hover:bg-surface-2';
  return (
    <ul className="pb-1">
      {fuentes.map((f) => {
        const abierta = abiertas.has(f.id);
        const mo = modelos.get(f.id);
        return (
          <li key={f.id}>
            <div className={cn(fila, 'pl-5')}>
              <button type="button" aria-label="Desplegar" onClick={() => alternar(f.id, () => cargar(f))} className="grid size-4 place-items-center text-ink-dim">
                <ChevronRight className={cn('size-3 transition-transform', abierta && 'rotate-90')} />
              </button>
              <Database className="size-3 shrink-0 text-ink-dim" />
              <button type="button" onClick={() => onAbrirNodo?.(f.id, f.seccion)} className="min-w-0 flex-1 truncate text-left text-ink-muted hover:text-ink" title="Abrir la fuente">
                {f.label}
              </button>
            </div>
            {abierta && mo === 'cargando' && <p className="pl-12 text-[11px] text-ink-dim">Leyendo…</p>}
            {abierta && mo?.error && <p className="pl-12 pr-2 text-[11px] text-danger/80">{mo.error}</p>}
            {abierta && mo?.tablas && (
              <ul>
                {mo.tablas.map((t) => {
                  const clave = f.id + ':' + t.clave;
                  const tAbierta = abiertas.has(clave);
                  return (
                    <li key={clave}>
                      <div className={cn(fila, 'pl-9')}>
                        <button type="button" aria-label="Desplegar" onClick={() => alternar(clave)} className="grid size-4 place-items-center text-ink-dim">
                          <ChevronRight className={cn('size-3 transition-transform', tAbierta && 'rotate-90')} />
                        </button>
                        {t.vista ? <Eye className="size-3 shrink-0 text-ink-dim" /> : <Table2 className="size-3 shrink-0 text-ink-dim" />}
                        <button type="button" onClick={() => abrirExplorador(f, t.clave)} className="min-w-0 flex-1 truncate text-left text-ink-muted hover:text-ink" title="Explorar la tabla">
                          {t.clave}
                        </button>
                      </div>
                      {tAbierta && (
                        <ul>
                          {t.campos.map((c) => {
                            const I = ICONO_CLASE[c.clase] || Type;
                            return (
                              <li key={c.nombre}>
                                <button type="button" onClick={() => abrirExplorador(f, t.clave)} className={cn(fila, 'pl-[60px] text-ink-dim hover:text-ink')} title={c.tipo || c.clase}>
                                  <I className="size-3 shrink-0" />
                                  <span className="min-w-0 truncate">{c.nombre}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
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

const POR_TANDA = 60;

/** El grupo de un nodo en el árbol: su tipo si es propio (Notas, Scripts, Reportes),
 *  y si es un documento, su origen (PDF, Word, YouTube…). */
function grupoDe(n) {
  if (n.type && n.type !== 'DOCUMENTO' && TIPOS[n.type]) return TIPOS[n.type].plural;
  return fuenteLabel(n) || 'Otros';
}

/**
 * Lo que tiene una sección por dentro, como el panel de campos de Power BI: sus
 * documentos agrupados por origen y sus fuentes de datos con tablas y campos. Se baja
 * recién al desplegarla y muestra de a tandas, así una sección grande no traba nada.
 */
function ContenidoSeccion({ seccion, fuentes, onAbrirNodo, version }) {
  const [nodos, setNodos] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [cuantos, setCuantos] = useState({});
  useEffect(() => {
    let vivo = true;
    fetchContenidoSeccion(seccion).then((x) => vivo && setNodos(x)).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [seccion, version]);

  if (error) return <p className="py-1 pl-9 pr-2 text-[11px] text-danger/80">{error}</p>;
  if (!nodos) return <p className="flex items-center gap-1.5 py-1 pl-9 text-[11px] text-ink-dim"><Loader2 className="size-3 animate-spin" /> Leyendo…</p>;

  const grupos = new Map();
  for (const n of nodos) {
    if (n.type === 'DATOS') continue;            // van con sus tablas, abajo
    const g = grupoDe(n);
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(n);
  }
  const orden = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!orden.length && !fuentes.length) return <p className="py-1 pl-9 pr-2 text-[11px] text-ink-dim/80">Sección vacía.</p>;

  const fila = 'flex h-6 w-full items-center gap-1.5 rounded-xs pr-2 text-left text-[11.5px] hover:bg-surface-2';
  const alternar = (g) => setAbiertos((a) => { const x = new Set(a); if (x.has(g)) x.delete(g); else x.add(g); return x; });
  const Cabeza = ({ g, n, Icono }) => (
    <button type="button" onClick={() => alternar(g)} className={cn(fila, 'pl-5 text-ink-muted hover:text-ink')}>
      <ChevronRight className={cn('size-3 shrink-0 text-ink-dim transition-transform', abiertos.has(g) && 'rotate-90')} />
      <Icono className="size-3 shrink-0 text-ink-dim" />
      <span className="min-w-0 flex-1 truncate">{g}</span>
      <span className="text-[10.5px] tabular-nums text-ink-dim">{n}</span>
    </button>
  );
  return (
    <ul className="pb-1">
      {fuentes.length > 0 && (
        <li>
          <Cabeza g="Datos" n={fuentes.length} Icono={Database} />
          {abiertos.has('Datos') && <div className="pl-4"><ArbolDatos fuentes={fuentes} onAbrirNodo={onAbrirNodo} /></div>}
        </li>
      )}
      {orden.map(([g, lista]) => {
        const max = cuantos[g] || POR_TANDA;
        return (
          <li key={g}>
            <Cabeza g={g} n={lista.length} Icono={iconoDe(lista[0])} />
            {abiertos.has(g) && (
              <ul>
                {lista.slice(0, max).map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => onAbrirNodo?.(n.id, seccion)} title={n.label}
                      className={cn(fila, 'pl-[38px] text-ink-dim hover:text-ink')}>
                      <span className="min-w-0 truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
                {lista.length > max && (
                  <li>
                    <button type="button" onClick={() => setCuantos((c) => ({ ...c, [g]: max + POR_TANDA }))}
                      className={cn(fila, 'pl-[38px] text-accent/80 hover:text-accent')}>
                      Ver {Math.min(POR_TANDA, lista.length - max)} más de {lista.length - max}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function Rail({
  sections, seccion, onSeccion, onNuevaSeccion,
  facetas, tipos, onToggleTipo, fuentes, onToggleFuente,
  topConceptos, conceptos, onToggleConcepto,
  temas, temasSel, onToggleTema, onNombrarTemas, onReagrupar, reagrupando = false,
  onIngest, onCorridas, onPapelera, papeleraCount = 0, onNuevaNota, onNuevoScript, onSeccionesCambiadas, onSeccionEliminada, ancho = 272,
  onCollapse, onAbrirNodo,
}) {
  // Fuentes de datos de todas las secciones, para desplegarlas bajo cada una.
  const [fuentesDatos, setFuentesDatos] = useState([]);
  const [desplegadas, setDesplegadas] = useState(() => new Set());
  const firmaSecciones = sections.map((s) => s.nombre + ':' + s.count).join('|');
  useEffect(() => { fetchFuentesDatos().then(setFuentesDatos).catch(() => {}); }, [firmaSecciones]);

  async function renombrar(nombre) {
    const nuevo = (window.prompt(`Nuevo nombre para «${nombre}»:`, nombre) || '').trim().toLowerCase();
    if (!nuevo || nuevo === nombre) return;
    const clave = await pedirClave(`renombrar «${nombre}»`);
    if (!clave) return;
    const r = await renameSection(nombre, nuevo, clave.password).catch(() => null);
    if (r?.status === 403) { avisarClaveIncorrecta(); return; }
    if (!r?.ok) { window.alert('No se pudo renombrar la sección.'); return; }
    onSeccionesCambiadas(nombre === seccion ? nuevo : seccion);
  }

  async function eliminar(nombre, count) {
    // Una sección vacía es un rótulo: borrarla no destruye nada y no pide la clave.
    // Con documentos adentro, el menú ni siquiera deja llegar hasta acá.
    if (count > 0) return;
    if (!window.confirm(`Se elimina la sección «${nombre}». No borra nodos (está vacía).`)) return;
    const r = await deleteSection(nombre).catch(() => null);
    if (!r?.ok) { window.alert('No se pudo eliminar la sección.'); return; }
    onSeccionEliminada?.(nombre);
    const otra = sections.find((s) => s.nombre !== nombre)?.nombre || 'personal';
    onSeccionesCambiadas(nombre === seccion ? otra : seccion);
  }

  const nuevaSeccion = () => {
    const nombre = (window.prompt('Nombre de la nueva sección (silo aparte):') || '').trim().toLowerCase();
    if (!nombre) return;
    if (onNuevaSeccion) onNuevaSeccion(nombre);
    else onSeccion(nombre);
  };

  const tiposOrden = [...facetas.tipo.entries()].sort((a, b) => b[1] - a[1]);
  const fuentesOrden = [...facetas.fuente.entries()].sort((a, b) => b[1] - a[1]);
  const seccionesVista = sections;
  const total = sections.reduce((n, s) => n + (s.count || 0), 0);

  return (
    <aside className="flex shrink-0 flex-col hairline-r bg-surface" style={{ width: ancho }}>
      {/* Misma altura que la barra de la biblioteca (h-11): las líneas de las
          cabeceras quedan a la misma altura en las tres columnas. */}
      <div className="flex h-11 shrink-0 items-center gap-2 hairline-b pl-2 pr-2.5">
        {onCollapse && (
          <BotonPanel lado="izquierda" texto="Ocultar barra lateral" atajo="[" onClick={onCollapse} />
        )}
        <Button variant="default" size="lg" className="flex-1 glow-sel" onClick={onIngest}>
          <Upload /> Ingestar
        </Button>
        {/* Crear a mano: una nota o un script (los dos quedan como nodos de la sección). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" className="flex-1">
              <Plus /> Nuevo <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onNuevaNota}><StickyNote /> Nota</DropdownMenuItem>
            <DropdownMenuItem onSelect={onNuevoScript}><Terminal /> Script de Python</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Grupo
          titulo="Secciones"
          accion={
            <button onClick={nuevaSeccion} className="grid size-5 place-items-center rounded-xs text-ink-dim hover:bg-surface-2 hover:text-ink" title="Nueva sección" type="button">
              <Plus className="size-3.5" />
            </button>
          }
        >
          <Fila
            activa={seccion === TODAS}
            onClick={() => onSeccion(TODAS)}
            label="Todas las secciones"
            count={total}
            title="La biblioteca entera en una sola vista"
            marca={<Layers className={cn('size-3 shrink-0', seccion === TODAS ? 'text-accent' : 'text-ink-dim')} />}
          />
          {seccionesVista.map((s, i) => (
            <div key={s.nombre} className="relative pl-3.5">
            <button
              type="button"
              aria-label={(desplegadas.has(s.nombre) ? 'Plegar ' : 'Desplegar ') + s.nombre}
              title="Ver lo que tiene: documentos por origen, fuentes de datos, tablas y campos"
              onClick={() => setDesplegadas((d) => { const x = new Set(d); if (x.has(s.nombre)) x.delete(s.nombre); else x.add(s.nombre); return x; })}
              className="absolute left-0 top-2 z-[1] grid size-4 place-items-center rounded-xs text-ink-dim/70 hover:text-ink"
            >
              <ChevronRight className={cn('size-3 transition-transform', desplegadas.has(s.nombre) && 'rotate-90')} />
            </button>
            <Fila
              key={s.nombre}
              activa={s.nombre === seccion}
              onClick={() => onSeccion(s.nombre)}
              label={<span className="capitalize">{s.nombre}</span>}
              count={s.count}
              marca={(
                <span
                  className={cn('size-2 shrink-0 rounded-[3px] dot-cat transition-opacity', s.nombre === seccion ? 'opacity-100' : 'opacity-45')}
                  style={{ '--c': colorSeccion(i) }}
                />
              )}
              menu={(
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Opciones de ${s.nombre}`} className="grid size-5 place-items-center rounded-xs text-ink-dim hover:bg-surface-3 hover:text-ink">
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <DropdownMenuItem onSelect={() => renombrar(s.nombre)}><Pencil /> Renombrar</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Eliminar sólo lo que no destruye nada: sección propia y vacía.
                        El item queda visible pero deshabilitado y diciendo por qué, en
                        vez de desaparecer y dejar pensando que la opción no existe. */}
                    <DropdownMenuItem
                      disabled={SECCIONES_BASE.has(s.nombre) || s.count > 0}
                      title={SECCIONES_BASE.has(s.nombre) ? 'Sección base'
                        : s.count > 0 ? 'Mové o borrá los nodos primero' : undefined}
                      onSelect={() => eliminar(s.nombre, s.count)}
                      className="text-danger [&_svg]:text-danger"
                    >
                      <Trash2 /> Eliminar sección
                    </DropdownMenuItem>
                    {(SECCIONES_BASE.has(s.nombre) || s.count > 0) && (
                      <div className="px-2 pb-1 text-[10.5px] text-ink-dim">
                        {SECCIONES_BASE.has(s.nombre) ? 'Sección base' : 'Mové o borrá los nodos primero'}
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            />
            {desplegadas.has(s.nombre) && (
              <ContenidoSeccion seccion={s.nombre} version={s.count}
                fuentes={fuentesDatos.filter((f) => f.seccion === s.nombre)} onAbrirNodo={onAbrirNodo} />
            )}
            </div>
          ))}
        </Grupo>

        {temas.size > 0 && (
          <Grupo
            titulo="Temas"
            plegable
            accion={(
              <span className="flex items-center gap-0.5">
                {onReagrupar && (
                  <button
                    type="button"
                    onClick={onReagrupar}
                    disabled={reagrupando}
                    title="Rehacer los temas de cada sección desde cero. Las ingestas sólo suman lo nuevo al tema más cercano, para que los temas no cambien a cada rato."
                    className="flex items-center gap-1 rounded-xs px-1 text-[10.5px] text-ink-dim hover:bg-surface-2 hover:text-accent disabled:opacity-60"
                  >
                    {reagrupando ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Reagrupar
                  </button>
                )}
                {hayNombresAutomaticos(temas) && (
                  <button
                    type="button"
                    onClick={onNombrarTemas}
                    title="Los nombres automáticos salen de los conceptos de cada cluster. Podés pedirle al LLM una taxonomía legible."
                    className="flex items-center gap-1 rounded-xs px-1 text-[10.5px] text-ink-dim hover:bg-surface-2 hover:text-accent"
                  >
                    <Sparkles className="size-3" /> Nombrar con IA
                  </button>
                )}
              </span>
            )}
          >
            {[...temas.values()].sort((a, b) => (a.key === 'sin-tema') - (b.key === 'sin-tema') || b.count - a.count).map((t) => (
              <Fila
                key={t.key}
                activa={temasSel.has(t.key)}
                onClick={() => onToggleTema(t.key)}
                marca={<Check on={temasSel.has(t.key)} />}
                label={(
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full dot-cat" style={{ '--c': t.color }} />
                    <span className="truncate">{t.nombre}</span>
                  </span>
                )}
                count={t.count}
                title={t.auto ? `${t.nombre} — nombre automático (conceptos del cluster)` : t.nombre}
              />
            ))}
          </Grupo>
        )}

        {tiposOrden.length > 1 && (
          <Grupo titulo="Tipo" plegable>
            {tiposOrden.map(([t, n]) => (
              <Fila
                key={t}
                activa={tipos.has(t)}
                onClick={() => onToggleTipo(t)}
                marca={<Check on={tipos.has(t)} />}
                icon={tipoMeta(t).icon}
                color={colorTipo(t)}
                label={tipoMeta(t).plural}
                count={n}
              />
            ))}
          </Grupo>
        )}

        {fuentesOrden.length > 0 && (
          <Grupo titulo="Origen" plegable>
            {fuentesOrden.map(([f, n]) => (
              <Fila
                key={f}
                activa={fuentes.has(f)}
                onClick={() => onToggleFuente(f)}
                marca={<Check on={fuentes.has(f)} />}
                icon={iconoDe({ fuente: f })}
                color={colorFuente(f)}
                label={f === 'sin-origen' ? 'Sin origen' : fuenteLabel({ fuente: f })}
                count={n}
              />
            ))}
          </Grupo>
        )}

        {topConceptos.length > 0 && (
          <Grupo titulo="Conceptos" plegable>
            {topConceptos.map((c) => (
              <Fila
                key={c.key}
                activa={conceptos.has(c.key)}
                onClick={() => onToggleConcepto(c.key)}
                icon={Hash}
                label={c.label}
                count={c.count}
                title={`Filtrar por «${c.label}»`}
              />
            ))}
          </Grupo>
        )}
      </nav>

      {/* Corridas: el log de lo que se corrió y consultó. Scripts y datos son nodos (filtro
          Tipo); se corren y consultan desde su inspector. */}
      <button
        type="button"
        onClick={onCorridas}
        className="flex h-8 shrink-0 items-center gap-1.5 border-t border-hair px-3 text-[11.5px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
        title="Corridas: cada script que se corrió y cada consulta, con su salida"
      >
        <History className="size-3" /> Corridas
        <span className="text-ink-dim/70">· lo que se corrió y consultó</span>
      </button>
      {/* Papelera: lo que se sacó de la biblioteca, para restaurarlo o borrarlo del todo. */}
      <button
        type="button"
        onClick={onPapelera}
        className="flex h-8 shrink-0 items-center gap-1.5 border-t border-hair px-3 text-[11.5px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
        title="Papelera: restaurar o eliminar definitivamente"
      >
        <Trash2 className="size-3" /> Papelera
        {papeleraCount > 0 && <span className="ml-auto text-[11px] tabular-nums text-ink-dim">{papeleraCount}</span>}
      </button>

    </aside>
  );
}
