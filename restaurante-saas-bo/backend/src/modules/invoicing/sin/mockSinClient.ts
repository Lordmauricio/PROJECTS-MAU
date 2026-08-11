import crypto from "crypto";
import { CufdResult, CuisResult, FiscalIdentity, SendInvoiceResult, SinProvider } from "./types";

// Cliente simulado: se usa mientras la empresa NO tiene credenciales reales
// del SIN. Genera codigos con la MISMA FORMA que los reales (para poder
// probar todo el flujo de principio a fin) pero no llama a ningun servicio
// externo ni tiene validez fiscal. Cuando el SIN homologue el sistema,
// implementar SoapSinClient contra sus web services reales y cambiar
// SIN_PROVIDER=soap en el .env; el resto del sistema no cambia porque
// ambos implementan la misma interfaz SinProvider.
export class MockSinClient implements SinProvider {
  async obtenerCuis(identity: FiscalIdentity): Promise<CuisResult> {
    const cuis = `SIM-CUIS-${identity.nit}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const fechaVigencia = new Date();
    fechaVigencia.setFullYear(fechaVigencia.getFullYear() + 1);
    return { cuis, fechaVigencia };
  }

  async obtenerCufd(_identity: FiscalIdentity, cuis: string): Promise<CufdResult> {
    const codigoControl = crypto.randomBytes(3).toString("hex").toUpperCase();
    const cufd = `SIM-CUFD-${cuis.slice(-8)}-${codigoControl}`;
    const fechaVigencia = new Date();
    fechaVigencia.setHours(fechaVigencia.getHours() + 24);
    return { cufd, codigoControl, fechaVigencia };
  }

  async enviarFactura(_xml: string): Promise<SendInvoiceResult> {
    return {
      aceptada: true,
      codigoRecepcion: `SIM-REC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    };
  }

  async anularFactura(_cuf: string, _motivo: string): Promise<SendInvoiceResult> {
    return { aceptada: true };
  }
}
