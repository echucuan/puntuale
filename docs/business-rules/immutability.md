# Regla: marcaciones y auditoría inmutables

> **Estado: Implementado (1.0-a).** Decisiones en [ADR 0004](../adr/0004-immutable-attendance-events.md) y [ADR 0005](../adr/0005-transactional-audit.md).

## Reglas

1. `attendance_event` y `audit_event` **solo aceptan inserciones**.
2. Hay dos barreras:
   - el rol de aplicación solo tiene `SELECT` e `INSERT` (un intento de `UPDATE`, `DELETE` o `TRUNCATE` da `42501`);
   - un trigger (`reject_mutation()`) rechaza `UPDATE`, `DELETE` y `TRUNCATE` de cualquier rol, incluida la conexión administrativa ordinaria, para que nadie los haga **por accidente**.

   **Alcance de la garantía.** No es una inmutabilidad absoluta: en PostgreSQL, un superusuario puede desactivar triggers o permisos de forma deliberada. Esa operación queda fuera del flujo normal y solo se admite con el [procedimiento de emergencia](../operations/emergency-changes.md).

3. Una corrección crea un evento nuevo con `source = 'correction'` y, si reemplaza a otro, `supersedes_event_id`. La marcación vigente se calcula; nunca se marca la original. (El flujo de correcciones llega en 1.0-e.)
4. Una marcación sincronizada dos veces no se duplica: la idempotencia por `client_event_id` está en [ADR 0011](../adr/0011-offline-ingest-and-idempotency.md).
5. **Los colaboradores no se borran físicamente** durante la operación normal: se dan de baja con `status = 'terminated'` y permanecen consultables como histórico, con sus marcaciones, su membresía y la identidad del usuario intactas. El rol de aplicación no tiene `DELETE` ni `TRUNCATE`, y el trigger `reject_employee_delete()` rechaza el borrado de cualquier rol, incluida la conexión administrativa ordinaria. Mismo alcance de la garantía que en el punto 2.

## Pruebas

- `apps/api/test/integration/immutability.int.test.ts` cubre cada operación en las dos tablas, con el rol de aplicación y con la conexión administrativa.
- `apps/api/test/integration/employee-deletion.int.test.ts` cubre el borrado y el vaciado de `employee` con ambos roles (con y sin referencias) y la baja lógica como histórico.
