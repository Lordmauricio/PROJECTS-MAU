"use client";
import { useCallback, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import {
  bolivianos,
  control,
  primary,
  menuTitle,
  type Component,
  type MenuEntry,
  type MenuOption,
} from "@/lib/restaurant";

interface Product {
  id: string;
  name: string;
  price: string;
}
const blank = {
  productId: "",
  name: "",
  presentation: "",
  category: "",
  station: "Cocina",
  price: "0",
  active: true,
  components: [] as Component[],
  options: [] as MenuOption[],
};

export default function MenuPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fetchData = useCallback(
    () =>
      Promise.all([
        api<Product[]>("/products"),
        api<MenuEntry[]>("/restaurant/menu"),
      ]),
    [],
  );
  const receive = useCallback(
    ([p, m]: Awaited<ReturnType<typeof fetchData>>) => {
      setProducts(p);
      setEntries(m);
    },
    [],
  );
  const {
    loading,
    error: loadError,
    reload,
  } = useRemoteLoad(fetchData, receive, "No se pudo cargar el menú");
  const { submitting, onSubmit } = useSubmitGuard(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setNotice(null);
      try {
        await api(
          editing ? `/restaurant/menu/${editing}` : "/restaurant/menu",
          {
            method: editing ? "PATCH" : "POST",
            body: { ...form, price: Number(form.price) },
          },
        );
        setNotice(
          editing
            ? "Plato actualizado. Los pedidos existentes conservan su composición y precio."
            : "Plato agregado al menú.",
        );
        setForm(blank);
        setEditing(null);
        await reload();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "No se pudo guardar el plato",
        );
      }
    },
  );
  function edit(entry: MenuEntry) {
    setEditing(entry.id);
    setForm({
      productId: entry.productId,
      name: entry.name,
      presentation: entry.presentation ?? "",
      category: entry.category,
      station: entry.station,
      price: entry.price,
      active: entry.active,
      components: entry.components,
      options: entry.options,
    });
    setNotice(null);
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
            Restaurante · Catálogo
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Menú y combos</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Define qué se vende, qué consume del almacén y qué opciones puede
            elegir el cliente.
          </p>
        </header>
        {loadError && (
          <p role="alert">
            {loadError}{" "}
            <button onClick={() => void reload()}>Reintentar</button>
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 p-4 text-emerald-900"
          >
            {notice}
          </p>
        )}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <section className="space-y-3" aria-label="Platos del menú">
            {loading && <p role="status">Cargando menú…</p>}
            {!loading && !entries.length && (
              <div className="rounded-2xl border border-dashed border-zinc-300 p-8">
                <h2 className="font-semibold">Tu menú empieza aquí</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  Crea los productos en Inventario y compón tu primer plato o
                  combo.
                </p>
              </div>
            )}
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-5"
              >
                <div>
                  <p className="text-xs text-zinc-500">
                    {entry.category} · {entry.station}
                  </p>
                  <h2 className="font-semibold">{menuTitle(entry)}</h2>
                  <p className="mt-1 text-sm">
                    {bolivianos(entry.price)} · {entry.components.length}{" "}
                    componentes · {entry.active ? "Visible" : "Pausado"}
                  </p>
                </div>
                <button
                  className={control}
                  onClick={() => edit(entry)}
                  aria-label={`Editar ${menuTitle(entry)}`}
                >
                  Editar
                </button>
              </article>
            ))}
          </section>
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5"
          >
            <h2 className="text-lg font-semibold">
              {editing ? "Editar plato" : "Nuevo plato o combo"}
            </h2>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <fieldset
              disabled={submitting}
              className="space-y-4 disabled:opacity-60"
            >
              <label className="block text-sm">
                Producto de venta
                <select
                  required
                  className={`${control} mt-1 w-full`}
                  value={form.productId}
                  onChange={(e) => {
                    const product = products.find(
                      (p) => p.id === e.target.value,
                    );
                    setForm((f) => ({
                      ...f,
                      productId: e.target.value,
                      name: f.name || product?.name || "",
                      price: product?.price || f.price,
                      components: f.components.length
                        ? f.components
                        : [{ productId: e.target.value, quantity: 1 }],
                    }));
                  }}
                >
                  <option value="">Selecciona un producto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Nombre del plato
                <input
                  required
                  maxLength={100}
                  className={`${control} mt-1 w-full`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Presentación (opcional)
                <input
                  maxLength={60}
                  className={`${control} mt-1 w-full`}
                  placeholder="Ej. cuarto, medio o entero"
                  value={form.presentation}
                  onChange={(e) =>
                    setForm({ ...form, presentation: e.target.value })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Categoría
                  <input
                    required
                    className={`${control} mt-1 w-full`}
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Estación
                  <input
                    required
                    className={`${control} mt-1 w-full`}
                    value={form.station}
                    onChange={(e) =>
                      setForm({ ...form, station: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="block text-sm">
                Precio en Bs
                <input
                  required
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  className={`${control} mt-1 w-full`}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-semibold">
                  Componentes por unidad vendida
                </legend>
                <p className="text-xs text-zinc-500">
                  Se descontarán al cobrar. Una porción puede consumir, por
                  ejemplo, 0.25 unidades de pollo.
                </p>
                <Components
                  products={products}
                  value={form.components}
                  onChange={(components) => setForm({ ...form, components })}
                />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold">
                  Extras y sustituciones
                </legend>
                {form.options.map((option, i) => (
                  <section
                    key={option.id}
                    className="space-y-3 rounded-xl bg-zinc-50 p-3"
                    aria-label={`Opción ${i + 1}`}
                  >
                    <label className="block text-sm">
                      Nombre de la opción
                      <input
                        required
                        className={`${control} mt-1 w-full`}
                        value={option.name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            options: form.options.map((o, j) =>
                              j === i ? { ...o, name: e.target.value } : o,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      Precio adicional en Bs
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${control} mt-1 w-full`}
                        value={option.price}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            options: form.options.map((o, j) =>
                              j === i
                                ? { ...o, price: Number(e.target.value) }
                                : o,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      Reemplaza
                      <select
                        className={`${control} mt-1 w-full`}
                        value={option.replacesProductId || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            options: form.options.map((o, j) =>
                              j === i
                                ? {
                                    ...o,
                                    replacesProductId:
                                      e.target.value || undefined,
                                  }
                                : o,
                            ),
                          })
                        }
                      >
                        <option value="">Nada (extra)</option>
                        {form.components.map((c) => (
                          <option key={c.productId} value={c.productId}>
                            {products.find((p) => p.id === c.productId)?.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Components
                      products={products}
                      value={option.components}
                      onChange={(components) =>
                        setForm({
                          ...form,
                          options: form.options.map((o, j) =>
                            j === i ? { ...o, components } : o,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="min-h-11 text-sm text-red-700"
                      onClick={() =>
                        setForm({
                          ...form,
                          options: form.options.filter((_, j) => j !== i),
                        })
                      }
                    >
                      Quitar opción
                    </button>
                  </section>
                ))}
                <button
                  type="button"
                  className={control}
                  onClick={() =>
                    setForm({
                      ...form,
                      options: [
                        ...form.options,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          price: 0,
                          components: [],
                        },
                      ],
                    })
                  }
                >
                  Agregar opción
                </button>
              </fieldset>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                Visible en caja
              </label>
              <div className="flex gap-3">
                <button disabled={!products.length} className={primary}>
                  {submitting ? "Guardando…" : "Guardar plato"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className={control}
                    onClick={() => {
                      setEditing(null);
                      setForm(blank);
                    }}
                  >
                    Cancelar edición
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </AppShell>
  );
}

function Components({
  products,
  value,
  onChange,
}: {
  products: Product[];
  value: Component[];
  onChange: (value: Component[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((component, index) => (
        <div className="flex gap-2" key={index}>
          <select
            aria-label={`Producto componente ${index + 1}`}
            required
            className={`${control} min-w-0 flex-1`}
            value={component.productId}
            onChange={(e) =>
              onChange(
                value.map((c, i) =>
                  i === index ? { ...c, productId: e.target.value } : c,
                ),
              )
            }
          >
            <option value="">Producto</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            aria-label={`Cantidad componente ${index + 1}`}
            required
            type="number"
            min="0.01"
            step="0.01"
            className={`${control} w-24`}
            value={component.quantity}
            onChange={(e) =>
              onChange(
                value.map((c, i) =>
                  i === index ? { ...c, quantity: Number(e.target.value) } : c,
                ),
              )
            }
          />
          <button
            type="button"
            aria-label={`Quitar componente ${index + 1}`}
            className={`${control} text-red-700`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={control}
        onClick={() => onChange([...value, { productId: "", quantity: 1 }])}
      >
        Agregar componente
      </button>
    </div>
  );
}
