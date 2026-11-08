import { z } from 'zod';

/**
 * Verifica si un identificador de zona horaria IANA es válido en este entorno.
 * Exige la forma canónica `Área/Ubicación` (o `UTC`): Intl también acepta alias
 * heredados como `CST`, que el ADR 0010 prohíbe por ambiguos.
 */
export function isValidIanaTimezone(value: string): boolean {
  if (!/^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria IANA, por ejemplo `America/Mexico_City`. Nunca abreviaturas como "CST" (ADR 0010). */
export const IanaTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: 'Zona horaria IANA inválida' });

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

/**
 * Fecha y hora local **sin** desfase ni zona, por ejemplo `2026-11-09T08:58:12.345`.
 * Es la hora de pared que declara el dispositivo. Se valida que exista en el calendario.
 */
export const LocalDateTimeSchema = z
  .string()
  .regex(LOCAL_DATE_TIME_PATTERN, {
    message: 'Formato esperado: AAAA-MM-DDTHH:mm:ss[.SSS], sin zona',
  })
  .refine(
    (value) => {
      const m = LOCAL_DATE_TIME_PATTERN.exec(value);
      if (!m) return false;
      const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      return (
        d.getUTCFullYear() === year &&
        d.getUTCMonth() === month - 1 &&
        d.getUTCDate() === day &&
        d.getUTCHours() === hour &&
        d.getUTCMinutes() === minute &&
        d.getUTCSeconds() === second
      );
    },
    { message: 'La fecha u hora no existe en el calendario' },
  );

/** Instante ISO-8601 con zona explícita (`Z` o desfase), por ejemplo `2026-11-09T14:58:12.345Z`. */
export const InstantSchema = z.iso.datetime({ offset: true });

/** Desfase respecto a UTC en minutos. Rango de los desfases reales: −12:00 a +14:00. */
export const UtcOffsetMinutesSchema = z.number().int().min(-720).max(840);
