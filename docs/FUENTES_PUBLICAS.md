# Fuentes públicas para la ingesta automática

Relevamiento del 14/10/2026: se leyó la documentación oficial de cada fuente y se probaron en vivo los endpoints marcados como «probado». No se usó ninguna key.

## Para conectar primero

| # | Fuente | Por qué |
|---|---|---|
| 1 | **BCRA: Estadísticas Monetarias v4.0 y Cambiarias v1.0** | Sin auth, JSON limpio, ids estables. Se sincroniza incremental con `desde=`. `/metodologia` da el texto de cada serie. Reemplaza a la web que arma sus datos con JavaScript. |
| 2 | **datos.gob.ar: API de Series de Tiempo** | INDEC y Ministerio de Economía (IPC, EMAE…), con búsqueda para «fijar» series. Cuotas claras y licencia CC-BY. |
| 3 | **CKAN de la Secretaría de Energía** | Un conector CKAN genérico sirve también para datos.gob.ar, el volcado de InfoLEG y ENARGAS. Trae CAMMESA, Capítulo IV y precios. |
| 4 | **Volcado de InfoLEG y monitoreo liviano del Boletín Oficial** | Es el corpus normativo de la tesis. Las relaciones modifica/modificada se vuelven aristas. |
| 5 | **arXiv (RSS + API) y OpenAlex** | Novedades, metadatos, abstracts y citas (las citas también son aristas). |

En paralelo conviene sumar **Notion**, con un Personal Access Token y `GET /v1/pages/{id}/markdown`.

## BCRA (`https://api.bcra.gob.ar`, sin autenticación)

| API | Endpoint de ejemplo | Notas |
|---|---|---|
| Monetarias v4.0 (1610 variables) | Lista: `/estadisticas/v4.0/monetarias?categoria=&periodicidad=D\|M\|T&limit=&offset=`<br>Datos: `/estadisticas/v4.0/monetarias/{id}?desde=YYYY-MM-DD&hasta=…&limit=3000`<br>Metodología: `/estadisticas/v4.0/metodologia/{id}` | `limit` llega hasta 3000. **v1 a v3 están deprecadas; v3 devuelve 410.** Probado: id 1 = reservas, id 4 = tipo de cambio minorista. |
| Cambiarias v1.0 | `/estadisticascambiarias/v1.0/Maestros/Divisas`<br>`/estadisticascambiarias/v1.0/Cotizaciones?fecha=YYYY-MM-DD`<br>`/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=&fechahasta=` | `limit` va de 10 a 1000. Probado. |
| Cheques denunciados, Central de Deudores, Transparencia | `/cheques/v1.0/…`, `/CentralDeDeudores/v1.0/Deudas/{cuit}`, `/transparencia/v1.0/CajasAhorros` | La Central de Deudores son datos personales: nada de ingesta masiva. No probados. |

**Términos:** se permite el uso académico e informativo citando «BCRA»; el uso comercial requiere autorización. **SSL:** verifica bien; si falla en Docker, hay que actualizar `ca-certificates` o `certifi`, nunca `verify=False`.

## Datos abiertos de Argentina

- **Series de Tiempo (datos.gob.ar)**
  - Búsqueda: `https://apis.datos.gob.ar/series/api/search/?q=…`
  - Datos: `https://apis.datos.gob.ar/series/api/series/?ids=…&start_date=…&format=json`
  - Admite `representation_mode`, `collapse`, `last` y hasta 40 ids por llamada.
  - Cuotas por IP: 60 por segundo y 200.000 por día.
  - Probado.
- **CKAN de datos.gob.ar**
  - `https://datos.gob.ar/api/3/action/package_search?q=…`, después `package_show` con el `name` que devuelve la búsqueda.
- **Fuentes con acceso restringido o sin API**
  - Presupuesto Abierto pide token.
  - BYMA pide contrato y prohíbe redistribuir.
  - MAE/A3 pide registro.
  - ARCA pide certificado.
  - INDEC y CNV no tienen API propia; INDEC está en Series de Tiempo.

## Energía

- **Secretaría de Energía (CKAN)**
  - `datos.energia.gob.ar/api/3/action/package_list`, `package_show` y `datastore_search?resource_id=…`.
  - 178 datasets, con licencia CC-BY.
  - Su HTTPS redirige a HTTP.
  - `metadata_modified` sirve para detectar cambios.
- **CAMMESA**
  - Oficialmente publica en archivos.
  - `https://api.cammesa.com/demanda-svc/demanda/ObtieneDemandaYTemperaturaRegion?id_region=1002` funciona pero **no está documentado**: usarlo con caché y baja frecuencia.
- **ENRE**: no tiene API, y `www.enre.gob.ar` tiene el certificado mal.
- **ENARGAS**: tiene un CKAN chico; se fusiona con el ENRE en el ENRGE, así que las URLs pueden cambiar.
- **InfoLEG**
  - Volcado completo en CKAN (`base-de-datos-legislativos-infoleg`, CC-BY, actualizado el 05/10/2026), con normas, sumarios y relaciones modifica/modificada.
  - El sitio devolvió 403 a un cliente automatizado: hay que mandar un User-Agent con contacto.
- **Boletín Oficial**: no tiene API ni RSS; para seguirlo hay que leer su web una vez por día.

## Internacionales (probados)

- **Sin key:**
  - World Bank v2.
  - IMF SDMX en `api.imf.org`; el viejo `dataservices` se retiró.
  - OECD: 60 descargas por hora.
  - ECB, Eurostat (JSON-stat) y BIS.
- **Con key gratis:** FRED.

## Papers

- **arXiv**: API y RSS (`rss.arxiv.org/rss/cs.AI`). Máximo 1 request cada 3 segundos; no re-hospedar los PDFs.
- **OpenAlex**: la key es gratis. Sin key, hoy devolvió 429.
- **Semantic Scholar**: la key es gratis, por formulario. Sin key, hoy devolvió 429.
- **Crossref**: agregar `mailto=` y respetar el header de rate limit.
- **Hugging Face Hub**: `/api/daily_papers` sin token, 500 requests cada 5 minutos.
- **RSS de canales de YouTube**: hoy devolvió 404, no es confiable. La alternativa es YouTube Data API v3, que pide key.

## Notion

- **Base y headers:** `https://api.notion.com/v1`, con `Authorization: Bearer …` y `Notion-Version: 2026-03-11`.
- **Personal Access Token (recomendado):** lo creás vos y ve todo lo que ve tu usuario. En planes Business puede que el owner tenga que habilitarlo.
- **Integración interna:** hay que compartir cada página desde «Add connections».
- **`GET /v1/pages/{id}/markdown`:** la página entera en markdown, que es lo más simple.
- **`GET /v1/blocks/{id}/children`:** devuelve un solo nivel y hay que recorrerlo recursivamente.
- **Límites:** unas 3 requests por segundo (180 por minuto); el 429 trae `Retry-After`.
- **Páginas públicas sin token:** no hay forma oficial, sólo una vía no documentada que puede romperse.

## Trampas

- **SSL de los .gob.ar:** mantener los certificados al día y, si hace falta, hacer excepciones por host.
- **Versiones deprecadas:** BCRA v1 a v3 (v3 responde 410), IMF legacy y Notion-Version.
- **Límites:** arXiv, OECD y las APIs sin key. Hace falta caché y reintentos que respeten `Retry-After`.
- **Términos de uso:** revisar los de cada fuente.
- **User-Agent:** mandar uno con contacto.
- **Organismos que se fusionan:** ENRGE (ENRE + ENARGAS) y A3 (MAE + Matba Rofex) pueden mudar sus URLs.
