# Informe de etapa 2 — experiencia visual

Fecha: 4 de noviembre de 2026, horario de Bolivia.

**Estado: entrega técnica implementada; validación de campo pendiente.**

## Cambios

- Tablas administrativas desplazables por teclado y tacto, sin ensanchar la
  página en móvil. Aplicado a clientes, productos, inventario, compras, ventas,
  caja, cuentas y reportes.
- Formularios adaptables y etiquetas persistentes en datos maestros, caja,
  configuración y usuarios. Controles de al menos 44 px de alto.
- Menú móvil con control del foco, Escape, fondo inerte y devolución del foco;
  cierre al pasar a escritorio, indicador de página actual y salto al contenido.
- Inicio con accesos a caja gastronómica, cocina y arqueo; estados diferenciados
  de carga, error recuperable y falta de actividad.
- Reportes adaptados a móvil mediante selector de tipo y filtros etiquetados.
- Tema claro consistente, colores de texto secundarios con mayor contraste,
  foco visible y respeto a la preferencia de movimiento reducido.

## Resultados y correcciones

- Compilación de producción y TypeScript aprobados; ESLint sin incidencias.
- 11 pruebas unitarias del frontend aprobadas.
- 14 casos de navegador: seis de experiencia visual y ocho regresiones previas.
- Tres recorridos con API/PostgreSQL/Redis reales: flujo comercial completo,
  combo/cobro/cocina y revisión de ocho pantallas administrativas en móvil.
- Se corrigió el desborde del panel de Reportes y la interferencia del indicador
  de desarrollo de Next.js con el botón del menú móvil.
- Capturas revisadas de Inicio, clientes y productos en móvil. Las pruebas
  comprueban desplazamiento, foco, etiquetas y ausencia de desborde horizontal.

El backend no se modificó en esta etapa. Sus 322 pruebas aprobadas corresponden
a la entrega anterior; los recorridos reales volvieron a comprobar su integración.
Las pruebas simuladas de interfaz no sustituyen los recorridos reales.

## Pendientes y siguiente paso

La prueba presencial con cajero y encargado aún no se ha realizado. El protocolo
está en `EXPERIENCIA_VISUAL.md`. La aprobación técnica no cierra esa validación ni
equivale a una auditoría completa de accesibilidad.

El proyecto conserva la etapa 1 validada localmente y el núcleo de menú/caja/cocina
implementado. El siguiente paso de esta etapa es ejecutar el protocolo de campo,
corregir los problemas observados y registrar los resultados antes de declararla
cerrada por completo. Las ampliaciones de las demás etapas permanecen en el roadmap.

## Entrega

Código, pruebas y documentación se entregan juntos mediante commit y git push a
la rama de trabajo. El informe del chat comunica el SHA y el enlace remoto una
vez verificados. No se desplegó a producción ni se habilitó operación offline.

Esta entrega modifica frontend y documentación; no agrega migraciones ni cambia
APIs. Para desplegarla se requiere el backend gastronómico de `668b101` o posterior
y reconstruir el frontend con `NEXT_PUBLIC_API_URL` apuntando a ese backend.
