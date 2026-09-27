-- Base de prueba para el Workbench de Algedi: ventas de un almacén inventado.
--
-- La corre sola la imagen de Postgres la primera vez que se levanta el servicio
-- demo-db (docker compose --profile demo up -d demo-db), ya conectada a algedi_demo.
-- Los datos son ficticios y reproducibles (setseed): siempre salen los mismos.
--
-- Algedi entra con algedi_lector, que sólo puede leer (ALGEDI_PG_DEMO en
-- docker-compose.yml). Probá desde el Workbench, por ejemplo:
--   SELECT * FROM ventas_por_mes ORDER BY mes;
--   SELECT p.categoria, sum(v.cantidad * v.precio_unitario) AS facturado
--     FROM ventas v JOIN productos p ON p.id = v.producto_id
--    GROUP BY 1 ORDER BY 2 DESC;

CREATE TABLE productos (
    id        serial PRIMARY KEY,
    nombre    text NOT NULL,
    categoria text NOT NULL,
    precio    numeric(10, 2) NOT NULL CHECK (precio > 0)   -- precio de lista a enero 2025
);

CREATE TABLE clientes (
    id        serial PRIMARY KEY,
    nombre    text NOT NULL,
    ciudad    text NOT NULL,
    provincia text NOT NULL,
    segmento  text NOT NULL,
    alta      date NOT NULL
);

CREATE TABLE ventas (
    id              serial PRIMARY KEY,
    fecha           date NOT NULL,
    cliente_id      integer NOT NULL REFERENCES clientes (id),
    producto_id     integer NOT NULL REFERENCES productos (id),
    cantidad        integer NOT NULL CHECK (cantidad > 0),
    precio_unitario numeric(10, 2) NOT NULL                  -- con la inflación del mes
);

INSERT INTO productos (nombre, categoria, precio) VALUES
    ('Yerba mate 1 kg',          'Almacén',     4200),
    ('Café molido 500 g',        'Almacén',     6900),
    ('Dulce de leche 400 g',     'Almacén',     2300),
    ('Alfajores x 12',           'Almacén',     5400),
    ('Aceite de girasol 1,5 L',  'Almacén',     3100),
    ('Fideos secos 500 g',       'Almacén',     1400),
    ('Mate de calabaza',         'Bazar',       8500),
    ('Termo de acero 1 L',       'Bazar',      32000),
    ('Bombilla de alpaca',       'Bazar',       6200),
    ('Taza de cerámica',         'Bazar',       4800),
    ('Cuaderno A4 tapa dura',    'Librería',    5200),
    ('Lapiceras azules x 10',    'Librería',    3600),
    ('Resma A4 500 hojas',       'Librería',    7900),
    ('Resaltadores x 4',         'Librería',    2900),
    ('Auriculares con cable',    'Electrónica', 15500),
    ('Cargador USB-C 20 W',      'Electrónica', 12900),
    ('Mouse inalámbrico',        'Electrónica', 11800),
    ('Pendrive 64 GB',           'Electrónica',  9900);

SELECT setseed(0.42);

INSERT INTO clientes (nombre, ciudad, provincia, segmento, alta)
SELECT c.nombre, l.ciudades[c.i], l.provincias[c.i], c.segmento, c.alta
  FROM (
        SELECT (ARRAY['Ana', 'Bruno', 'Camila', 'Diego', 'Elena', 'Facundo', 'Gabriela',
                      'Hernán', 'Inés', 'Joaquín', 'Julieta', 'Lucas', 'Martina', 'Nicolás',
                      'Olivia', 'Pablo', 'Rocío', 'Santiago', 'Valentina', 'Tomás'])[1 + floor(random() * 20)::int]
               || ' ' ||
               (ARRAY['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez',
                      'Pérez', 'Gómez', 'Díaz', 'Sosa', 'Romero', 'Álvarez', 'Torres', 'Ruiz',
                      'Benítez', 'Acosta', 'Medina', 'Herrera', 'Suárez', 'Aguirre'])[1 + floor(random() * 20)::int]
                                                                  AS nombre,
               1 + floor(random() * 12)::int                     AS i,
               (ARRAY['Minorista', 'Minorista', 'Minorista', 'Mayorista', 'Online', 'Online'])[1 + floor(random() * 6)::int]
                                                                  AS segmento,
               date '2023-01-01' + floor(random() * 900)::int    AS alta
          FROM generate_series(1, 120)
       ) AS c,
       (SELECT ARRAY['Buenos Aires', 'La Plata', 'Mar del Plata', 'Córdoba', 'Rosario', 'Santa Fe',
                     'Mendoza', 'San Miguel de Tucumán', 'Salta', 'Neuquén', 'Bahía Blanca', 'Posadas']
                   AS ciudades,
               ARRAY['CABA', 'Buenos Aires', 'Buenos Aires', 'Córdoba', 'Santa Fe', 'Santa Fe',
                     'Mendoza', 'Tucumán', 'Salta', 'Neuquén', 'Buenos Aires', 'Misiones']
                   AS provincias) AS l;

-- 2.400 ventas entre enero de 2025 y agosto de 2026, con precios que suben 2,2 % por mes.
INSERT INTO ventas (fecha, cliente_id, producto_id, cantidad, precio_unitario)
SELECT v.fecha, v.cliente_id, p.id, v.cantidad,
       round(p.precio * (1 + 0.022 * ((extract(year FROM v.fecha) - 2025) * 12
                                      + extract(month FROM v.fecha) - 1)), 2)
  FROM (
        SELECT date '2025-01-01' + floor(random() * 608)::int      AS fecha,
               1 + floor(random() * 120)::int                     AS cliente_id,
               1 + floor(random() * 18)::int                      AS producto_id,
               (ARRAY[1, 1, 1, 2, 2, 3, 4])[1 + floor(random() * 7)::int] AS cantidad
          FROM generate_series(1, 2400)
       ) AS v
  JOIN productos p ON p.id = v.producto_id
 ORDER BY v.fecha;

CREATE VIEW ventas_por_mes AS
SELECT date_trunc('month', fecha)::date      AS mes,
       count(*)                              AS operaciones,
       sum(cantidad)                         AS unidades,
       sum(cantidad * precio_unitario)       AS facturado
  FROM ventas
 GROUP BY 1
 ORDER BY 1;

-- El usuario con el que entra Algedi: puede conectarse y leer, nada más.
CREATE ROLE algedi_lector LOGIN PASSWORD 'lector_demo';
ALTER ROLE algedi_lector SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE algedi_demo TO algedi_lector;
GRANT USAGE ON SCHEMA public TO algedi_lector;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO algedi_lector;

ANALYZE;
