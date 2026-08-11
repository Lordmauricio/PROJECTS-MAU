# Facturación electrónica SIN Bolivia — investigación normativa y técnica

Estado: **borrador de trabajo, basado en fuentes públicas indexadas por buscador**.

## Cómo se hizo esta investigación (léase antes de confiar en este documento)

El entorno de ejecución de esta sesión tiene bloqueado por política de red el
acceso directo (`WebFetch`/`curl`) a `impuestos.gob.bo`, `siatinfo.impuestos.gob.bo`,
`siatanexo.impuestos.gob.bo` y dominios relacionados. Todo lo que sigue viene de
**resúmenes de resultados de búsqueda web** (snippets), no de haber leído el
texto completo y literal de las páginas oficiales o los PDF de las RND/Anexos
Técnicos. Esto tiene dos consecuencias que hay que tomar en serio:

1. Los nombres de página y la existencia de las secciones están confirmados
   (aparecen como URLs reales de `siatinfo.impuestos.gob.bo` /
   `siatanexo.impuestos.gob.bo`), pero el **contenido exacto campo por campo**
   (anchos, orden exacto, nombres de tag XML, catálogos completos) NO está
   verificado letra por letra.
2. **Antes de escribir una sola línea de `FiscalXmlBuilder`, `SinCufdService`,
   `SinCuisService` o el algoritmo de CUF en el código de producción**, alguien
   con acceso de red normal (fuera de este sandbox) debe:
   - Entrar a <https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/algoritmos-utilizados/generacion-cuf>
     y <https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/algoritmos-utilizados/algoritmo-modulo-11>
     y copiar el algoritmo completo, literal.
   - Descargar el/los Anexo(s) Técnico(s) vigente(s) y el/los XSD si el SIN los publica.
   - Confirmar la RND vigente a la fecha de implementación (las RND se
     actualizan; ver sección "Normativa" abajo con las que se encontraron).

Este documento es la base para *empezar* el diseño (arquitectura, entidades,
interfaces) de forma que nada quede hardcodeado de forma irreversible — no es
la fuente de verdad final para homologar ante el SIN.

## Normativa identificada

- **RND Nº 101800000026** — "Sistema de Facturación Electrónica" (documento de
  distribución gratuita del SIN, PDF en `impuestos.gob.bo/wp-content/uploads/2025/10/`).
- **RND Nº 102500000036 (R-0011-01)** — normativa vinculada al sistema de
  facturación, agosto 2021 según registro en lexivox.org.
- **RND 10-0021-16** — "Sistema de Facturación Virtual" (SFV), otra modalidad
  distinta a la electrónica en línea.
- **RND 102600000007** — extiende hasta el **30 de septiembre de 2026** el
  plazo para completar la adaptación a la modalidad de Facturación en Línea;
  desde el **1 de octubre de 2026** la emisión deberá hacerse exclusivamente
  por la modalidad asignada a cada contribuyente.
- Contribuyentes de los **grupos 9 a 12**: la obligatoriedad se movió del
  1/oct/2025 al **1/abril/2026** según una modificación posterior.
- Existe una página oficial `impuestos.gob.bo/index.php/rnd-2026/` que agrupa
  las RND vigentes de 2026 — **debe revisarse ahí la lista completa y la más
  reciente antes de implementar**, ya que este documento no pudo leer esa
  página en detalle.

**Implicación de producto**: el sistema debe soportar el cronograma de
migración (SFV / Computarizada / Electrónica en Línea conviven hasta oct-2026
según el grupo del contribuyente), no asumir que todos los tenants ya están en
"Electrónica en Línea".

## Modalidades de facturación en línea

El SIN documenta al menos tres modalidades bajo el paraguas de "facturación en
línea":

1. **Facturación Electrónica en Línea** — la modalidad "premium", con firma
   digital y token delegado.
2. **Facturación Computarizada en Línea** — "emisión de Documentos Fiscales
   Digitales usando un token delegado en un Sistema Informático de
   Facturación autorizado por la Administración Tributaria y su posterior
   envío, registro y validación en los servidores del SIN" (paráfrasis de
   `siatinfo.../modalidades-facturacion/facturacion-computarizada`).
3. **Portal Web en Línea** — modalidad para contribuyentes que facturan desde
   el propio portal del SIN, sin sistema propio.

Para un SaaS multiempresa como este, lo relevante es 1 y 2: el sistema propio
del contribuyente (o del proveedor tercero) genera y envía los documentos.

## Los tres códigos: CUIS, CUFD, CUF

Confirmado por múltiples fuentes (incluida `siatinfo.impuestos.gob.bo`):

- **CUIS (Código Único de Inicio de Sistemas)**: vincula al contribuyente con
  su Sistema de Facturación autorizado. Se solicita una vez por
  sistema/punto de venta y permanece vigente hasta que se revoque o cambie el
  sistema.
- **CUFD (Código Único de Facturación Diaria)**: código alfanumérico generado
  por la Administración Tributaria que habilita la emisión de Documentos
  Fiscales Digitales durante **24 horas** desde su obtención. Se solicita por
  Web Service, puede pedirse varias veces al día, y **al pedir uno nuevo el
  anterior deja de ser válido para emitir**. El sistema debe:
  - Cachear el CUFD vigente por sucursal/punto de venta.
  - Volver a pedirlo automáticamente al vencer (o bajo demanda).
  - Evitar condiciones de carrera si dos ventas simultáneas disparan la
    renovación a la vez (lock/mutex por punto de venta).
- **CUF (Código Único de Factura)**: identifica cada documento fiscal emitido.
  Reemplaza al número de autorización + código de control de la facturación
  manual tradicional.

### Algoritmo de generación del CUF (resumen de fuente secundaria — VERIFICAR)

Según el resumen obtenido de la página oficial de algoritmos:

- La cadena de entrada al algoritmo Módulo 11 es la concatenación de: **NIT,
  sucursal, fecha, modalidad, tipo de emisión, tipo de documento, número de
  factura** (y, según el propio resumen, el cálculo llega "hasta el campo
  Punto de Venta", lo que sugiere que el punto de venta también forma parte
  de la cadena aunque no apareció listado explícitamente — **hay que
  confirmar el orden exacto en la página oficial**).
- Sobre esa cadena (~53 dígitos hasta el campo Punto de Venta) se calcula un
  dígito autoverificador con **Módulo 11** (hay una página dedicada:
  `algoritmos-utilizados/algoritmo-modulo-11`, y otra genérica de
  `codigo-de-control` para facturación manual — no confundir ambas).
- El resultado se codifica en **Base 16** (hexadecimal), y a esa cadena se le
  concatena el código de verificación.
- Existe también un documento específico para **Boletos Aéreos**
  (`GENERACION-CUFB.pdf`), lo que confirma que **distintos tipos de
  documento fiscal tienen variantes del algoritmo** — el sistema no debe
  asumir un único formato de CUF para todos los `codigoTipoDocumentoSector`.

**Decisión de diseño**: implementar `CufGenerator` como una interfaz con una
implementación por tipo de documento/sector, parametrizada por anchos de
campo, para poder ajustar sin reescribir el dominio. No se debe escribir la
implementación final de este algoritmo hasta leer la página oficial completa.

## Ambientes y endpoints

Confirmado por búsqueda (no verificado con `curl` por el bloqueo de red):

- Portal Piloto: `https://pilotosiat.impuestos.gob.bo/`
- Portal Producción: `https://siat.impuestos.gob.bo/`
- Ejemplo de WSDL en piloto (servicio de códigos):
  `https://pilotosiatservicios.impuestos.gob.bo/v1/FacturacionCodigos?wsdl`
  — esto confirma que el SIN expone **SOAP** (WSDL) para al menos el servicio
  de códigos (CUIS/CUFD). Hay que enumerar el resto de servicios (envío de
  factura, anulación, verificación, catálogos) de la misma forma; probable
  que compartan el host `pilotosiatservicios.impuestos.gob.bo` con otros
  paths `/v1/<Servicio>?wsdl`.

**Decisión de diseño**: el adapter `SinBoliviaProvider` debe usar un cliente
SOAP (p. ej. `soap` o `strong-soap` en Node) contra estos WSDL, no REST/JSON,
salvo que la investigación completa contradiga esto para servicios
específicos.

## Autorización del sistema (fases)

Se identificaron al menos:

- **Fase 2 — Pruebas Piloto**: pruebas funcionales y de carga del Sistema
  Informático de Facturación ya autorizado, previas a solicitar el paso a
  producción.
- **Fase 3 — Pruebas Piloto**: para el **modelo de Proveedor** — garantiza la
  integración e implementación del sistema del Proveedor y el ecosistema de
  facturación de sus clientes, en el ambiente Piloto, antes de operar bajo la
  modalidad asignada.
- Debe existir una **Fase 1** (probablemente registro/solicitud inicial del
  sistema) que no se pudo confirmar en esta pasada — pendiente de verificar
  en `Proceso de autorización` (`facturacion-en-linea/autorizacion-de-sistemas/proceso-de-autorizacion`).

**Decisión de diseño**: el módulo "Configuración tributaria" debe modelar el
estado de homologación como una máquina de estados explícita (ver más abajo),
no como un booleano "activo/inactivo".

## Modelo de terceros / proveedor tecnológico

Confirmado:

- Un **Proveedor** solicita al SIN asociar el NIT del contribuyente a su
  Sistema Informático bajo la modalidad de terceros.
- El **contribuyente** debe confirmar o rechazar esa asociación desde el
  **Portal SIAT** (Sistema de Facturación Versión 2 → "Confirmación de
  Asociación").
- Una vez confirmada, se emite la autorización del sistema para ese NIT.
- **La autorización dura 3 años**; antes de vencer, el titular o el proveedor
  deben solicitar una nueva, repitiendo las pruebas vigentes en ese momento.
- El NIT del contribuyente debe estar **vigente y activo**.

**Implicación de producto**: el SaaS, para operar como proveedor, necesita:
un flujo de "solicitar asociación" (llamada al SIN identificando el NIT del
tenant), un estado "pendiente de confirmación por el contribuyente" (que
ocurre **fuera** del SaaS, en el portal del SIN), un evento/webhook o
polling para detectar cuándo el tenant confirmó, y una fecha de vencimiento a
3 años con alertas de renovación.

## Token Delegado

Confirmado:

- Se solicita desde el **Portal SIAT** (con las credenciales SIAT del
  contribuyente, no del proveedor): "Sistema de Facturación" →
  "Gestión de Autorización de Sistemas Informáticos de Facturación" →
  "Token Delegado en Producción" (o su equivalente en Piloto).
- Al completar el registro se genera un reporte con: **código de sistema
  asignado**, **parámetros constantes** para el consumo de los servicios, y
  las **direcciones (endpoints)** a usar en cada fase de prueba.
- **Validez máxima: 1 año.** Vencido, no se pueden seguir emitiendo
  documentos y hay que generar un token nuevo.

**Implicación de seguridad**: el token delegado se genera **en el portal del
SIN por el propio contribuyente**, no lo emite el SaaS. El SaaS solo lo
**almacena cifrado** una vez que el usuario lo pega en el formulario de
configuración tributaria. Nunca se debe loguear, exponer en el frontend tras
guardarlo, ni mandar a analítica.

## Catálogos

El SIN exige sincronizar diariamente catálogos vía Web Service (mencionado
explícitamente): actividades económicas, sectores, productos, y
fecha/hora oficial del servidor del SIN, entre otros ("Actividades, sectores,
productos, fecha/hora, documento sector" — resumen de fuente secundaria, hay
que confirmar la lista exacta y exhaustiva contra la sección de catálogos del
Anexo Técnico).

**Decisión de diseño**: `SinCatalogSyncService` como job diario, versión y
fecha de sincronización guardadas, y **nunca** hardcodear valores de estos
catálogos en el dominio (usar tablas `sin_catalogs` con `codigo`,
`descripcion`, `version_vigente_desde`).

## Preguntas abiertas que requieren acceso directo al portal (no resueltas aquí)

1. Contenido literal y completo del algoritmo de Módulo 11 y de generación de
   CUF (orden exacto de campos, anchos en dígitos, manejo de tipos de
   documento distintos a factura de boleto aéreo).
2. Lista completa y nombres exactos de operaciones SOAP disponibles (envío de
   factura, anulación, verificación de recepción, eventos significativos,
   contingencia) más allá del servicio `FacturacionCodigos` ya confirmado.
3. XSD/esquema exacto del XML de factura por tipo de documento/sector.
4. Detalle de la Fase 1 de autorización de sistemas.
5. Mecanismo exacto de contingencia (qué pasa si el SIN no responde: cola
   local, ventana de tiempo permitida, cómo se reportan luego los documentos
   emitidos en contingencia).
6. Lista completa y actualizada de RND vigentes en `impuestos.gob.bo/index.php/rnd-2026/`.

## Fuentes consultadas (vía WebSearch, snippets — no lectura completa)

- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/algoritmos-utilizados/generacion-cuf
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/algoritmos-utilizados/algoritmo-modulo-11
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-manual/algoritmos/codigo-de-control
- https://siatinfo.impuestos.gob.bo/images/archivos_tecnicos/archivos_apoyo/GENERACION-CUFB.pdf
- https://siatinfo.impuestos.gob.bo/index.php/sistema-proveedor
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/caracteristicas-sfvl/asociacion-de-sistemas
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/solicitud-token
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/implementacion-servicios-facturacion/codigos/solicitud-cufd
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/implementacion-servicios-facturacion/codigos/solicitud-cufd-masivo
- https://siatanexo.impuestos.gob.bo/index.php/autorizacion-de-sistemas/pruebas-para-la-autorizacion-del-sistema-de-facturacion/fase-ii-pruebas-piloto
- https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/autorizacion-de-sistemas/pruebas-para-la-autorizacion-del-sistema-de-facturacion/fase-iii-pruebas-piloto
- https://siatinfo.impuestos.gob.bo/index.php/informacion/modalidades-facturacion/facturacion-computarizada
- https://siatinfo.impuestos.gob.bo/index.php/informacion/codigos-de-autorizacion
- https://www.impuestos.gob.bo/wp-content/uploads/2025/10/RND-101800000026.pdf
- https://www.impuestos.gob.bo/wp-content/uploads/2025/10/RND-102500000036.pdf
- https://www.impuestos.gob.bo/index.php/rnd-2026/
- https://www.lexivox.org/norms/BO_SIN-RND-R-0011-01.xhtml

## Próximo paso recomendado

Antes de escribir `SinBoliviaProvider`, `FiscalXmlBuilder` o el algoritmo real
de CUF: alguien con acceso normal a internet abre las URLs de la sección
"Preguntas abiertas" de arriba, copia el contenido literal (o descarga los
PDF), y los agrega a este repo en `docs/sin/fuentes/` para que el equipo
implemente contra el texto real, no contra un resumen de buscador.
