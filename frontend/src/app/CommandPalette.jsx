import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Terminal, MessageSquare, List, Columns2, Share2, Orbit, Layers, Sparkles, PanelRight } from 'lucide-react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command';
import { iconoDe, fuenteLabel } from '@/lib/nodes';
import { searchSemantic } from '@/lib/api';
import { normalizar } from '@/lib/utils';

const ACCIONES = [
  { id: 'ingest', label: 'Ingestar documentos', icon: Upload },
  { id: 'scripts', label: 'Abrir scripts', icon: Terminal },
  { id: 'agent', label: 'Preguntar al agente', icon: MessageSquare },
  { id: 'lista', label: 'Vista: Lista', icon: List },
  { id: 'split', label: 'Vista: Split', icon: Columns2 },
  { id: 'grafo', label: 'Vista: Grafo', icon: Share2 },
  { id: '3d', label: 'Vista: Explorar 3D', icon: Orbit },
];

export default function CommandPalette({
  open, onOpenChange, nodes, haystack, sections, seccion, onSelect, onSeccion, onAction,
  inspectorAbierto = true, autoAbrir = false,
}) {
  const [q, setQ] = useState('');
  const [sem, setSem] = useState([]);

  useEffect(() => { if (!open) { setQ(''); setSem([]); } }, [open]);

  const terms = useMemo(() => normalizar(q.trim()).split(/\s+/).filter(Boolean), [q]);

  const docs = useMemo(() => {
    if (!terms.length) return nodes.slice(0, 8);
    return nodes.filter((n) => {
      const h = haystack.get(n.id) || '';
      return terms.every((t) => h.includes(t));
    }).slice(0, 30);
  }, [nodes, haystack, terms]);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 3) { setSem([]); return undefined; }
    const t = setTimeout(() => {
      searchSemantic(texto, 12).then((ids) => {
        const ya = new Set(docs.map((d) => d.id));
        const porId = new Map(nodes.map((n) => [n.id, n]));
        setSem(ids.filter((id) => !ya.has(id) && porId.has(id)).map((id) => porId.get(id)).slice(0, 8));
      }).catch(() => setSem([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, docs, nodes]);

  // Acciones que dependen del estado actual del panel derecho.
  const ACCIONES_PANEL = [
    { id: 'inspector', label: inspectorAbierto ? 'Ocultar panel derecho' : 'Mostrar panel derecho', icon: PanelRight },
    {
      id: 'auto-inspector',
      label: autoAbrir
        ? 'Panel derecho: dejar de abrirlo al elegir un documento'
        : 'Panel derecho: abrirlo al elegir un documento',
      icon: PanelRight,
    },
  ];
  const acciones = [...ACCIONES, ...ACCIONES_PANEL].filter((a) => !terms.length || terms.every((t) => normalizar(a.label).includes(t)));
  const secciones = sections.filter((s) => s.nombre !== seccion
    && (!terms.length || terms.every((t) => normalizar(s.nombre).includes(t))));

  const fila = (n, icono) => {
    const Icon = icono || iconoDe(n);
    return (
      <CommandItem key={n.id} value={`doc:${n.id}`} onSelect={() => onSelect(n.id)}>
        <Icon />
        <span className="flex-1 truncate">{n.label}</span>
        <span className="text-[11px] text-ink-dim">{[fuenteLabel(n), n.autor].filter(Boolean).join(' · ')}</span>
      </CommandItem>
    );
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput value={q} onValueChange={setQ} placeholder={`Buscar en «${seccion}», cambiar de sección o ejecutar una acción…`} />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {docs.length > 0 && (
          <CommandGroup heading={terms.length ? 'Documentos' : 'Recientes en la sección'}>
            {docs.map((n) => fila(n))}
          </CommandGroup>
        )}
        {sem.length > 0 && (
          <CommandGroup heading="Por significado">
            {sem.map((n) => fila(n, Sparkles))}
          </CommandGroup>
        )}
        {secciones.length > 0 && (
          <CommandGroup heading="Secciones">
            {secciones.map((s) => (
              <CommandItem key={s.nombre} value={`sec:${s.nombre}`} onSelect={() => onSeccion(s.nombre)}>
                <Layers />
                <span className="flex-1 capitalize">{s.nombre}</span>
                <span className="text-[11px] text-ink-dim">{s.count}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {acciones.length > 0 && (
          <CommandGroup heading="Acciones">
            {acciones.map((a) => (
              <CommandItem key={a.id} value={`act:${a.id}`} onSelect={() => onAction(a.id)}>
                <a.icon />
                <span>{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
