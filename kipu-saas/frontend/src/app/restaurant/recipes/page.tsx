"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useRecordedAction } from "@/lib/use-recorded-action";
import { bolivianos, businessTime, control, primary } from "@/lib/restaurant";
interface Product {
  id: string;
  name: string;
  cost: string;
  unit?: { symbol: string } | null;
}
interface Ingredient {
  productId: string;
  name: string;
  inputUnit: string;
  quantity: string;
  toBaseFactor: string;
  baseUnit: string;
  baseQuantity: string;
  unitCost: string;
}
interface Version {
  id: string;
  revision: number;
  name: string;
  station: string;
  outputProductId: string;
  outputName: string;
  outputUnit: string;
  yieldQuantity: string;
  ingredients: Ingredient[];
  theoreticalCost: string;
}
interface Recipe {
  id: string;
  name: string;
  revision: number;
  versions: Version[];
}
interface Run {
  id: string;
  name: string;
  warehouseId: string;
  station: string;
  status: string;
  version: number;
  plannedQuantity: string;
  producedQuantity: string | null;
  outputUnit: string;
  expectedInputs: Ingredient[];
  actualInputs: Ingredient[] | null;
  theoreticalCost: string;
  actualCost: string | null;
  costPerUnit: string | null;
  cancelReason: string | null;
  createdAt: string;
  recipeVersion: { revision: number };
}
interface Branch {
  id: string;
  name: string;
  warehouses: { id: string; name: string }[];
}
const blankIngredient = () => ({
  productId: "",
  quantity: "1",
  inputUnit: "u",
  toBaseFactor: "1",
});
export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [branches, setBranches] = useState<Branch[]>([]);
  const [edit, setEdit] = useState(""),
    [name, setName] = useState(""),
    [station, setStation] = useState("Cocina"),
    [output, setOutput] = useState(""),
    [yieldQty, setYield] = useState("1"),
    [ingredients, setIngredients] = useState([blankIngredient()]);
  const [versionId, setVersion] = useState(""),
    [warehouse, setWarehouse] = useState(""),
    [planned, setPlanned] = useState("1");
  const [actual, setActual] = useState<Record<string, string>>({}),
    [produced, setProduced] = useState<Record<string, string>>({}),
    [lotCodes, setLotCodes] = useState<Record<string, string>>({}),
    [expiry, setExpiry] = useState<Record<string, string>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      Promise.all([
        api<Recipe[]>("/restaurant/recipes"),
        api<Run[]>("/restaurant/recipes/runs"),
        api<Product[]>("/products"),
        api<Branch[]>("/branches"),
      ]),
    [],
  );
  const receive = useCallback(
    ([r, run, p, b]: Awaited<ReturnType<typeof load>>) => {
      setRecipes(r);
      setRuns(run);
      setProducts(p);
      setBranches(b);
      setWarehouse((w) => w || b[0]?.warehouses[0]?.id || "");
    },
    [],
  );
  const {
    reload,
    loading,
    error: loadError,
  } = useRemoteLoad(load, receive, "No se pudieron cargar las recetas");
  const action = useRecordedAction(reload);
  function selectRecipe(id: string) {
    setEdit(id);
    const v = recipes.find((r) => r.id === id)?.versions[0];
    setName(v?.name || "");
    setStation(v?.station || "Cocina");
    setOutput(v?.outputProductId || "");
    setYield(v?.yieldQuantity || "1");
    setIngredients(
      v
        ? v.ingredients.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            inputUnit: i.inputUnit,
            toBaseFactor: i.toBaseFactor,
          }))
        : [blankIngredient()],
    );
  }
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Recetas y rendimientos</h1>
            <p className="text-sm text-zinc-600">
              Ingredientes, versiones y producción real · costos de referencia
              en Bs
            </p>
          </div>
          <Link className={control} href="/inventory/control">
            Lotes y stock
          </Link>
        </header>
        {(action.error || loadError) && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
            {action.error || loadError}
          </p>
        )}
        {action.notice && <p role="status">{action.notice}</p>}
        {action.uncertain && (
          <aside className="rounded-xl bg-amber-50 p-4">
            Respuesta incierta. Mantén la pestaña abierta y reintenta la misma
            solicitud.
            <button className={primary} onClick={() => void action.retry()}>
              Reintentar operación
            </button>
          </aside>
        )}
        <button className={control} disabled={action.busy} onClick={reload}>
          Actualizar recetas
        </button>
        {loading && <p role="status">Cargando…</p>}
        <form
          className="rounded-2xl border bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              `/restaurant/recipes${edit ? `/${edit}` : ""}`,
              {
                name,
                station,
                outputProductId: output,
                yieldQuantity: Number(yieldQty),
                ingredients: ingredients.map((i) => ({
                  ...i,
                  quantity: Number(i.quantity),
                  toBaseFactor: Number(i.toBaseFactor),
                })),
                ...(edit
                  ? {
                      expectedRevision: recipes.find((r) => r.id === edit)!
                        .revision,
                    }
                  : {}),
                requestKey: crypto.randomUUID(),
              },
              edit ? "PATCH" : "POST",
            );
          }}
        >
          <h2 className="mb-3 text-lg font-semibold">Publicar receta</h2>
          <fieldset disabled={action.busy} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Receta a editar
                <select
                  className={`${control} block w-full`}
                  value={edit}
                  onChange={(e) => selectRecipe(e.target.value)}
                >
                  <option value="">Nueva receta</option>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · v{r.revision}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nombre de receta
                <input
                  className={`${control} block w-full`}
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Estación
                <input
                  className={`${control} block w-full`}
                  required
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                />
              </label>
              <label>
                Producto preparado
                <select
                  className={`${control} block w-full`}
                  required
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                >
                  <option value="">Selecciona producto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit?.symbol || "u"})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rendimiento esperado
                <input
                  className={`${control} block w-full`}
                  type="number"
                  min="0.01"
                  max="10000"
                  step="0.01"
                  required
                  value={yieldQty}
                  onChange={(e) => setYield(e.target.value)}
                />
              </label>
            </div>
            <p className="text-sm">
              El factor indica cuántas unidades base contiene una unidad
              ingresada. Ejemplo: 1000 g × 0.001 = 1 kg. La cantidad de stock
              debe poder representarse con dos decimales.
            </p>
            {ingredients.map((i, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-5"
              >
                {["productId", "quantity", "inputUnit", "toBaseFactor"].map(
                  (key, n) => (
                    <label key={key} className="text-sm">
                      {
                        [
                          "Ingrediente",
                          "Cantidad de receta",
                          "Unidad ingresada",
                          "Factor a unidad base",
                        ][n]
                      }{" "}
                      {index + 1}
                      {key === "productId" ? (
                        <select
                          className={`${control} block w-full`}
                          required
                          value={i.productId}
                          onChange={(e) => {
                            const p = products.find(
                              (p) => p.id === e.target.value,
                            );
                            setIngredients((v) =>
                              v.map((row, j) =>
                                j === index
                                  ? {
                                      ...row,
                                      productId: e.target.value,
                                      inputUnit: p?.unit?.symbol || "u",
                                      toBaseFactor: "1",
                                    }
                                  : row,
                              ),
                            );
                          }}
                        >
                          <option value="">Selecciona</option>
                          {products
                            .filter((p) => p.id !== output)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.unit?.symbol || "u"})
                              </option>
                            ))}
                        </select>
                      ) : (
                        <input
                          className={`${control} block w-full`}
                          required
                          type={key === "inputUnit" ? "text" : "number"}
                          min={key === "toBaseFactor" ? "0.000001" : "0.0001"}
                          step={key === "toBaseFactor" ? "0.000001" : "0.0001"}
                          value={i[key as keyof typeof i]}
                          onChange={(e) =>
                            setIngredients((v) =>
                              v.map((row, j) =>
                                j === index
                                  ? { ...row, [key]: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      )}
                    </label>
                  ),
                )}
                <button
                  type="button"
                  className={control}
                  disabled={ingredients.length === 1}
                  onClick={() =>
                    setIngredients((v) => v.filter((_, j) => j !== index))
                  }
                >
                  Quitar ingrediente {index + 1}
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={control}
                onClick={() => setIngredients((v) => [...v, blankIngredient()])}
                disabled={ingredients.length >= 50}
              >
                Agregar ingrediente
              </button>
              <button className={primary}>Publicar versión</button>
            </div>
          </fieldset>
        </form>
        <section className="space-y-3" aria-label="Historial de recetas">
          {recipes.map((r) => (
            <details key={r.id} className="rounded-xl border p-4">
              <summary>
                {r.name} · versión vigente {r.revision}
              </summary>
              {r.versions.map((v) => (
                <div className="mt-3 border-t pt-3" key={v.id}>
                  <h3 className="font-semibold">
                    Versión {v.revision} · {v.yieldQuantity} {v.outputUnit} de{" "}
                    {v.outputName}
                  </h3>
                  {v.ingredients.map((i) => (
                    <p className="text-sm" key={i.productId}>
                      {i.name}: {Number(i.quantity)} {i.inputUnit} ×{" "}
                      {Number(i.toBaseFactor)} = {i.baseQuantity} {i.baseUnit}
                    </p>
                  ))}
                  <p>
                    Costo de referencia de versión:{" "}
                    {bolivianos(v.theoreticalCost)}
                  </p>
                </div>
              ))}
            </details>
          ))}
        </section>
        <form
          className="rounded-2xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run("/restaurant/recipes/runs", {
              versionId,
              warehouseId: warehouse,
              plannedQuantity: Number(planned),
              requestKey: crypto.randomUUID(),
            });
          }}
        >
          <h2 className="mb-3 text-lg font-semibold">Planificar producción</h2>
          <fieldset
            disabled={action.busy}
            className="grid gap-3 sm:grid-cols-3"
          >
            <label>
              Versión de receta
              <select
                required
                className={`${control} block w-full`}
                value={versionId}
                onChange={(e) => setVersion(e.target.value)}
              >
                <option value="">Selecciona vigente</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.versions[0].id}>
                    {r.name} · v{r.revision}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Almacén de producción
              <select
                className={`${control} block w-full`}
                required
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                {branches.flatMap((b) =>
                  b.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {b.name} · {w.name}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label>
              Cantidad preparada prevista
              <input
                className={`${control} block w-full`}
                type="number"
                required
                min="0.01"
                max="10000"
                step="0.01"
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
              />
            </label>
            <button className={primary}>Planificar receta</button>
          </fieldset>
        </form>
        <section className="space-y-4" aria-label="Producciones de recetas">
          {runs.map((r) => (
            <article
              key={r.id}
              aria-label={`Producción ${r.name} ${r.id.slice(-6)}`}
              className="rounded-2xl border p-4"
            >
              <h2 className="text-lg font-semibold">
                {r.name} · v{r.recipeVersion.revision}
              </h2>
              <p>
                {
                  (
                    {
                      DRAFT: "Planificada",
                      PREPARING: "En preparación",
                      READY: "Completada",
                      CANCELLED: "Cancelada",
                    } as Record<string, string>
                  )[r.status]
                }{" "}
                · {r.station} · {businessTime(r.createdAt)}
              </p>
              <p>
                Previsto {r.plannedQuantity} {r.outputUnit}
                {r.producedQuantity
                  ? ` · Real ${r.producedQuantity} ${r.outputUnit} · Rendimiento ${((Number(r.producedQuantity) / Number(r.plannedQuantity)) * 100).toFixed(1)}%`
                  : ""}
              </p>
              <p>
                Costo teórico {bolivianos(r.theoreticalCost)}
                {r.actualCost !== null
                  ? ` · Consumo real ${bolivianos(r.actualCost)} · Variación ${bolivianos(Number(r.actualCost) - Number(r.theoreticalCost))}`
                  : ""}
              </p>
              {r.costPerUnit && (
                <p>
                  Costo por unidad producida: Bs{" "}
                  {Number(r.costPerUnit).toFixed(4)}
                </p>
              )}
              <fieldset disabled={action.busy} className="mt-3 space-y-3">
                {r.status === "DRAFT" && (
                  <>
                    <p className="text-sm">
                      Consumo real al iniciar, en unidad base (sin reservas
                      previas):
                    </p>
                    {r.expectedInputs.map((i) => (
                      <label className="block text-sm" key={i.productId}>
                        {i.name} ({i.baseUnit})
                        <input
                          aria-label={`Consumo ${i.name}`}
                          className={`${control} ml-2 max-w-full`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={actual[r.id + i.productId] ?? i.baseQuantity}
                          onChange={(e) =>
                            setActual((v) => ({
                              ...v,
                              [r.id + i.productId]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                    <button
                      className={primary}
                      onClick={() =>
                        void action.run(
                          `/restaurant/recipes/runs/${r.id}/status`,
                          {
                            version: r.version,
                            status: "PREPARING",
                            actualInputs: r.expectedInputs.map((i) => ({
                              productId: i.productId,
                              quantity: Number(
                                actual[r.id + i.productId] ?? i.baseQuantity,
                              ),
                            })),
                          },
                        )
                      }
                    >
                      Iniciar receta
                    </button>
                  </>
                )}
                {r.status === "PREPARING" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label>
                      Producción real
                      <input
                        className={`${control} block w-full`}
                        type="number"
                        min="0.01"
                        max="10000"
                        step="0.01"
                        value={produced[r.id] ?? r.plannedQuantity}
                        onChange={(e) =>
                          setProduced((v) => ({ ...v, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Lote preparado
                      <input
                        className={`${control} block w-full`}
                        maxLength={100}
                        value={lotCodes[r.id] ?? ""}
                        onChange={(e) =>
                          setLotCodes((v) => ({ ...v, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Vencimiento preparado
                      <input
                        className={`${control} block w-full`}
                        type="date"
                        value={expiry[r.id] ?? ""}
                        onChange={(e) =>
                          setExpiry((v) => ({ ...v, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className={primary}
                      onClick={() =>
                        void action.run(
                          `/restaurant/recipes/runs/${r.id}/status`,
                          {
                            version: r.version,
                            status: "READY",
                            producedQuantity: Number(
                              produced[r.id] ?? r.plannedQuantity,
                            ),
                            ...(lotCodes[r.id]
                              ? {
                                  lotCode: lotCodes[r.id],
                                  ...(expiry[r.id]
                                    ? { expiresOn: expiry[r.id] }
                                    : {}),
                                }
                              : {}),
                          },
                        )
                      }
                    >
                      Completar receta
                    </button>
                  </div>
                )}
                {["DRAFT", "PREPARING"].includes(r.status) && (
                  <div className="flex flex-wrap gap-2">
                    <label>
                      Motivo de cancelación
                      <input
                        className={`${control} ml-2 max-w-full`}
                        value={reasons[r.id] ?? ""}
                        onChange={(e) =>
                          setReasons((v) => ({ ...v, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className={control}
                      disabled={!reasons[r.id]?.trim()}
                      onClick={() =>
                        void action.run(
                          `/restaurant/recipes/runs/${r.id}/status`,
                          {
                            version: r.version,
                            status: "CANCELLED",
                            reason: reasons[r.id],
                          },
                        )
                      }
                    >
                      Cancelar receta
                    </button>
                  </div>
                )}
                {r.cancelReason && (
                  <p>
                    Cancelada: {r.cancelReason}. No se restaura materia prima
                    consumida.
                  </p>
                )}
              </fieldset>
            </article>
          ))}
        </section>
        <p className="text-sm text-zinc-600">
          Los costos usan precios de referencia congelados al planificar; no
          incluyen mano de obra ni costeo contable por lote. Las preparaciones
          intermedias se producen por separado y se consumen como productos
          preparados.
        </p>
      </main>
    </AppShell>
  );
}
