# Alcance de la versión 1.x: control de asistencia

> **Estado: Aprobado.** Define qué entra y qué no entra en la V1. El avance real de cada módulo está en la tabla de estado de [`docs/README.md`](../README.md).

## Propósito

Puntuale V1 registra y organiza la asistencia de los colaboradores de una empresa. Permite revisarla por día y por periodo, aclararla, corregirla con historial y cerrar los periodos.

**Su salida es un reporte de asistencia e incidencias.** Con ese reporte, cada cliente prepara su nómina en su propio sistema. **La V1 no maneja dinero.**

## Incluye

- Empresas (cada empresa es un tenant) y usuarios con membresía en una o varias empresas.
- Colaboradores, roles y permisos con alcance por empresa, centro o área.
- Turnos y horarios mínimos: plantillas semanales, tolerancias, descansos y festivos.
- Registro de entradas y salidas desde la PWA, con modo sin conexión.
- Jornadas con varios pares de entrada y salida, y turnos que cruzan la medianoche.
- Incidencias, aclaraciones y correcciones auditadas.
- Consulta por día y por periodo, calendarios de periodo, cierre versionado y reapertura controlada.
- Conformidad del colaborador sobre cada versión del cierre.
- Reportes básicos de asistencia y de incidencias.
- Historial de cambios y auditoría.

## No incluye

- Cálculo de nómina, salarios, percepciones, deducciones o impuestos.
- Timbrado fiscal, recibos de nómina o pagos.
- Facturación, planes comerciales o límites por plan.
- Integraciones con proveedores de nómina.
- Consolidación de varias empresas.
- Biométricos o selfie (dato sensible). Kiosco y geolocalización quedan para la 1.x.
- Cualquier módulo propio de la V2.

## Criterio de verificación

En el código ejecutable no deben existir **módulos, tablas, endpoints ni lógica de nómina**: ni en `apps/`, ni en `packages/`, ni en `db/migrations/`. La documentación sí puede mencionar la V2 para describir la frontera entre versiones.
