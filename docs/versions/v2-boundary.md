# Frontera entre la V1 (asistencia) y la V2 (nómina)

> **Estado: Aprobado (diseño).** La V2 no existe. Este documento fija las reglas para que la V2 se agregue sin rehacer el núcleo de la V1. Ver [ADR 0006](../adr/0006-v1-v2-separation-and-versioned-closure.md).

## Reglas

1. **La V2 será un módulo nuevo** (`payroll`) con tablas propias. En la V1 no existe ninguna carpeta, tabla, endpoint ni dependencia de nómina.
2. **El contrato entre versiones es el cierre de periodo versionado** (`period_closure`, planificado para la 1.0-e):
   - Es un snapshot inmutable, con `snapshot_schema_version`, `rules_version`, `contract_version`, `generated_at`, `content_hash` (SHA-256 sobre JSON canónico) y un esquema validable.
   - Incluye la empresa, el periodo, los colaboradores, las jornadas, las incidencias, los estados, las correcciones aplicadas, la fecha y el usuario del cierre, y la versión.
3. **La V2 solo lee.** No modifica marcaciones, jornadas, incidencias ni cierres de la V1.
4. **La V2 reacciona a eventos de dominio** (`period.closure.created`, `period.reopened`) emitidos por la V1. Un periodo reabierto invalida el cálculo que la V2 haya hecho sobre la versión anterior.
5. **Los datos sensibles de nómina vivirán solo en la V2:** salario, NSS, CURP, RFC y cuenta bancaria, con permisos y cifrado propios. La tabla `employee` de la V1 nunca los guarda.
6. **Los códigos de incidencia son estables.** La V2 los relacionará con sus conceptos de nómina en su propia tabla. La V1 no guarda efectos económicos.
7. **Los permisos son extensibles.** La V2 agregará permisos `payroll.*` sin cambiar el modelo de permisos de la V1.
