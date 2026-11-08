# Cambios de emergencia en datos inmutables

> **Estado: Aprobado (procedimiento).** En 1.0-a no hay ambiente productivo ni herramienta para este procedimiento; se automatizará cuando exista. Mientras tanto, **no se ejecuta** ningún bypass.

## Qué protege el sistema y qué no

| Actor                                      | ¿Puede modificar o borrar `attendance_event` / `audit_event`, o borrar un `employee`? |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Rol de aplicación (`puntuale_app`)         | No: sin permisos (`42501`) y con trigger                                              |
| Conexión administrativa en el flujo normal | No: los triggers `reject_mutation()` y `reject_employee_delete()` lo rechazan         |
| Superusuario que actúa a propósito         | **Sí, técnicamente**: puede desactivar triggers o permisos                            |

El trigger evita errores; no impide un bypass deliberado de un superusuario. Por eso un bypass se trata como un procedimiento excepcional y documentado.

## Procedimiento

Un cambio de emergencia (por ejemplo, borrar datos cargados por error en un ambiente de pruebas compartido, o atender una orden legal de supresión) solo procede si se cumplen todos estos puntos:

1. **Aprobación escrita del propietario** antes de ejecutar, con el motivo y el alcance exacto (tablas, empresa, filas).
2. **Script revisado** por una segunda persona, versionado fuera del flujo de migraciones normales.
3. **Respaldo** previo de las filas afectadas.
4. Ejecución en **una sola transacción**, que desactiva el trigger solo para esa transacción y lo reactiva antes de confirmar.
5. **Registro posterior**: quién, cuándo, por qué, qué filas y el resultado, guardado junto con la aprobación.
6. Nunca desde la API ni con `puntuale_app`.

Las correcciones de negocio **no** son emergencias: se hacen con eventos nuevos (`source = 'correction'`), que conservan el original ([ADR 0004](../adr/0004-immutable-attendance-events.md)).
