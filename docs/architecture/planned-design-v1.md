# Diseño planificado de la V1

> **Estado: Planificado.** Este documento recoge el informe arquitectónico v2 con los ajustes finales del arquitecto (7-nov-2026). Describe **diseño aprobado que aún no está implementado**.
>
> Lo que ya existe en el código está en [`overview.md`](overview.md) y [`../data-model/README.md`](../data-model/README.md). Cuando una sección se implemente, se mueve a la documentación de su módulo y aquí se sustituye por un enlace.

## 1. Módulos y pasos de entrega

| Paso  | Módulos                                                                                                                                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0-a | Base del monorepo, `tenancy` (contexto), `audit`, persistencia de `attendance_event`                                                                                                                                                                       |
| 1.0-b | `identity`: autenticación, roles, permisos, `ScopePolicy`, `GET /api/me/tenants`. Drizzle se difiere: el acceso sigue con `pg` y SQL parametrizado hasta que el volumen de consultas lo justifique ([ADR 0002](../adr/0002-modular-monolith-and-stack.md)) |
| 1.0-c | `employees`, `schedules` (horarios versionados, festivos, excepciones), `period-calendars`                                                                                                                                                                 |
| 1.0-d | `time-tracking` (endpoint de ingesta, PWA, cola sin conexión), `workdays` (`buildWorkday`), `review_flag`                                                                                                                                                  |
| 1.0-e | `periods`: periodos, cierre versionado, conformidad, reapertura                                                                                                                                                                                            |
| 1.0-f | `incidents`, `clarifications`, `corrections`                                                                                                                                                                                                               |
| 1.0-g | `reports`: reportes de asistencia e incidencias, exportación                                                                                                                                                                                               |

## 2. Calendarios y periodos

**`period_calendar`**

- Campos: `id`, `tenant_id`, `name` (único por tenant), `timezone` (IANA), `status` (`active` o `archived`) y `anchor_date`.
- `frequency` acepta `weekly`, `biweekly` (cada 14 días), `semimonthly` (del 1 al 15 y del 16 al fin de mes) y `monthly`.
- `anchor_date` es obligatoria para `weekly` y `biweekly`, y se ignora en las otras dos frecuencias.

**`attendance_period`**

| Campo                         | Notas                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `id`, `tenant_id`             |                                                       |
| **`period_calendar_id`**      | Calendario al que pertenece el periodo                |
| `start_date`, `end_date`      | Fechas locales; ambos días cuentan                    |
| **`timezone`**                | Se congela al crear el periodo                        |
| **`rules_version`**           |                                                       |
| `status`                      | `open`, `in_review`, `closed` o `reopened`            |
| **`current_closure_version`** | Valor de solo lectura; se calcula como `max(version)` |

Restricciones:

- `CHECK (end_date >= start_date)`.
- Dos periodos del mismo calendario no pueden traslaparse: `EXCLUDE USING gist (tenant_id WITH =, period_calendar_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`.
- Las fechas no se pueden editar después del primer cierre.

**Cambio de calendario a mitad de periodo.** Cada fecha operativa pertenece al calendario de la asignación vigente ese día. El colaborador aparece en los dos periodos, cada uno con sus días, sin huecos y sin contar nada dos veces.

**Snapshot del cierre.** Guarda el calendario, las fechas, los tramos de asignación de cada colaborador (con la versión y el contenido del horario) y las reglas que se aplicaron. Así, un cambio posterior no altera la historia.

**Reportes.** Un reporte de cierre corresponde a un solo periodo y, por lo tanto, a un solo calendario. Los reportes operativos por rango de fechas agrupan por calendario.

## 3. Identidad estable de la jornada (ajuste 2.2)

La identidad de una `workday` es su **llave natural**, que nunca depende del orden ni de la llegada de los eventos.

- **Jornada programada:** `(tenant_id, employee_id, operational_date, assignment_id, schedule_version_id, shift_instance)`. `shift_instance` es el índice del turno **dentro de la definición del horario** de ese día, no de los eventos.
- **Jornada no programada:** `(tenant_id, employee_id, operational_date, 'unscheduled')`. Hay como máximo una por colaborador y fecha operativa, y todos los eventos no programados de esa fecha se agrupan en ella.
- La función `workdayNaturalKey()` está en `@puntuale/domain-rules` (implementada en 1.0-a y probada con eventos tardíos). La tabla `workday` tendrá una restricción única sobre esa llave. Recalcular hace un _upsert_ sobre la llave, así que una entrada tardía nunca crea otra jornada.
- `derived_worked_minutes` y `derived_expected_minutes` son **valores derivados**. Llevan `rules_version` y `computed_at`.

## 4. Estados y precedencia (ajuste 2.1)

Ver [ADR 0012](../adr/0012-attendance-status-and-precedence.md). La precedencia `needs_review > pending > incomplete > complete` ya está implementada en `resolveAttendanceStatus`.

**Jornada programada sin marcaciones.** Un job idempotente, `workday.materialize`, crea la jornada de cada día laborable programado cuando se abre la ventana del turno. La llave natural evita los duplicados.

- Si la ventana cierra sin marcaciones, la jornada queda `incomplete` y se crea la incidencia `ABSENCE` en estado `detected`.
- En descansos y festivos sin marcaciones no se crea jornada.
- Si hay marcaciones en un descanso o festivo, se crea una jornada no programada con la incidencia `REST_DAY_WORKED` o `HOLIDAY_WORKED`.

## 5. Alertas de revisión sin duplicados (ajuste 2.4)

**`review_flag`**

| Campo                                             | Notas                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `tenant_id`, `workday_id`                   |                                                                                                                                |
| `incident_id`                                     | Opcional                                                                                                                       |
| `code`                                            | `LATE`, `MISSING_IN`, `MISSING_OUT`, `OUTSIDE_SCHEDULE`, `CLOCK_SKEW`, `DAILY_LIMIT`, `WEEKLY_LIMIT`, `LATE_EVENT_AFTER_CLOSE` |
| `origin_rule`, `rules_version`                    | Regla que generó la alerta                                                                                                     |
| `status`                                          | `open`, `resolved` o `dismissed`                                                                                               |
| `resolved_by`, `resolved_at`, `resolution_reason` |                                                                                                                                |

**Idempotencia.**

- Índice único parcial `UNIQUE (tenant_id, workday_id, code, rules_version) WHERE status = 'open'`.
- La función pura `planFlagChanges()` (implementada en 1.0-a) calcula, a partir de las alertas abiertas y las recién calculadas, cuáles crear y cuáles cerrar. Una recomputación no duplica nada.

## 6. Asignación de marcaciones a jornadas (turnos nocturnos y varios pares)

Las reglas son deterministas y versionadas, y viven en `attendance_rules` por tenant:

| Regla                  | Valor por defecto |
| ---------------------- | ----------------- |
| `pre_margin`           | 120 min           |
| `post_margin`          | 240 min           |
| `max_workday_duration` | 16 h              |
| `late_tolerance`       | 10 min            |
| `double_tap_window`    | 60 s              |
| `clock_skew_threshold` | 300 s             |
| `max_offline_age`      | 72 h              |

**Ventanas y asignación**

- **Ventana del turno:** desde el inicio programado menos `pre_margin` hasta el fin programado más `post_margin`.
- **Ventanas que se traslapan:** una entrada va al turno cuyo inicio programado esté más cerca; una salida, al turno que tenga un segmento abierto; si hay empate, al turno más temprano.
- **Entrada fuera de toda ventana:** crea una jornada no programada con la alerta `OUTSIDE_SCHEDULE`.
- **Salida sin jornada abierta:** crea una jornada no programada con la alerta `MISSING_IN`.
- **Sin horario:** la entrada abre la jornada en su fecha local; la salida se asocia a ella si llega dentro de `max_workday_duration`.

**Pares de marcaciones**

Es una máquina de dos estados (`OUT` → `IN` → `OUT`). Los eventos se ordenan por `occurred_at_utc`, luego `received_at` y luego `id`.

- Dos marcaciones del mismo tipo dentro de `double_tap_window`: la segunda se ignora para formar pares.
- `IN, IN`: falta la salida (`MISSING_OUT`).
- `OUT, OUT` o una salida inicial: falta la entrada (`MISSING_IN`).
- Se permiten tres o más pares; los huecos entre ellos son pausas.
- Los eventos tardíos o fuera de orden obligan a recalcular todo el conjunto efectivo.

**Función pura.** `buildWorkday(events, scheduleSnapshot, rules)` se implementará en el paso 1.0-d, con _property tests_.

## 7. Modo sin conexión

Ver [ADR 0011](../adr/0011-offline-ingest-and-idempotency.md) y [`../security/offline.md`](../security/offline.md).

- **Cola del cliente:** guarda los eventos en IndexedDB con estados `queued`, `sending`, `synced`, `conflict` y `failed`.
- **Reintentos:** cada evento se reintenta por separado, con espera exponencial.
- **Envío por lotes:** cada evento recibe su propio resultado.
- **Periodo ya cerrado:** un evento que llega para un periodo cerrado se guarda, pero no cambia el cierre y genera `LATE_EVENT_AFTER_CLOSE`.

## 8. Incidencias, correcciones y aclaraciones

**`incident`**

| Campo                                             | Notas                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `employee_id`                                     |                                                                 |
| `attendance_event_id`, `period_id`                | Opcionales                                                      |
| Rango de fechas                                   | Se liga a jornadas mediante `incident_workday`                  |
| `incident_type_id`                                |                                                                 |
| `origin`                                          | `detected` o `requested`                                        |
| `status`                                          | Ver [ADR 0012](../adr/0012-attendance-status-and-precedence.md) |
| `created_by_user_id`, `assignee_user_id`          |                                                                 |
| `resolved_by`, `resolved_at`, `resolution_reason` |                                                                 |
| `justified_by_incident_id`                        | Opcional                                                        |
| Evidencia                                         |                                                                 |

**`incident_type`**

- Los tipos de sistema son globales: llevan `tenant_id NULL` y son de solo lectura. Son `ABSENCE`, `LATE_ARRIVAL`, `EARLY_LEAVE`, `MISSING_PUNCH`, `VACATION`, `SICK_LEAVE`, `PERMISSION_PAID`, `PERMISSION_UNPAID`, `HOLIDAY_WORKED` y `REST_DAY_WORKED`.
- Cada tenant puede crear tipos propios.

**`correction`**

| Acción    | Evento original | Evento nuevo     |
| --------- | --------------- | ---------------- |
| `add`     | No              | Sí, al aplicarse |
| `replace` | Sí              | Sí, al aplicarse |
| `void`    | Sí              | No               |

- Un `CHECK` exige esa combinación según la acción.
- `reason`, `requested_by` y `status` siempre son obligatorios.
- Una corrección con `after_closure = true` requiere el permiso `period.correct_after_close`.

**Aclaraciones.** `clarification` tiene un hilo de mensajes y se liga a una jornada o a una incidencia.

## 9. Cierre, reapertura y versiones

**`period_closure`** (inmutable)

- Campos: `version`, `closed_at`, `closed_by`, `snapshot`, `snapshot_schema_version`, `rules_version`, `contract_version`, `generated_at`, `content_hash` (JCS, RFC 8785, con SHA-256) y `reopen_reason`.
- Restricción única: `UNIQUE (period_id, version)`.
- La versión vigente se calcula; no existe `superseded_by`.

**Reapertura**

- Requiere el permiso `period.reopen` (por defecto, RH y administrador). El motivo es obligatorio y queda auditado.
- No vence: dura hasta que el periodo vuelve a cerrarse.
- **Mientras está reabierto se permite:** corregir, resolver incidencias y alertas, responder aclaraciones y cambiar `review_status`.
- **No se permite:** cambiar las fechas o el calendario, ni borrar.
- La versión vN sigue vigente con la marca “en reapertura” hasta que se crea la vN+1. Todas las versiones quedan disponibles.

**Comparación.** Habrá un diff canónico entre snapshots, por colaborador y por jornada.

**Avisos.** Los reportes de vN muestran “superado”, se avisa a quien los generó y se pide una nueva conformidad.

**`acknowledgment`.** Se registra por versión de cierre y colaborador, como `accepted` u `objected`. Una objeción abre una aclaración.

## 10. Reportes

**`report_export`**

- Campos: `closure_id`, `closure_version`, `generator_version`, `format`, `data_checksum` (calculado sobre las filas canónicas), `generated_by` y `generated_at`.
- Que un reporte esté “vigente” o “superado” se calcula, y se imprime en su encabezado.
- **Regeneración:** produce los mismos datos, pero no necesariamente los mismos bytes, porque XLSX y PDF incluyen metadatos. Por eso no se guarda el archivo.

## 11. Identidad y permisos (1.0-b)

- **`app_user`:** `email` de tipo `citext`, `password_hash` (Argon2id), `mfa_secret` (cifrado) y `status`.
- **Roles y permisos:** implementado en 1.0-b.2 con un catálogo global y cerrado y solo alcance de empresa ([ADR 0015](../adr/0015-access-control-and-mfa.md)). El alcance por centro o área sigue planificado.
- **`ScopePolicy`:** decidirá qué colaboradores puede ver cada usuario según su alcance. Depende de las entidades de centro y área, que aún no existen.
- **`user_tenant.employee_id`:** vincula la identidad del usuario con un colaborador para el autoservicio. **No otorga ningún rol.**
