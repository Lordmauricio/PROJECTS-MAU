import type { LocalOrgContext } from "../types";
import type { TicketMapperContext } from "./ticket-mapper";

/**
 * Arma el `TicketMapperContext` que `ticketFromLocalSale`/
 * `ticketFromReceiptSnapshot` (Offline 4.4) necesitan, a partir del
 * `LocalOrgContext` cacheado (Offline 4.5) — el punto de integración que
 * Offline 4.5 dejó explícitamente para "el día que un caller real lo
 * necesite" (ver `docs/architecture.md` sección 24). `ticket-mapper.ts`
 * sigue sin tocarse: sigue siendo puro, sin conocer Dexie ni
 * `LocalOrgContext` directamente — este archivo es el ÚNICO lugar que
 * traduce entre ambos, para que ningún caller futuro tenga que rearmar
 * este mapeo por su cuenta y arriesgarse a divergir.
 */
export function ticketContextFromOrgContext(
  ctx: LocalOrgContext,
  customer: TicketMapperContext["customer"],
  products: TicketMapperContext["products"],
): TicketMapperContext {
  return {
    organizationName: ctx.organizationName,
    businessLegalName: ctx.businessLegalName,
    businessNit: ctx.businessNit,
    businessAddress: ctx.businessAddress,
    businessPhone: ctx.businessPhone,
    branchName: ctx.branchName,
    posTerminalName: ctx.posTerminalName,
    posTerminalCode: ctx.posTerminalCode,
    cashierName: ctx.userName,
    customer,
    products,
  };
}
