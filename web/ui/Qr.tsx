import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code drawn as SVG (sharp at any size, no canvas). */
export function Qr({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return { d, n };
  }, [value]);
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={path.n + 4} height={path.n + 4} className="qr__bg" />
      <path d={path.d} className="qr__ink" />
    </svg>
  );
}
