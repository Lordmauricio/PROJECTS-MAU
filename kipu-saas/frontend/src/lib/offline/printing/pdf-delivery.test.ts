import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadPdfBytes, presentTicketPdf } from "./pdf-blob";

/**
 * Offline 4.14.4 — entrega del ticket PDF en Android y en escritorio.
 *
 * Estos tests fijan el CONTRATO de `presentTicketPdf`: qué camino elige según
 * las capacidades del dispositivo, y —sobre todo— que ninguno de ellos manda
 * el PDF a ningún lado. No pueden sustituir la prueba en un teléfono real
 * (Chrome Android decide por su cuenta qué hace con la hoja de compartir), y
 * por eso `docs/architecture.md` documenta el procedimiento manual: acá se
 * verifica la lógica, no el comportamiento del sistema operativo.
 */

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

type NavWithShare = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
};

let createdUrls: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  createdUrls = [];
  revoked = [];
  // jsdom no implementa la API de object URLs.
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    const url = `blob:ticket-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => {
    revoked.push(u);
  };
});

afterEach(() => {
  const nav = navigator as NavWithShare;
  delete nav.share;
  delete nav.canShare;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Simula un Android capaz de compartir archivos PDF. */
function givenAndroidShare(impl: (data: ShareData) => Promise<void>) {
  const nav = navigator as NavWithShare;
  nav.canShare = (data) => Boolean(data?.files?.length);
  nav.share = impl;
}

describe("presentTicketPdf — Android (Web Share API)", () => {
  it("comparte el PDF por la hoja del sistema en vez de abrir una pestaña", async () => {
    const shared: ShareData[] = [];
    givenAndroidShare(async (data) => {
      shared.push(data);
    });
    const openSpy = vi.spyOn(window, "open");

    const method = await presentTicketPdf(BYTES, "ticket-abc.pdf");

    expect(method).toBe("share");
    expect(openSpy).not.toHaveBeenCalled();
    expect(shared).toHaveLength(1);

    const file = shared[0].files![0];
    expect(file.name).toBe("ticket-abc.pdf");
    expect(file.type).toBe("application/pdf");
    // El contenido compartido es el PDF real generado offline, no una URL.
    expect(await file.text()).toBe("%PDF");
  });

  it("cancelar la hoja de compartir NO es un error y no abre nada más", async () => {
    givenAndroidShare(async () => {
      const err = new Error("El usuario canceló");
      err.name = "AbortError";
      throw err;
    });
    const openSpy = vi.spyOn(window, "open");

    expect(await presentTicketPdf(BYTES, "t.pdf")).toBe("cancelled");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("si se perdió la activación por gesto de usuario, cae a la pestaña en vez de dejar sin ticket", async () => {
    // Caso real: generar el PDF tarda (el import() dinámico de pdf-lib la
    // primera vez en un teléfono lento) y Chrome ya no considera vigente el
    // gesto que originó el click.
    givenAndroidShare(async () => {
      const err = new Error("permiso denegado");
      err.name = "NotAllowedError";
      throw err;
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    expect(await presentTicketPdf(BYTES, "t.pdf")).toBe("window");
    expect(openSpy).toHaveBeenCalledWith("blob:ticket-0", "_blank");
  });

  it("un navegador que comparte texto pero no archivos no se usa para el PDF", async () => {
    const nav = navigator as NavWithShare;
    nav.share = async () => {};
    nav.canShare = () => false; // soporta share, pero no ESTE archivo
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    expect(await presentTicketPdf(BYTES, "t.pdf")).toBe("window");
    expect(openSpy).toHaveBeenCalled();
  });

  it("un canShare que lanza se trata como 'no soportado', nunca rompe el ticket", async () => {
    const nav = navigator as NavWithShare;
    nav.share = async () => {};
    nav.canShare = () => {
      throw new Error("no implementado");
    };
    vi.spyOn(window, "open").mockReturnValue({} as Window);

    expect(await presentTicketPdf(BYTES, "t.pdf")).toBe("window");
  });
});

describe("presentTicketPdf — escritorio", () => {
  it("sin Web Share API abre la pestaña de siempre (comportamiento previo intacto)", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    expect(await presentTicketPdf(BYTES, "t.pdf")).toBe("window");
    expect(openSpy).toHaveBeenCalledWith("blob:ticket-0", "_blank");
  });

  it("si el navegador bloquea la ventana, descarga el archivo en vez de no hacer nada", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });

    expect(await presentTicketPdf(BYTES, "ticket-xyz.pdf")).toBe("download");
    expect(clicks).toEqual(["ticket-xyz.pdf"]);
  });
});

describe("downloadPdfBytes — el bug de Android que arregla esta fase", () => {
  it("NO libera el object URL en el mismo tick: eso abortaba la descarga en Android", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadPdfBytes(BYTES, "ticket.pdf");

    // Antes de Offline 4.14.4 acá ya había un revoke, y el navegador se
    // quedaba sin el blob antes de empezar a escribir el archivo.
    expect(revoked).toEqual([]);

    vi.advanceTimersByTime(2000);
    expect(revoked).toEqual(["blob:ticket-0"]);
  });

  it("deja el <a> fuera del documento tras usarlo", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadPdfBytes(BYTES, "ticket.pdf");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });
});

describe("El ticket nunca sale del dispositivo", () => {
  it("ningún camino de entrega hace una petición de red", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    givenAndroidShare(async () => {});
    await presentTicketPdf(BYTES, "t.pdf");

    delete (navigator as NavWithShare).canShare;
    delete (navigator as NavWithShare).share;
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    await presentTicketPdf(BYTES, "t.pdf");

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadPdfBytes(BYTES, "t.pdf");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
