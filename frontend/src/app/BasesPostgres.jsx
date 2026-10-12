import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Database, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchConexiones } from '@/lib/api';

/**
 * Bases Postgres configuradas en el backend (ALGEDI_PG_<NOMBRE> en el entorno). Acá
 * sólo se ven nombre, host, base y usuario; la clave nunca llega al navegador.
 * «Agregar al grafo» lee el esquema y crea el nodo de datos; se consulta desde su
 * inspector, en sólo lectura. Vive en «Ingestar»: sumar una base es sumar una fuente.
 */
export default function BasesPostgres({ open, seccion, onAgregar, onAbrir }) {
  const [conexiones, setConexiones] = useState(null);
  const [agregando, setAgregando] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    fetchConexiones(seccion)
      .then((c) => vivo && setConexiones(c))
      .catch(() => vivo && setConexiones([]));
    return () => { vivo = false; };
  }, [open, seccion]);

  async function agregar(nombre) {
    setAgregando(nombre); setError(null);
    try {
      await onAgregar(nombre);
    } catch (e) {
      setError(e.message);
    } finally {
      setAgregando(null);
    }
  }

  return (
    <>
      <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">
        <Server className="size-3" /> Bases Postgres
      </h3>
      {conexiones === null ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo…</p>
      ) : conexiones.length ? (
        <ul className="-mx-2 flex flex-col">
          {conexiones.map((c) => (
            <li key={c.nombre} className="flex items-center gap-2.5 rounded-sm px-2 py-1.5">
              <Database className="size-3.5 shrink-0 text-ink-dim" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[12.5px]">
                  <span className="truncate text-ink">{c.base}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">{c.nombre}</span>
                </span>
                <span className="block truncate text-[11px] text-ink-dim">{c.usuario} @ {c.host}:{c.puerto}</span>
              </span>
              {c.node_id ? (
                <Button variant="ghost" size="sm" onClick={() => onAbrir(c.node_id)}>Abrir</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => agregar(c.nombre)} disabled={agregando !== null}>
                  {agregando === c.nombre ? <Loader2 className="animate-spin" /> : <Plus />} Agregar al grafo
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-dim">Ninguna configurada.</p>
      )}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
        Se consultan en sólo lectura. Para sumar otra, agregá al archivo .env una línea{' '}
        <code className="font-mono text-[10.5px] text-ink-muted">ALGEDI_PG_NOMBRE=postgresql://usuario:clave@host:5432/base</code>{' '}
        y corré <code className="font-mono text-[10.5px] text-ink-muted">docker compose up -d backend</code>. Conviene un usuario que sólo pueda leer.
      </p>
    </>
  );
}

