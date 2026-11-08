# Plantilla del README de un módulo

> **Estado: Aprobado.** Copia esta plantilla a `apps/api/src/modules/<modulo>/README.md` al crear un módulo. Todas las secciones son obligatorias; si alguna no aplica, escribe “No aplica” y explica por qué.

```markdown
# Módulo `<modulo>`

> **Estado:** Implementado | Parcial (indica qué falta y en qué paso llega)

## Propósito

Una o dos frases: qué problema resuelve el módulo.

## Responsabilidades

- Qué hace.
- Qué **no** hace (y qué módulo se encarga de eso).

## Dependencias

| Depende de                                                              | Para qué |
| ----------------------------------------------------------------------- | -------- |
| Otros módulos (solo a través de su servicio de aplicación o de eventos) |          |
| Paquetes (`@puntuale/contracts`, `@puntuale/domain-rules`)              |          |
| Tablas propias                                                          |          |

## Reglas de negocio

Reglas numeradas, cada una con su ADR y su prueba.

## Entradas y salidas

| Tipo            | Nombre                       | Contrato                             |
| --------------- | ---------------------------- | ------------------------------------ |
| Endpoint        | `GET /api/t/:tenantId/...`   | `XxxSchema` en `@puntuale/contracts` |
| Evento emitido  | `<modulo>.<entidad>.<verbo>` |                                      |
| Acción auditada |                              |                                      |

## Pruebas relacionadas

| Archivo | Qué verifica |
| ------- | ------------ |

## Cómo extenderlo

Pasos concretos para agregar un caso de uso, un endpoint o una regla, sin romper las reglas anteriores.
```
