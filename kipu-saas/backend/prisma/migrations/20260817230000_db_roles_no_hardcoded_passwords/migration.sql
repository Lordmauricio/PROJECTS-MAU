-- ============================================================
-- Remediacion: elimina las contrasenas literales que la migracion inicial
-- asignaba a los roles `app_user` y `app_superadmin`.
--
-- Contexto: hasta esta migracion, `20260812140815_init` creaba ambos roles
-- con una contrasena escrita en el propio archivo SQL versionado
-- ('app_user_dev_password' / 'app_superadmin_dev_password'). Esa credencial
-- quedaba publicada en el repositorio y era identica en todos los entornos
-- que hubieran corrido la migracion. `app_superadmin` ademas tiene
-- BYPASSRLS, es decir que con esa contrasena conocida se podian leer y
-- escribir los datos de CUALQUIER tenant, saltandose por completo el
-- aislamiento por RLS.
--
-- Aquella migracion ya fue corregida para no crear los roles con
-- contrasena, lo que resuelve el caso de una base NUEVA. Esta migracion
-- cubre el otro caso: una base que YA la aplico y por lo tanto todavia
-- tiene la credencial filtrada activa. Es idempotente y segura de correr
-- en ambos escenarios.
--
-- Tras aplicarla, `app_user` no puede autenticarse hasta que se le asigne
-- una contrasena desde variables de entorno con:
--     npm run db:provision-roles      (scripts/provision-db-roles.ts)
-- Eso es deliberado: preferimos que la aplicacion falle al conectar antes
-- que seguir corriendo con una credencial publicada. `docker-entrypoint.sh`
-- ya ejecuta ese paso automaticamente despues de las migraciones.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    -- Quita la contrasena. El rol sigue existiendo con sus GRANTs y sin
    -- BYPASSRLS; solo pierde la credencial filtrada.
    ALTER ROLE app_user WITH PASSWORD NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_superadmin') THEN
    -- Ademas de quitarle la contrasena, se le revoca LOGIN: ningun modulo
    -- de la aplicacion lo usa todavia, y un rol con BYPASSRLS no deberia
    -- poder conectarse hasta que exista el backoffice que lo necesite.
    ALTER ROLE app_superadmin WITH PASSWORD NULL NOLOGIN;
  END IF;
END
$$;
