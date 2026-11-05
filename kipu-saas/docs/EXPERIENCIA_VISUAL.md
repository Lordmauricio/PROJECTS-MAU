# Etapa 2 — experiencia visual

## Criterios aplicados

- Tema claro consistente, tipografía del sistema y verde oscuro para las
  acciones gastronómicas. Texto principal zinc oscuro; texto secundario con
  contraste sobre superficies claras. La preferencia oscura del dispositivo no
  cambia parcialmente los colores de formularios o controles.
- Controles de al menos 44 px de alto, foco visible y movimiento reducido según
  la preferencia del dispositivo. Los controles conservan sus etiquetas al escribir.
- Caja: categorías, tarjetas de menú, estado de agotado y carrito lateral en
  tablet/computadora; acceso fijo al pedido en móvil. Los precios finales siguen
  calculándose en servidor.
- Navegación móvil con foco dentro del panel, contenido de fondo inerte, cierre
  con Escape y devolución del foco. Al pasar a escritorio se libera el fondo.
  El enlace «Ir al contenido» evita recorrer toda la navegación con el teclado.
- Tablas de administración en regiones desplazables con nombre y acceso por
  teclado. El desplazamiento horizontal pertenece a la tabla y no a toda la página.
- Formularios administrativos en una columna en móvil. Clientes, productos,
  proveedores, caja, configuración y usuarios incorporan etiquetas de entrada.
- Inicio con accesos directos a caja gastronómica, cocina y arqueo. La carga,
  el error recuperable y la falta de ventas tienen mensajes distintos.
- Reportes con selector compacto en móvil y panel de tipos en escritorio;
  filtros etiquetados. No se cambia el significado de los indicadores comerciales.

## Validación técnica

Las pruebas de navegador comprueban móvil de 390 × 844, tablet de 768 × 1024 y
escritorio de 1366 × 900. Incluyen datos largos, desplazamiento de tablas,
etiquetas, foco, Escape, cambio de tamaño, salto al contenido y recuperación de
errores. Los recorridos con servicios reales verifican además la administración
móvil, las compras, caja, ventas y el flujo gastronómico. Las pruebas simuladas
se mantienen separadas de la evidencia contra PostgreSQL y Redis reales.

Esta validación no equivale a una auditoría completa de accesibilidad ni a una
prueba de uso con personal del restaurante.

## Validación de campo pendiente

Realizar una sesión con al menos un cajero y un encargado del negocio piloto,
usando su tablet/teléfono y un menú representativo. Emplear un entorno de prueba:

1. Encontrar un plato por categoría y búsqueda; reconocer un producto agotado.
2. Agregar un combo con extra/sustitución y cambiar la cantidad desde el carrito.
3. Guardar, cobrar con dos métodos y comprobar el cambio mostrado.
4. Localizar el pedido en cocina, leer notas y completar preparación/entrega.
5. Consultar clientes, productos y reportes desde móvil; navegar por teclado.
6. Identificar una falla de carga y recuperarse sin duplicar el pedido o cobro.

Registrar por tarea: dispositivo, resultado, ayuda necesaria, confusiones y
errores observados. No guardar credenciales ni datos de clientes en el informe.
Corregir los problemas que impidan completar tareas y repetir los casos afectados
antes de declarar cerrada la validación de campo.

La etapa tiene una entrega técnica verificable; el cierre de campo sigue pendiente
hasta contar con esta evidencia. La arquitectura de contingencia está definida
en `OFFLINE_ARCHITECTURE.md`; esta entrega no habilita operación offline.
