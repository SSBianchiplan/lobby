import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ value, size = 130, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 0, width: size * 2, color: { dark: "#2B2B2B", light: "#FFFFFF" } }).then(setSrc);
  }, [value, size]);
  return (
    <div className="qr-box" style={{ width: size + 20, height: size + 20 }}>
      {src ? <img src={src} width={size} height={size} alt={label} /> : null}
    </div>
  );
}
