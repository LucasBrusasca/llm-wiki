"""Estado de vigencia de una fuente. Reglas puras, determinísticas y sin LLM.

Por qué existe este módulo aparte: la vigencia es la clase de afirmación que más fácil
se inventa. La tentación es mirar la fecha de carga y decir "esto es viejo, capaz está
desactualizado". Eso sería una conjetura presentada como dato.

La regla dura de acá es:

    LA ANTIGÜEDAD NO ES UNA SEÑAL DE DESACTUALIZACIÓN.

Un documento de 2019 puede seguir siendo la referencia vigente y uno de ayer puede haber
quedado obsoleto. El sistema sólo degrada el estado de una fuente cuando tiene una
**observación concreta**: el archivo del que salió el nodo ya no es el mismo archivo, la
fuente fue reingerida con contenido nuevo, o una persona lo marcó. Nunca por el calendario.

Todo lo que se calcula acá es offline: comparar hashes de archivos locales. No hay red,
no hay modelo, no hay heurística difusa.
"""

from __future__ import annotations

# ── Estados posibles ──────────────────────────────────────────────────────────
VIGENTE = "vigente"
POSIBLEMENTE_DESACTUALIZADO = "posiblemente_desactualizado"
REEMPLAZADO = "reemplazado"

ESTADOS = {VIGENTE, POSIBLEMENTE_DESACTUALIZADO, REEMPLAZADO}

# ── Motivos: por qué una fuente está en el estado en que está ─────────────────
# Cada estado viaja con su motivo. "posiblemente_desactualizado" sin motivo sería
# exactamente la conjetura que este módulo existe para evitar.
MOTIVO_SIN_CAMBIOS = "contenido_sin_cambios"
MOTIVO_ARCHIVO_MODIFICADO = "archivo_modificado_despues_de_la_ingesta"
MOTIVO_ARCHIVO_AUSENTE = "archivo_ausente"
MOTIVO_NO_VERIFICABLE = "sin_archivo_local_verificable"
MOTIVO_REINGESTA = "reingerida_con_contenido_nuevo"
MOTIVO_HUMANO = "decision_humana"
MOTIVO_NUNCA_VERIFICADO = "nunca_verificado"
# El archivo existe pero nunca se guardó un hash de referencia (fuentes anteriores a
# esta capa). Se puede fijar la línea base HOY, y eso habilita detectar cambios de acá
# en adelante — pero no dice absolutamente nada sobre lo que pasó antes. El motivo lo
# declara para que "vigente" no se lea como "verificado".
MOTIVO_LINEA_BASE_NUEVA = "linea_base_establecida_ahora"


def estado_inicial() -> dict:
    """Vigencia de una fuente recién incorporada.

    Arranca en `vigente` porque no hay ninguna observación en contra — no porque se
    haya comprobado que sigue vigente. El motivo lo dice explícitamente.
    """
    return {
        "version": 1,
        "hash_contenido": None,
        "historial": [],
        "duplicado_de": None,
        "motivo": MOTIVO_NUNCA_VERIFICADO,
        "verificado_en": None,
    }


def registrar_ingesta(vigencia_previa: dict | None, hash_previo: str | None,
                      hash_nuevo: str | None, ahora: str,
                      duplicado_de: str | None = None) -> tuple[str, dict]:
    """Vigencia de una fuente al ingerirla (por primera vez o de nuevo).

    Devuelve `(estado, vigencia)`.

    Reingerir el MISMO locator con contenido distinto significa que la fuente cambió:
    la versión sube y el hash anterior queda en el historial. La fuente resultante es
    `vigente` — es la nueva versión, no la vieja. Lo que quedó obsoleto es el hash
    anterior, y por eso se conserva en vez de perderse.
    """
    vigencia = dict(vigencia_previa) if vigencia_previa else estado_inicial()
    vigencia.setdefault("historial", [])
    vigencia.setdefault("version", 1)

    cambio = (hash_previo is not None and hash_nuevo is not None
              and hash_previo != hash_nuevo)
    if cambio:
        vigencia["historial"] = list(vigencia["historial"]) + [
            {"hash": hash_previo, "reemplazado_en": ahora}
        ]
        vigencia["version"] = int(vigencia.get("version") or 1) + 1
        vigencia["motivo"] = MOTIVO_REINGESTA
    elif vigencia.get("motivo") in (None, MOTIVO_NUNCA_VERIFICADO):
        vigencia["motivo"] = MOTIVO_NUNCA_VERIFICADO

    vigencia["hash_contenido"] = hash_nuevo
    vigencia["verificado_en"] = ahora
    if duplicado_de:
        # Contenido byte a byte idéntico a otra fuente ya incorporada. NO degrada el
        # estado: dos copias del mismo archivo no vuelven vieja a ninguna. Es un dato
        # accionable (deduplicar), no una señal de obsolescencia.
        vigencia["duplicado_de"] = duplicado_de
    else:
        vigencia.setdefault("duplicado_de", None)
    return VIGENTE, vigencia


def verificar_contra_disco(vigencia: dict | None, hash_registrado: str | None,
                           hash_en_disco: str | None, archivo_existe: bool,
                           tiene_archivo_local: bool, ahora: str) -> tuple[str, dict]:
    """Compara lo que se ingirió contra lo que hoy hay en disco.

    Es la ÚNICA fuente automática de `posiblemente_desactualizado`, y se apoya en una
    observación, no en una estimación: el archivo del que se derivó este nodo ya no es
    el mismo archivo. El resumen, los conceptos y las aristas del grafo describen una
    versión que dejó de existir.

    Las fuentes sin archivo local (URL, YouTube) no se pueden verificar offline: quedan
    como estaban, con el motivo que lo aclara. No se las degrada por no ser verificables.
    """
    vigencia = dict(vigencia) if vigencia else estado_inicial()
    vigencia.setdefault("historial", [])
    vigencia.setdefault("version", 1)
    vigencia.setdefault("duplicado_de", None)
    vigencia["verificado_en"] = ahora

    if not tiene_archivo_local:
        vigencia["motivo"] = MOTIVO_NO_VERIFICABLE
        return VIGENTE, vigencia

    if not archivo_existe:
        # El original ya no está. No se puede afirmar que el contenido cambió, pero
        # tampoco que sigue siendo el mismo: la evidencia dejó de ser comprobable.
        vigencia["motivo"] = MOTIVO_ARCHIVO_AUSENTE
        return POSIBLEMENTE_DESACTUALIZADO, vigencia

    if hash_en_disco is None:
        vigencia["motivo"] = MOTIVO_NO_VERIFICABLE
        return VIGENTE, vigencia

    if hash_registrado is None:
        # Se fija la referencia con el archivo tal como está hoy. Desde ahora un cambio
        # es detectable; sobre el período anterior no se puede afirmar nada.
        vigencia["motivo"] = MOTIVO_LINEA_BASE_NUEVA
        vigencia["hash_contenido"] = hash_en_disco
        vigencia["linea_base_en"] = ahora
        return VIGENTE, vigencia

    if hash_registrado == hash_en_disco:
        vigencia["motivo"] = MOTIVO_SIN_CAMBIOS
        return VIGENTE, vigencia

    vigencia["motivo"] = MOTIVO_ARCHIVO_MODIFICADO
    vigencia["hash_en_disco"] = hash_en_disco
    return POSIBLEMENTE_DESACTUALIZADO, vigencia


def aplicar_decision_humana(estado: str, comentario: str | None, ahora: str,
                            reemplazada_por: str | None = None) -> dict:
    """Una persona fija el estado de una fuente. Devuelve SÓLO la revisión.

    Deliberadamente no toca `estado_vigencia` ni `vigencia`: esos guardan lo que
    **observó el sistema** y deben seguir siendo consultables aunque una persona opine
    distinto. Si la decisión humana los pisara, quitarla después dejaría el estado
    humano pegado y "lo que observó el sistema" pasaría a ser mentira — que es
    justamente la confusión que este módulo evita.

    El estado efectivo lo arma `resolver_estado`: revisión humana por encima de la
    observación, con las dos visibles por separado.
    """
    if estado not in ESTADOS:
        raise ValueError(f"Estado de vigencia inválido: {estado}")
    return {
        "estado": estado,
        "comentario": (comentario or "").strip() or None,
        "reemplazada_por": reemplazada_por,
        "fecha": ahora,
        "motivo": MOTIVO_HUMANO,
    }


def resolver_estado(estado_calculado: str | None, revision: dict | None) -> str:
    """Estado efectivo: la decisión humana pisa a la automática."""
    if revision and revision.get("estado") in ESTADOS:
        return revision["estado"]
    return estado_calculado or VIGENTE


def fecha_contenido_conocida(fecha_doc: str | None) -> bool:
    """¿Sabemos la fecha PROPIA del contenido (no la de carga)?

    En el corpus real la mayoría de las fuentes no la trae. Decir "no la sabemos" es
    parte del producto: la fecha de incorporación no puede ocupar su lugar.
    """
    return bool(fecha_doc and str(fecha_doc).strip())
