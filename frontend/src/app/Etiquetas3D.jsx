import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tarjeta, Chip } from '@/app/PiezasNodo';

/**
 * Capa HTML del 3D. Cada pieza (tarjeta o chip, ver PiezasNodo) vive dentro de un
 * CSS2DObject que three.js ubica sobre su nodo en cada frame; Graph3DView decide
 * cuáles y dónde (lib/detalle) y acá sólo se monta el contenido.
 *
 * Nada de esto recibe el mouse: hover y clic los resuelve el raycast del lienzo
 * contra un hit-box invisible del mismo tamaño, así la rueda y el arrastre siguen
 * orbitando aunque el cursor esté sobre una tarjeta.
 *
 * La API es imperativa para que mover la cámara no re-renderice la vista entera:
 * sólo cambia esta capa, y sólo cuando cambia el conjunto de piezas.
 */
const Etiquetas3D = forwardRef(function Etiquetas3D(_, ref) {
  const [items, setItems] = useState([]);
  const [hoverId, setHoverId] = useState(null);
  useImperativeHandle(ref, () => ({ mostrar: setItems, resaltar: setHoverId }), []);

  return items.map((it) => createPortal(
    it.tipo === 'tarjeta'
      ? <Tarjeta node={it.node} estado={it.estado} color={it.color} grande={it.grande} marcado={it.marcado} hover={hoverId === it.id} />
      : <Chip node={it.node} estado={it.estado} medida={it.medida} marcado={it.marcado} hover={hoverId === it.id} />,
    it.el,
    it.clave,
  ));
});

export default Etiquetas3D;
