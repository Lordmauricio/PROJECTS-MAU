import { env } from "../../../config/env";
import { MockSinClient } from "./mockSinClient";
import { SinProvider } from "./types";

let cached: SinProvider | null = null;

export function getSinProvider(): SinProvider {
  if (cached) return cached;

  if (env.sinProvider === "soap") {
    // TODO: implementar SoapSinClient contra los web services SOAP reales
    // del SIN (WSDL de Servicio de Facturacion Electronica) una vez que la
    // empresa tenga credenciales de Piloto/Produccion homologadas. Debe
    // implementar la interfaz SinProvider (obtenerCuis, obtenerCufd,
    // enviarFactura, anularFactura) usando SIN_WSDL_BASE_URL / SIN_API_KEY.
    throw new Error(
      "SIN_PROVIDER=soap todavia no esta implementado. Completa SoapSinClient en " +
        "src/modules/invoicing/sin/soapSinClient.ts con las credenciales homologadas del SIN, " +
        "o vuelve a SIN_PROVIDER=mock para seguir probando en ambiente simulado."
    );
  }

  cached = new MockSinClient();
  return cached;
}
