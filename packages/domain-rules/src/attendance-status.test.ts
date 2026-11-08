import type { AttendanceStatus } from '@puntuale/contracts';
import { describe, expect, it } from 'vitest';
import { resolveAttendanceStatus, type AttendanceStatusInput } from './attendance-status';

/**
 * Tabla completa de los 8 casos combinados (ADR 0012).
 * Precedencia: needs_review > pending > incomplete > complete.
 */
const cases: Array<[AttendanceStatusInput, AttendanceStatus, string]> = [
  [
    { hasOpenReviewItems: true, windowOpen: true, hasUnpairedSegments: true },
    'needs_review',
    'revisión abierta con ventana abierta y sin pares',
  ],
  [
    { hasOpenReviewItems: true, windowOpen: true, hasUnpairedSegments: false },
    'needs_review',
    'revisión abierta con ventana abierta',
  ],
  [
    { hasOpenReviewItems: true, windowOpen: false, hasUnpairedSegments: true },
    'needs_review',
    'revisión abierta en una jornada incompleta: no se oculta la incidencia',
  ],
  [
    { hasOpenReviewItems: true, windowOpen: false, hasUnpairedSegments: false },
    'needs_review',
    'revisión abierta en una jornada con pares completos',
  ],
  [
    { hasOpenReviewItems: false, windowOpen: true, hasUnpairedSegments: true },
    'pending',
    'entrada sin salida con la ventana abierta',
  ],
  [
    { hasOpenReviewItems: false, windowOpen: true, hasUnpairedSegments: false },
    'pending',
    'pares completos, pero la ventana sigue abierta',
  ],
  [
    { hasOpenReviewItems: false, windowOpen: false, hasUnpairedSegments: true },
    'incomplete',
    'ventana cerrada y falta una marcación',
  ],
  [
    { hasOpenReviewItems: false, windowOpen: false, hasUnpairedSegments: false },
    'complete',
    'ventana cerrada, pares válidos y nada abierto',
  ],
];

describe('resolveAttendanceStatus: precedencia de casos combinados', () => {
  it.each(cases)('%o → %s (%s)', (input, expected) => {
    expect(resolveAttendanceStatus(input)).toBe(expected);
  });

  it('nunca devuelve un quinto estado', () => {
    const results = new Set(cases.map(([input]) => resolveAttendanceStatus(input)));
    expect([...results].sort()).toEqual(['complete', 'incomplete', 'needs_review', 'pending']);
  });
});
