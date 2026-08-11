import QRCode from "qrcode";
import { env } from "../../../config/env";

// El QR de una factura electronica boliviana apunta a la pagina de
// verificacion del SIN, con la CUF y el NIT como parametros. La URL exacta
// de verificacion (produccion vs piloto) y el nombre de los query params
// deben confirmarse en el Anexo Tecnico vigente; se dejan como constantes
// derivadas de SIN_WSDL_BASE_URL para poder ajustarlas sin tocar el resto
// del codigo.
export function buildQrData(params: { nit: string; cuf: string }): string {
  const base = env.sinWsdlBaseUrl || "https://pilotosiat.impuestos.gob.bo";
  return `${base}/consulta/QR?nit=${params.nit}&cuf=${params.cuf}`;
}

export async function buildQrImageDataUrl(qrData: string): Promise<string> {
  return QRCode.toDataURL(qrData, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}
