-- `notifications.userId` pasa a NOT NULL.
--
-- Por qué: el invariante "toda notificación tiene dueño" ya se cumplía en el
-- código (las llamadas a `notifications.create` siempre pasan el actor del
-- JWT), pero vivía solo como disciplina de programación. La verificación de
-- pertenencia de `NotificationsService.markRead` compara
-- `notification.userId !== userId`; con la columna nullable, una fila sin
-- dueño —insertada por un cambio futuro o una migración de datos— rompería
-- esa comparación en silencio. Una fila así además es inalcanzable: no se
-- lista (el listado filtra por userId) ni se puede marcar como leída.
--
-- Si existen filas huérfanas, esta migración FALLA en vez de borrarlas: qué
-- hacer con datos existentes es una decisión del operador, no de una
-- migración automática. El mensaje incluye la consulta exacta para
-- inspeccionarlas y la que hay que correr para limpiarlas.
DO $$
DECLARE
  huerfanas bigint;
BEGIN
  SELECT count(*) INTO huerfanas FROM notifications WHERE "userId" IS NULL;
  IF huerfanas > 0 THEN
    RAISE EXCEPTION
      'Hay % notificaciones sin userId, que impiden aplicar NOT NULL. Son filas inalcanzables (no se listan ni se pueden marcar como leídas). Inspeccionalas con: SELECT * FROM notifications WHERE "userId" IS NULL; y, si confirmás que se pueden descartar, corré: DELETE FROM notifications WHERE "userId" IS NULL; antes de reintentar la migración.',
      huerfanas;
  END IF;
END
$$;

ALTER TABLE "notifications" ALTER COLUMN "userId" SET NOT NULL;
