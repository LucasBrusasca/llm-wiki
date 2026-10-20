import assert from 'node:assert/strict';
import { fechaNodo, idsHasta, nodoHasta, rangoFechas } from '../frontend/src/lib/timeline.js';

const nodes = [
  { id: 'a', known_since: '2024-01-01T00:00:00Z' },
  { id: 'b', creado: '2024-06-01T00:00:00Z' },
  { id: 'c', created_at: '2024-12-01T00:00:00Z' },
  { id: 'd' },
];
const ids = new Set(['a', 'b', 'c', 'd']);

assert.equal(fechaNodo(nodes[1]), '2024-06-01T00:00:00Z');
assert.equal(nodoHasta(nodes[0], '2024-03-01T00:00:00Z'), true);
assert.equal(nodoHasta(nodes[1], '2024-03-01T00:00:00Z'), false);
assert.equal(nodoHasta(nodes[3], '2024-03-01T00:00:00Z'), true);

const corte = idsHasta(ids, nodes, '2024-03-01T00:00:00Z');
assert.deepEqual([...corte].sort(), ['a', 'd']);
assert.equal(idsHasta(ids, nodes, null).size, 4);

const r = rangoFechas(nodes);
assert.ok(r.max > r.min);

console.log('timeline.js ok');
