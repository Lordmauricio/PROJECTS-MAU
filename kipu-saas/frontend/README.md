# Frontend de KIPU

Next.js 16 y React 19. La adaptación gastronómica para restaurantes y pollerías
está documentada en [el plan](../docs/RESTAURANT_ROADMAP.md). Requiere Node 22+;
los comandos de esta entrega se verificaron con Node 24.

## Desarrollo

Desde esta carpeta, ejecutar `npm ci`, copiar `.env.local.example` a `.env.local`
solo si no existe, y arrancar con `npm run dev`. La API se configura mediante
`NEXT_PUBLIC_API_URL`; el backend y su base de datos se preparan según el README
principal. La tipografía usa fuentes del sistema y no requiere Google Fonts.

## Validación

```bash
npm run lint
npm run test:unit
npm run build
```

Las pruebas unitarias comprueban recuperación y sincronización de sesiones,
respuestas fuera de orden, errores de red y cancelación al desmontar pantallas.

## Pruebas de navegador

```bash
npx playwright install chromium
npm run test:browser
```

Si Chromium ya está instalado, evitar la descarga y seleccionar su ejecutable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

Playwright inicia su propio servidor de desarrollo en el puerto 3100. Las pruebas
usan respuestas simuladas de la API para probar la interfaz de manera reproducible;
no validan transacciones reales ni aislamiento entre empresas. No ejecutar build y
servidores de desarrollo sobre el mismo checkout al mismo tiempo. Las capturas y
resultados de Playwright están ignorados en Git.

Los fetchers y callbacks de `useRemoteLoad` deben ser estables mediante
`useCallback`. El hook vuelve a cargar al cambiar sus dependencias, conserva los
mensajes de error y descarta respuestas obsoletas o posteriores al desmontaje.
