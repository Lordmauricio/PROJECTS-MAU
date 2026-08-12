-- Login/refresh necesitan leer las propias membresías de un usuario
-- (organization_users) ANTES de conocer con qué organización va a operar
-- el request, es decir, sin ningún valor de app.current_tenant que fijar.
-- La policy tenant_isolation existente (organizationId = current_tenant)
-- no puede satisfacer esa consulta por diseño.
--
-- Esta policy adicional, de solo lectura, permite ver las propias filas de
-- membresía por userId (vía app.current_user_id, fijado por
-- UserPrismaService) sin exponer ningún dato de negocio de otro tenant: lo
-- único que revela es "a qué organizaciones pertenezco y con qué rol", que
-- ya es información que el propio login le devuelve al usuario.
--
-- Al ser una policy PERMISSIVE adicional para SELECT, Postgres la combina
-- con OR junto a tenant_isolation: una fila es visible si organizationId
-- coincide con el tenant activo, O si userId coincide con el usuario
-- autenticado. Los INSERT/UPDATE/DELETE siguen exigiendo únicamente
-- tenant_isolation (esta policy no tiene WITH CHECK ni aplica a esos
-- comandos).
CREATE POLICY own_memberships_readable ON "organization_users"
  FOR SELECT
  USING ("userId" = current_setting('app.current_user_id', true));
