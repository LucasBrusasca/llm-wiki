import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Fecha corta y legible: "12 sep 2024". Sin librería de fechas. */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fechaCorta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Normaliza para buscar: sin acentos, minúsculas. "Introducción" matchea "introduccion". */
export function normalizar(texto) {
  return (texto || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function truncar(texto, max) {
  const t = (texto || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function pct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}
