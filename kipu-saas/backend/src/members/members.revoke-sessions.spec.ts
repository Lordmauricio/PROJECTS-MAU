import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  bootTestApp,
  callApi,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Tests de la infraestructura mínima de revocación de sesiones (Fase
 * Offline 1) — no ejercitan nada más de `members/` (invite/changeRole/list
 * ya existen pero no tenían cobertura propia antes de esta fase; agregarla
 * queda fuera de este alcance, ver el informe de la fase).
 */
describe('Revocación de sesiones/dispositivos (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Revoke-Sessions');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  /** Crea un miembro ACTIVE con rol propio (bypassa invitación) y lo loguea, devolviendo también su membershipId y refreshToken — lo que `createUserWithRole` no expone. */
  async function createMemberSession(
    organizationId: string,
    roleKey: string,
    label: string,
  ) {
    const tenantPrisma = app.get(TenantPrismaService);
    const prisma = app.get(PrismaService);
    const suffix = uniqueSuffix();
    const email = `${label.toLowerCase()}-${suffix}@example.test`;
    const password = 'Password123!';

    const membershipId = await tenantPrisma.run(organizationId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({
        where: { organizationId, key: roleKey },
      });
      const passwordHash = await argon2.hash(password);
      const user = await prisma.user.create({
        data: {
          email,
          name: `Test ${label}`,
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });
      const membership = await tx.organizationUser.create({
        data: {
          organizationId,
          userId: user.id,
          roleId: role.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      return membership.id;
    });

    const login = await callApi<{ accessToken: string; refreshToken: string }>(
      app,
      'POST',
      '/auth/login',
      { email, password },
    );
    if (login.status !== 200 && login.status !== 201) {
      throw new Error(
        `login de ${label} debía dar 200/201, dio ${login.status}: ${JSON.stringify(login.body)}`,
      );
    }
    return {
      membershipId,
      email,
      password,
      accessToken: login.body.accessToken,
      refreshToken: login.body.refreshToken,
    };
  }

  async function refresh(refreshToken: string) {
    return callApi<{ accessToken: string; refreshToken: string }>(
      app,
      'POST',
      '/auth/refresh',
      { refreshToken },
    );
  }

  it('sesión válida → el OWNER revoca → un intento posterior de refresh falla (401)', async () => {
    const device = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Sesion-Valida',
    );

    const revokeRes = await callApi(
      app,
      'POST',
      `/members/${device.membershipId}/revoke-sessions`,
      {},
      tenant.accessToken,
    );
    expect(revokeRes.status).toBe(201);

    const afterRevoke = await refresh(device.refreshToken);
    expect(afterRevoke.status).toBe(401);
  });

  it('aislamiento entre usuarios: revocar la sesión de un miembro no afecta la sesión de otro miembro de la MISMA organización', async () => {
    const deviceA = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Usuario-A',
    );
    const deviceB = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Usuario-B',
    );

    await callApi(
      app,
      'POST',
      `/members/${deviceA.membershipId}/revoke-sessions`,
      {},
      tenant.accessToken,
    );

    const refreshA = await refresh(deviceA.refreshToken);
    expect(refreshA.status).toBe(401);

    const refreshB = await refresh(deviceB.refreshToken);
    expect(refreshB.status).toBe(201);
  });

  it('aislamiento entre tenants: el OWNER de una organización no puede revocar una membresía de OTRA organización (404)', async () => {
    const otherTenant = await registerTestOrg(app, 'Revoke-Sessions-OtherOrg');
    const foreignDevice = await createMemberSession(
      otherTenant.organizationId,
      'CASHIER',
      'Ajeno',
    );

    const res = await callApi(
      app,
      'POST',
      `/members/${foreignDevice.membershipId}/revoke-sessions`,
      {},
      tenant.accessToken, // token del OWNER de `tenant`, no de `otherTenant`
    );
    expect(res.status).toBe(404);

    // La sesión ajena sigue intacta: no se filtró ningún efecto entre tenants.
    const stillWorks = await refresh(foreignDevice.refreshToken);
    expect(stillWorks.status).toBe(201);
  });

  it('aislamiento entre tenants con un usuario compartido: revocar en la organización A no toca la sesión de ese MISMO usuario en la organización B', async () => {
    const orgB = await registerTestOrg(app, 'Revoke-Sessions-SharedUser-B');
    const tenantPrisma = app.get(TenantPrismaService);
    const prisma = app.get(PrismaService);
    const suffix = uniqueSuffix();
    const email = `compartido-${suffix}@example.test`;
    const password = 'Password123!';
    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Usuario Compartido',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    const membershipA = await tenantPrisma.run(
      tenant.organizationId,
      async (tx) => {
        const role = await tx.role.findFirstOrThrow({
          where: { organizationId: tenant.organizationId, key: 'CASHIER' },
        });
        const m = await tx.organizationUser.create({
          data: {
            organizationId: tenant.organizationId,
            userId: user.id,
            roleId: role.id,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
        return m.id;
      },
    );
    await tenantPrisma.run(orgB.organizationId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({
        where: { organizationId: orgB.organizationId, key: 'CASHIER' },
      });
      await tx.organizationUser.create({
        data: {
          organizationId: orgB.organizationId,
          userId: user.id,
          roleId: role.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    });

    // Dos sesiones DISTINTAS del MISMO usuario, una por organización —
    // login explícito con `organizationId` porque el usuario tiene 2+
    // membresías activas.
    const loginA = await callApi<{ refreshToken: string }>(
      app,
      'POST',
      '/auth/login',
      {
        email,
        password,
        organizationId: tenant.organizationId,
      },
    );
    const loginB = await callApi<{ refreshToken: string }>(
      app,
      'POST',
      '/auth/login',
      {
        email,
        password,
        organizationId: orgB.organizationId,
      },
    );
    expect(loginA.status).toBe(201);
    expect(loginB.status).toBe(201);

    // El OWNER de la organización A revoca las sesiones de este usuario EN A.
    const revokeRes = await callApi(
      app,
      'POST',
      `/members/${membershipA}/revoke-sessions`,
      {},
      tenant.accessToken,
    );
    expect(revokeRes.status).toBe(201);

    const refreshInA = await refresh(loginA.body.refreshToken);
    expect(refreshInA.status).toBe(401); // sesión de A: revocada

    const refreshInB = await refresh(loginB.body.refreshToken);
    expect(refreshInB.status).toBe(201); // sesión de B, mismo usuario: intacta
  });

  it('RBAC: un rol sin users.manage no puede revocar sesiones (403)', async () => {
    const device = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Objetivo-RBAC',
    );
    const lowPrivToken = await createUserWithRole(
      app,
      tenant.organizationId,
      'SALES',
    );

    const res = await callApi(
      app,
      'POST',
      `/members/${device.membershipId}/revoke-sessions`,
      {},
      lowPrivToken,
    );
    expect(res.status).toBe(403);

    // Nunca se aplicó: la sesión objetivo sigue funcionando.
    const stillWorks = await refresh(device.refreshToken);
    expect(stillWorks.status).toBe(201);
  });

  it('revocar dos veces es seguro (idempotente): la segunda vez no falla y no revoca nada de más', async () => {
    const device = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Doble-Revoke',
    );

    const first = await callApi<{ revokedCount: number }>(
      app,
      'POST',
      `/members/${device.membershipId}/revoke-sessions`,
      {},
      tenant.accessToken,
    );
    const second = await callApi<{ revokedCount: number }>(
      app,
      'POST',
      `/members/${device.membershipId}/revoke-sessions`,
      {},
      tenant.accessToken,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.revokedCount).toBeGreaterThan(0);
    expect(second.body.revokedCount).toBe(0); // ya no quedaba nada por revocar
  });

  it('suspender a un usuario también revoca sus sesiones activas en esta organización', async () => {
    const device = await createMemberSession(
      tenant.organizationId,
      'CASHIER',
      'Suspendido',
    );

    const suspendRes = await callApi(
      app,
      'PATCH',
      `/members/${device.membershipId}/suspend`,
      {},
      tenant.accessToken,
    );
    expect(suspendRes.status).toBe(200);

    const afterSuspend = await refresh(device.refreshToken);
    expect(afterSuspend.status).toBe(401);
  });
});
