import { useMemo } from 'react';
import { encode } from 'uqr';

/** QR generado en el navegador: el enlace con el secreto no sale a ningún servicio externo. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    const segments: string[] = [];
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) segments.push(`M${x} ${y}h1v1h-1z`);
      }),
    );
    return { path: segments.join(''), size: qr.size };
  }, [value]);

  return (
    <svg
      className="pt-qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
