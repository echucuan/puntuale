# ADR 0001 · Registrar las decisiones de arquitectura con ADRs

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

En Puntuale participan varios actores: el propietario del producto, un arquitecto (ChatGPT), un implementador (Claude Code) y un revisor (Codex). El código debe poder transferirse a otras personas sin depender del conocimiento de una sola.

## Problema

¿Cómo se conservan el motivo, las alternativas y las consecuencias de cada decisión, para que nadie tenga que reconstruirlas?

## Alternativas consideradas

1. **Decisiones en chats o documentos externos:** se pierden y no se versionan junto al código.
2. **Un documento de arquitectura único:** mezcla lo vigente con lo histórico.
3. **ADRs numerados dentro del repositorio:** cada uno es inmutable una vez aceptado y se reemplaza con otro ADR.

## Decisión

Toda decisión relevante se registra en `docs/adr/NNNN-titulo.md` con la plantilla [`0000-template.md`](0000-template.md). Sus campos son contexto, problema, alternativas, decisión, consecuencias, fecha y estado.

Un ADR aceptado no se reescribe: se reemplaza con uno nuevo, y el anterior queda marcado como `Reemplazado por ADR NNNN`.

## Consecuencias

- Cada cambio de arquitectura llega con su ADR en el mismo pull request.
- La propuesta original queda en `docs/proposals/` con estado **Histórico**.
- Se acepta el pequeño costo de escribir un ADR por cada decisión.
