/**
 * DECISIÓN DE CODIFICACIÓN DE TEXTO (V1) — documentada explícitamente,
 * nunca improvisada (instrucción del pedido).
 *
 * Un ticket puede contener tildes/ñ/símbolos (á, é, í, ó, ú, ñ, Bs.). Las
 * impresoras térmicas ESC/POS reales NO usan UTF-8 por default — cada
 * fabricante/firmware soporta un subconjunto de codepages de un solo byte
 * (CP437, CP850, CP1252, etc.), seleccionables con su propio comando
 * `ESC t n`. Mandar UTF-8 crudo a una impresora que espera CP437 no
 * produce un error: produce basura ilegible para cualquier carácter fuera
 * de ASCII. Asumir un codepage específico (ej. CP850, común en América
 * Latina) sería aventurado: todavía no se eligió ningún modelo de
 * impresora real (eso ocurre recién en Offline 4.6+, junto con el
 * transporte Bluetooth/USB real), así que no hay forma de confirmar hoy
 * cuál soporta el hardware que se termine usando.
 *
 * Por eso V1 NO intenta reproducir tildes/ñ con bytes de un codepage
 * específico — transcribe: quita diacríticos (á→a, ñ→n, é→e, ...) vía
 * normalización Unicode NFD + remoción de marcas combinantes, y cualquier
 * carácter que siga sin ser ASCII se reemplaza por "?". Nunca bytes
 * corruptos/ilegibles, siempre texto legible (aunque sin acentos). Se
 * abstrae detrás de `TextEncodingStrategy` a propósito: cuando se conozca
 * el codepage real del hardware elegido, se agrega una implementación
 * nueva (ej. `Cp850Encoding`) sin tocar `EscPosEncoder` en absoluto — es
 * exactamente el punto de la abstracción.
 */
export interface TextEncodingStrategy {
  /** Texto → bytes ya listos para mandar a la impresora (sin comandos ESC/POS, solo el contenido). */
  encode(text: string): number[];
}

const QUESTION_MARK = 63; // '?'
// Rango Unicode de "marcas combinantes" (acentos/diacríticos que quedan
// separados de su letra base tras normalizar en forma NFD, ej. "á" →
// "a" + U+0301 ACUTE ACCENT). Comparación numérica en vez de un literal
// de regex con caracteres combinantes incrustados en el código fuente —
// más explícito y sin ambigüedad de codificación del propio archivo.
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

export class AsciiFallbackEncoding implements TextEncodingStrategy {
  encode(text: string): number[] {
    const decomposed = text.normalize("NFD");
    const bytes: number[] = [];
    for (const ch of decomposed) {
      const code = ch.codePointAt(0) ?? QUESTION_MARK;
      if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) continue; // quita el acento, conserva la letra base ya emitida
      bytes.push(code <= 127 ? code : QUESTION_MARK);
    }
    return bytes;
  }
}
