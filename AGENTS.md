# Entregas de PROJECTS-MAU

- Al terminar cada etapa, ejecutar sus validaciones y corregir los fallos antes
  de hacer commit y git push. El usuario solicita este flujo de forma permanente.
- Registrar en `kipu-saas/docs/RESTAURANT_ROADMAP.md` la evidencia y los pendientes.
  Los avances parciales deben identificarse como tales.
- Hacer commits con alcance claro; incluir código, pruebas, migraciones y
  documentación necesarios para desplegar esa entrega.
- Publicar en la rama remota de trabajo configurada y comprobar que el remoto
  contiene el mismo commit. No usar force push para resolver divergencias.
- Después de cada etapa, enviar al usuario un informe en este chat: etapa y
  estado real (completa o parcial), cambios implementados, pruebas y resultados,
  correcciones, pendientes/bloqueos, avance general y siguiente paso. Incluir
  SHA y enlace al commit publicado, confirmación de push y estado de despliegue.
  Mantener el informe coherente con `RESTAURANT_ROADMAP.md`; no inventar porcentajes.
- Mantener secretos, `.env`, dependencias, artefactos de compilación y datos
  locales fuera de Git. Git push no equivale a un despliegue a producción.
