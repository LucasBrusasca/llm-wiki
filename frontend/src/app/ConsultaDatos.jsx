import React, { useEffect, useState } from 'react';
import {
  Play, Loader2, Database, ChevronRight, Table2, Eye, Hash, Calendar, Type, ToggleLeft, KeyRound, Link2,
  BarChart3, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { consultarDatos, fetchEsquema, fetchModelo } from '@/lib/api';
import { abrirExplorador } from '@/lib/eventos';
import { descargar } from '@/lib/pivot';
import { cn } from '@/lib/utils';

const ICONO_CLASE = { numerica: Hash, fecha: Calendar, texto: Type, booleano: ToggleLeft };

/** El navegador de la fuente, como en DBeaver: tablas que se despliegan en sus campos
 *  (tipo, clave primaria, a qué tabla apuntan). Clic en la tabla: la consulta. */
function Navegador({ modelo, node, onConsultar }) {
  const [abiertas, setAbiertas] = useState(() => new Set());
  const alternar = (k) => setAbiertas((a) => { const n = new Set(a); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <ul className="flex flex-col rounded-md border border-hair py-0.5">
      {modelo.tablas.map((t) => {
        const abierta = abiertas.has(t.clave);
        return (
          <li key={t.clave}>
            <div className="group flex items-center gap-1 px-1.5 py-0.5 text-[12px] hover:bg-surface-2">
              <button type="button" onClick={() => alternar(t.clave)} aria-label={abierta ? 'Plegar' : 'Desplegar'}
                className="grid size-4 place-items-center text-ink-dim">
                <ChevronRight className={cn('size-3 transition-transform', abierta && 'rotate-90')} />
              </button>
              {t.vista ? <Eye className="size-3.5 shrink-0 text-ink-dim" /> : <Table2 className="size-3.5 shrink-0 text-ink-dim" />}
              <button type="button" onClick={() => onConsultar(t)} title="Consultar las primeras 50 filas"
                className="min-w-0 flex-1 truncate text-left text-ink hover:underline">{t.clave}</button>
              {t.filas_aprox != null && <span className="text-[10.5px] tabular-nums text-ink-dim">{t.filas_aprox} filas</span>}
              <button type="button" onClick={() => abrirExplorador(node, t.clave)} title="Explorar: tabla dinámica y gráficos"
                className="grid size-5 place-items-center rounded-xs text-ink-dim opacity-0 hover:bg-surface-3 hover:text-ink group-hover:opacity-100">
                <BarChart3 className="size-3" />
              </button>
            </div>
            {abierta && (
              <ul className="mb-1 ml-6 border-l border-hair pl-1.5">
                {t.campos.map((c) => {
                  const Icon = ICONO_CLASE[c.clase] || Type;
                  return (
                    <li key={c.nombre} className="flex items-center gap-1.5 py-px text-[11.5px] text-ink-muted">
                      <Icon className="size-3 shrink-0 text-ink-dim" />
                      <span className="min-w-0 truncate">{c.nombre}</span>
                      {c.tipo && <span className="shrink-0 font-mono text-[10px] text-ink-dim">{c.tipo}</span>}
                      {c.pk && <KeyRound className="size-3 shrink-0 text-warn/80" title="clave primaria" />}
                      {c.ref && <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-ink-dim"><Link2 className="size-3" />{c.ref.tabla}.{c.ref.columna}</span>}
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

/** Nombre de tabla listo para el SQL: con su esquema si no es `public`. */
function refTabla(t) {
  if (!t) return 'datos';
  return t.esquema && t.esquema !== 'public' ? `"${t.esquema}"."${t.tabla}"` : `"${t.tabla}"`;
}

/**
 * Consulta SQL de sólo lectura sobre un nodo de datos, en el lugar.
 * - CSV/Excel: la hoja se consulta como tabla `datos` (SQLite en memoria; no toca el
 *   archivo), así que corre directo.
 * - Base real (SQLite o Postgres): el backend la abre en sólo lectura (la base rechaza
 *   cualquier escritura), con 5 s y un tope de filas, y la deja en Corridas. Corre
 *   directo: confirmar algo que la base no deja escribir era sólo un clic de más.
 * Ctrl/⌘ + Enter corre la consulta.
 */
export default function ConsultaDatos({ node }) {
  const [esquema, setEsquema] = useState(null);
  const [modelo, setModelo] = useState(null);
  const [sql, setSql] = useState('');
  const [res, setRes] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    setEsquema(null); setModelo(null); setRes(null); setError(null);
    fetchModelo(node.id).then((m) => vivo && setModelo(m)).catch(() => {});
    fetchEsquema(node.id)
      .then((e) => {
        if (!vivo) return;
        setEsquema(e);
        setSql(`SELECT * FROM ${refTabla(e.tablas?.[0])} LIMIT 50`);
      })
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [node.id]);

  async function correr() {
    setCargando(true); setError(null);
    try {
      setRes(await consultarDatos(node.id, { sql }));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  const real = esquema?.motor === 'sqlite' || esquema?.motor === 'postgres';
  const cx = esquema?.conexion;

  return (
    <div className="flex flex-col gap-2">
      {cx && (
        <p className="text-[11px] text-ink-dim">
          Postgres · <span className="text-ink-muted">{cx.base}</span> en {cx.host}:{cx.puerto} como{' '}
          <span className="font-mono text-[10.5px]">{cx.usuario}</span> (conexión «{cx.nombre}»)
        </p>
      )}
      {modelo?.tablas?.length > 0 ? (
        <Navegador modelo={modelo} node={node} onConsultar={(t) => {
          const sqlT = `SELECT * FROM ${refTabla(t)} LIMIT 50`;
          setSql(sqlT);
          setCargando(true); setError(null);
          consultarDatos(node.id, { sql: sqlT }).then(setRes).catch((e) => setError(e.message)).finally(() => setCargando(false));
        }} />
      ) : (
        esquema?.tablas?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11px] text-ink-dim">
          <Database className="size-3.5" />
          {esquema.tablas.map((t) => (
            <button
              type="button"
              key={`${t.esquema || ''}.${t.tabla}`}
              onClick={() => setSql(`SELECT * FROM ${refTabla(t)} LIMIT 50`)}
              className="rounded-xs border border-hair bg-surface-2 px-1.5 hover:border-hair-strong hover:text-ink-muted"
              title={`${t.columnas.join(', ')}${t.vista ? ' · vista' : ''}${t.filas_aprox != null ? ` · ~${t.filas_aprox} filas` : ''}`}
            >
              <span className="text-ink-muted">{t.esquema && t.esquema !== 'public' ? `${t.esquema}.` : ''}{t.tabla}</span> ({t.columnas.length})
            </button>
          ))}
          {esquema.total_filas != null && <span>{esquema.total_filas} filas</span>}
        </div>
        )
      )}

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); correr(); } }}
        spellCheck={false}
        rows={3}
        className="resize-y rounded-md border border-hair bg-surface-2 p-2 font-mono text-[12px] leading-[18px] text-ink focus:border-accent/60 focus:outline-none"
        aria-label="Consulta SQL"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => correr()} disabled={cargando || !sql.trim()}>
          {cargando ? <Loader2 className="animate-spin" /> : <Play />} Consultar
        </Button>
        <span className="text-[11px] text-ink-dim">
          sólo lectura · {real ? 'hasta 5 s y 200 filas · queda en Corridas' : 'la hoja es la tabla «datos»'} · Ctrl+Enter
        </span>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      {res && (
        <>
          <div className="max-h-[360px] overflow-auto rounded-md border border-hair">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  {res.columnas.map((c, i) => (
                    <th key={`${c}-${i}`} className="hairline-b whitespace-nowrap px-2 py-1.5 text-left font-medium text-ink">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.filas.map((f, i) => (
                  <tr key={i} className={cn(i % 2 && 'bg-surface-2/40')}>
                    {f.map((v, j) => (
                      <td key={j} className={cn('max-w-[220px] truncate px-2 py-1 text-ink-muted', typeof v === 'number' && 'text-right tabular-nums')} title={String(v)}>
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-dim">
            <span>
              {res.filas.length} {res.filas.length === 1 ? 'fila' : 'filas'}{res.truncado ? ' (hay más: sumá un LIMIT o filtrá)' : ''} · {res.ms} ms
              {res.parcial ? ' · la hoja es grande: se consultaron las primeras 50.000 filas' : ''}
            </span>
            <button
              type="button"
              className="ml-auto flex items-center gap-1 hover:text-ink"
              onClick={() => {
                const esc = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
                const csv = [res.columnas, ...res.filas].map((f) => f.map(esc).join(',')).join('\n');
                descargar(`${(node.label || 'consulta').replace(/[^\p{L}\p{N}.-]+/gu, '_')}.csv`, csv);
              }}
            >
              <Download className="size-3" /> Exportar CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
