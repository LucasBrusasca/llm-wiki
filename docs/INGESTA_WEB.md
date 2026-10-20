# Ingesta de páginas web

Algedi trata una página como **dos cosas**:

1. **Texto limpio (silver)** — lo que busca el RAG, cita el agente y relaciona el grafo.
2. **Original (bronze)** — la URL viva o el archivo HTML. El botón **Abrir original** sigue yendo ahí.

El HTML crudo no entra al índice. Lo que entra es el contenido principal: sin menús, pie, banners de cookies, «Ver más / Ver menos / Leer más», viñetas hechas de emojis ni hashtags sueltos de un feed. Los **títulos** y las **tablas** (tarifas, estados contables) se conservan.

Aplica igual a una ingesta puntual (`procesar_url_web` / archivo HTML) y a una **fuente viva** (`kind=html` en el watcher).

## Qué se usa

- `html_extract.py`: trafilatura para el artículo, BeautifulSoup para chrome y tablas, y un post-proceso de ruido.
- **No hay paquetes pip nuevos.** `trafilatura`, `beautifulsoup4` y `playwright` ya estaban en `requirements-fastapi.txt`. Chromium ya se instala en `Dockerfile.backend`.

## Páginas armadas con JavaScript

Si el GET estático trae poco texto (cascarón de SPA), se puede renderizar con Chromium y extraer de ese HTML.

| Variable | Default | Qué hace |
|---|---|---|
| `ALGEDI_HTML_JS` | `0` | `1` / `true` prende el render. Si Chromium no está, se sigue con el estático. |
| `ALGEDI_HTML_JS_MIN_CHARS` | `400` | Por debajo de esto se considera “muy poco texto”. |
| `ALGEDI_HTML_JS_TIMEOUT_MS` | `15000` | Timeout de Playwright. |

El default del código es **apagado**: los tests no lanzan un browser.

### Cómo prenderlo en Docker (Windows PowerShell)

No hace falta rebuild si tu imagen del backend ya tiene Chromium (`playwright install --with-deps chromium` en `Dockerfile.backend`).

```powershell
cd ruta\a\llm-wiki
# En .env (o sólo para esta sesión):
Add-Content .env "`nALGEDI_HTML_JS=1"
docker compose up -d backend
```

Comprobá que el contenedor lo ve:

```powershell
docker compose exec backend printenv ALGEDI_HTML_JS
```

Si el render JS falla (Chromium ausente), el log del backend dice `[html_extract] Chromium no disponible…` y la ingesta sigue con el HTML estático.

### ¿Cuándo sí rebuild?

Sólo si tu imagen es **anterior** a la línea de Chromium en `Dockerfile.backend` (o nunca la buildeaste):

```powershell
docker compose build backend
docker compose up -d backend
```

No hay que rebuildear el frontend por este cambio: el preview (fecha de captura, fuente viva vs captura única) entra por el bind-mount de `frontend/src`.

## Preview del nodo

En el inspector, el visor muestra el texto extraído —no el HTML ruidoso— y un pie:

- **Fuente viva** — «se actualiza sola cada N h», fecha de **esta captura** (`created_at` del nodo) y **última revisión** (`last_check` de la fuente).
- **Captura única** — «no se refresca sola» y cuándo se bajó.

**Abrir original** no se toca: abre la URL en vivo o el archivo guardado.

## Reingerir una página ya ruidosa

Las páginas ingeridas **antes** de este cambio siguen con el texto viejo en los chunks. Volvé a ingerir la URL (o esperá el próximo ciclo de la fuente viva) para reemplazar el extracto.
