import React, { useEffect, useState } from 'react';
import { Play, Loader2, Database, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { consultarDatos, fetchEsquema } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Nombre de tabla listo para el SQL: con su esquema si no es `public`. */
function refTabla(t) {
  if (!t) return 'datos';
  return t.esquema && t.esquema !== 'public' ? `"${t.esquema}"."${t.tabla}"` : `"${t.tabla}"`;
}

/**
 * Consulta SQL de sólo lectura sobre un nodo de datos, en el lugar.
 * - CSV/Excel: la hoja se consulta como tabla `datos` (SQLite en memoria; no toca el
 *   archivo), así que corre directo.
 * - Base real (SQLite o Postgres): el backend la abre en sólo lectura y primero
 *   propone; al confirmar, la consulta queda en Corridas.
 * Ctrl/⌘ + Enter corre la consulta.
 */
export default function ConsultaDatos({ node }) {
  const [esquema, setEsquema] = useState(null);
  const [sql, setSql] = useState('');
  const [res, setRes] = useState(null);
  const [propuesta, setPropuesta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    setEsquema(null); setRes(null); setPropuesta(null); setError(null);
    fetchEsquema(node.id)
      .then((e) => {
        if (!vivo) return;
        setEsquema(e);
        setSql(`SELECT * FROM ${refTabla(e.tablas?.[0])} LIMIT 50`);
      })
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [node.id]);

  async function correr(confirm = false) {
    setCargando(true); setError(null);
    try {
      const r = await consultarDatos(node.id, { sql, confirm });
      if (r.needs_confirmation) { setPropuesta(r); return; }
      setPropuesta(null);
      setRes(r);
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
      {esquema?.tablas?.length > 0 && (
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
          sólo lectura · {real ? 'base real: pide confirmar y queda en Corridas' : 'la hoja es la tabla «datos»'} · Ctrl+Enter
        </span>
      </div>

      {propuesta && (
        <div className="rounded-md border border-accent/40 bg-accent/[0.06] p-2.5">
          <p className="flex items-start gap-1.5 text-[12.5px] text-ink">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-accent" /> ¿Consultar <b>{propuesta.archivo}</b>?
          </p>
          <ol className="mt-1.5 list-decimal pl-5 text-[11.5px] leading-relaxed text-ink-muted">
            {propuesta.plan.map((p) => <li key={p}>{p}</li>)}
          </ol>
          <div className="mt-2 flex gap-1.5">
            <Button variant="default" size="sm" onClick={() => correr(true)} disabled={cargando}><Play /> Confirmar y consultar</Button>
            <Button variant="ghost" size="sm" onClick={() => setPropuesta(null)}>Cancelar</Button>
          </div>
        </div>
      )}

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
          <p className="text-[11px] text-ink-dim">
            {res.filas.length} {res.filas.length === 1 ? 'fila' : 'filas'}{res.truncado ? ' (hay más: sumá un LIMIT o filtrá)' : ''} · {res.ms} ms
            {res.parcial ? ' · la hoja es grande: se consultaron las primeras 50.000 filas' : ''}
          </p>
        </>
      )}
    </div>
  );
}
