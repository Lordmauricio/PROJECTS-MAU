// Catálogo global de permisos (tabla `permissions`, sin tenant). Se siembra
// una vez con `prisma/seed.ts`. Cada organización nueva clona un subconjunto
// de estos permisos en sus propios `roles` (ver DEFAULT_ROLE_PERMISSIONS
// abajo) — así cada tenant puede en el futuro editar sus propios roles sin
// afectar a otros tenants ni al catálogo global.

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
}

export const PERMISSIONS_CATALOG: PermissionDef[] = [
  // Organización / configuración
  { key: 'settings.update', module: 'organization', description: 'Editar datos de la empresa y configuración general' },
  { key: 'organization.branches.manage', module: 'organization', description: 'Crear y editar sucursales, almacenes y puntos de venta' },
  { key: 'users.manage', module: 'organization', description: 'Invitar usuarios y asignar roles' },
  { key: 'organization.roles.manage', module: 'organization', description: 'Crear/editar roles y sus permisos' },

  // Catálogo / inventario
  { key: 'products.create', module: 'catalog', description: 'Crear productos, categorías y unidades' },
  { key: 'products.update', module: 'catalog', description: 'Editar productos, categorías y unidades' },
  { key: 'products.read', module: 'catalog', description: 'Ver productos, categorías y unidades' },
  { key: 'inventory.manage', module: 'inventory', description: 'Registrar entradas, salidas, ajustes y transferencias de inventario' },
  { key: 'inventory.read', module: 'inventory', description: 'Ver stock y kardex' },

  // Terceros
  { key: 'customers.manage', module: 'customers', description: 'Crear y editar clientes' },
  { key: 'customers.read', module: 'customers', description: 'Ver clientes' },
  { key: 'suppliers.manage', module: 'suppliers', description: 'Crear y editar proveedores' },
  { key: 'suppliers.read', module: 'suppliers', description: 'Ver proveedores' },

  // Ventas / POS
  { key: 'sales.create', module: 'sales', description: 'Registrar ventas en el punto de venta' },
  { key: 'sales.read', module: 'sales', description: 'Ver ventas' },
  { key: 'sales.update', module: 'sales', description: 'Editar ventas no facturadas' },
  { key: 'sales.delete', module: 'sales', description: 'Eliminar/cancelar ventas' },

  // Compras
  { key: 'purchases.manage', module: 'purchases', description: 'Registrar y editar compras' },
  { key: 'purchases.read', module: 'purchases', description: 'Ver compras' },

  // Caja / gastos / cuentas
  { key: 'cash.manage', module: 'cash', description: 'Abrir/cerrar caja y registrar movimientos' },
  { key: 'expenses.manage', module: 'expenses', description: 'Registrar gastos' },
  { key: 'receivables.manage', module: 'finance', description: 'Gestionar cuentas por cobrar' },
  { key: 'payables.manage', module: 'finance', description: 'Gestionar cuentas por pagar' },

  // Facturación / fiscal
  { key: 'invoices.create', module: 'invoicing', description: 'Emitir facturas' },
  { key: 'invoices.read', module: 'invoicing', description: 'Ver facturas emitidas' },
  { key: 'invoices.cancel', module: 'invoicing', description: 'Anular facturas' },
  { key: 'fiscal.settings.manage', module: 'invoicing', description: 'Configurar datos fiscales / integración SIN' },

  // Reportes / auditoría
  { key: 'reports.read', module: 'reports', description: 'Ver y exportar reportes' },
  { key: 'audit.read', module: 'audit', description: 'Ver el log de auditoría' },
];

// Roles iniciales exactos del prompt (Parte 1, sección 4).
export const DEFAULT_ROLE_KEYS = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'INVENTORY',
  'SALES',
  'AUDITOR',
] as const;

export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number];

const ALL_PERMISSION_KEYS = PERMISSIONS_CATALOG.map((p) => p.key);
const READ_ONLY_PERMISSION_KEYS = PERMISSIONS_CATALOG.filter((p) =>
  p.key.endsWith('.read'),
).map((p) => p.key);

// Qué permisos trae cada rol por defecto al crear una organización nueva.
export const DEFAULT_ROLE_PERMISSIONS: Record<DefaultRoleKey, string[]> = {
  OWNER: ALL_PERMISSION_KEYS,
  ADMIN: ALL_PERMISSION_KEYS,
  MANAGER: [
    'products.create', 'products.update', 'products.read',
    'inventory.manage', 'inventory.read',
    'customers.manage', 'customers.read',
    'suppliers.manage', 'suppliers.read',
    'sales.create', 'sales.read', 'sales.update', 'sales.delete',
    'purchases.manage', 'purchases.read',
    'cash.manage', 'expenses.manage',
    'invoices.create', 'invoices.read', 'invoices.cancel',
    'reports.read',
  ],
  ACCOUNTANT: [
    'reports.read',
    'receivables.manage', 'payables.manage',
    'expenses.manage',
    'invoices.read', 'invoices.cancel',
    'purchases.read',
    'audit.read',
  ],
  CASHIER: [
    'sales.create', 'sales.read',
    'cash.manage',
    'invoices.create', 'invoices.read',
    'customers.read', 'customers.manage',
    'products.read',
  ],
  INVENTORY: [
    'products.create', 'products.update', 'products.read',
    'inventory.manage', 'inventory.read',
    'suppliers.read',
    'purchases.read',
  ],
  SALES: [
    'sales.create', 'sales.read',
    'customers.manage', 'customers.read',
    'products.read',
    'invoices.create', 'invoices.read',
  ],
  // .read ya cubre reports.read y audit.read; no duplicar (produce
  // violacion de unique constraint al sembrar).
  AUDITOR: READ_ONLY_PERMISSION_KEYS,
};

export const DEFAULT_ROLE_NAMES: Record<DefaultRoleKey, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  ACCOUNTANT: 'Contador',
  CASHIER: 'Cajero',
  INVENTORY: 'Inventario',
  SALES: 'Ventas',
  AUDITOR: 'Auditor',
};
