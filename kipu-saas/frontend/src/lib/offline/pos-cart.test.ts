import { describe, expect, it } from "vitest";
import { addToCart, computeCartTotals, removeCartLine, updateCartLine } from "./pos-cart";

const coca = { id: "prod-1", name: "Coca Cola 2L", price: "15.00" };
const pan = { id: "prod-2", name: "Pan", price: "2.50" };

describe("pos-cart — lógica pura del carrito (igual en online y offline)", () => {
  it("agregar un producto nuevo lo deja con cantidad 1", () => {
    const cart = addToCart([], coca);
    expect(cart).toEqual([
      { productId: "prod-1", name: "Coca Cola 2L", quantity: 1, unitPrice: 15, discount: 0 },
    ]);
  });

  it("agregar el mismo producto de nuevo incrementa la cantidad en vez de duplicar la línea", () => {
    let cart = addToCart([], coca);
    cart = addToCart(cart, coca);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  it("modificar cantidad/precio/descuento de una línea existente", () => {
    let cart = addToCart([], coca);
    cart = updateCartLine(cart, "prod-1", { quantity: 3, discount: 5 });
    expect(cart[0].quantity).toBe(3);
    expect(cart[0].discount).toBe(5);
    expect(cart[0].unitPrice).toBe(15); // no tocado, se conserva
  });

  it("eliminar una línea del carrito", () => {
    let cart = addToCart([], coca);
    cart = addToCart(cart, pan);
    cart = removeCartLine(cart, "prod-1");
    expect(cart).toHaveLength(1);
    expect(cart[0].productId).toBe("prod-2");
  });

  it("calcula subtotal y total (con descuento de línea y de venta)", () => {
    let cart = addToCart([], coca); // 15
    cart = updateCartLine(cart, "prod-1", { quantity: 2, discount: 3 }); // 2*15 - 3 = 27
    cart = addToCart(cart, pan); // + 2.5 = 29.5
    const totals = computeCartTotals(cart, 4.5); // descuento de venta
    expect(totals.subtotal).toBe(29.5);
    expect(totals.total).toBe(25);
  });

  it("el total nunca queda negativo aunque el descuento de venta supere el subtotal", () => {
    const cart = addToCart([], pan); // 2.5
    const totals = computeCartTotals(cart, 100);
    expect(totals.total).toBe(0);
  });
});
