import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const nit = "1234567019";
  const existing = await prisma.company.findUnique({ where: { nit } });
  if (existing) {
    console.log("La empresa demo ya existe, no se vuelve a sembrar.");
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: "Pollo Express La Paz",
      razonSocial: "Pollo Express La Paz S.R.L.",
      nit,
      email: "contacto@polloexpress.bo",
      phone: "22345678",
    },
  });

  const branch = await prisma.branch.create({
    data: {
      companyId: company.id,
      name: "Casa Matriz - Sopocachi",
      address: "Av. 20 de Octubre #2000",
      municipio: "La Paz",
      departamento: "La Paz",
      phone: "22345678",
      isMatriz: true,
    },
  });

  await prisma.fiscalConfig.create({
    data: {
      branchId: branch.id,
      nit,
      razonSocial: company.razonSocial,
      environment: "TEST",
      codigoSucursal: 0,
      codigoPuntoVenta: 0,
    },
  });

  await prisma.invoiceSequence.create({ data: { branchId: branch.id, lastNumber: 0 } });

  const passwordHash = await bcrypt.hash("Demo1234!", 10);
  await prisma.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      name: "Admin Demo",
      email: "admin@polloexpress.bo",
      passwordHash,
      role: "OWNER",
    },
  });

  const categoriasData = [
    { name: "Pollos Broaster", sortOrder: 1 },
    { name: "Hamburguesas", sortOrder: 2 },
    { name: "Acompañamientos", sortOrder: 3 },
    { name: "Bebidas", sortOrder: 4 },
  ];
  const categorias = [];
  for (const c of categoriasData) {
    categorias.push(await prisma.category.create({ data: { ...c, companyId: company.id } }));
  }

  const productos = [
    { name: "1/4 Pollo Broaster + Papas", price: 25, categoryId: categorias[0].id },
    { name: "1/2 Pollo Broaster + Papas", price: 45, categoryId: categorias[0].id },
    { name: "Pollo Entero + Papas", price: 85, categoryId: categorias[0].id },
    { name: "Hamburguesa Clásica", price: 22, categoryId: categorias[1].id },
    { name: "Hamburguesa Doble", price: 28, categoryId: categorias[1].id },
    { name: "Papas Fritas Grandes", price: 15, categoryId: categorias[2].id },
    { name: "Ensalada Coleslaw", price: 10, categoryId: categorias[2].id },
    { name: "Gaseosa 500ml", price: 8, categoryId: categorias[3].id },
    { name: "Jugo Natural", price: 10, categoryId: categorias[3].id },
  ];
  for (const p of productos) {
    await prisma.product.create({ data: { ...p, companyId: company.id } });
  }

  console.log("Seed completado.");
  console.log("Login demo -> email: admin@polloexpress.bo / password: Demo1234!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
