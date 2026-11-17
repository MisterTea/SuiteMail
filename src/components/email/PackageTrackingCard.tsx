import { useState } from "react";
import { Package, Truck, Plane, ExternalLink, Copy, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PackageTrackingItem } from "@/utils/trackingDetector";

interface PackageTrackingCardProps {
  items: PackageTrackingItem[];
}

export function PackageTrackingCard({ items }: PackageTrackingCardProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!items || items.length === 0) return null;

  const handleCopy = (num: string, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(num);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleTrack = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="mb-3 space-y-2">
      {items.map((item, idx) => {
        const isFlight = item.carrier === "Flight";
        const Icon = isFlight ? Plane : item.carrier === "UPS" || item.carrier === "FedEx" ? Truck : Package;

        return (
          <div
            key={idx}
            className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border-primary bg-bg-secondary/70 hover:bg-bg-secondary transition-colors text-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-md bg-accent/15 text-accent shrink-0">
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">
                    {item.label ?? item.carrier}
                  </span>
                  <span className="text-[10px] font-mono bg-bg-tertiary px-1.5 py-0.5 rounded text-text-secondary truncate max-w-[150px]">
                    {item.trackingNumber}
                  </span>
                  <button
                    onClick={(e) => handleCopy(item.trackingNumber, idx, e)}
                    className="text-text-tertiary hover:text-text-primary transition-colors p-0.5"
                    title="Copy tracking number"
                  >
                    {copiedIndex === idx ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={(e) => handleTrack(item.trackingUrl, e)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-white hover:bg-accent-hover font-medium shrink-0 transition-colors shadow-xs"
            >
              <span>{isFlight ? "Track Flight" : "Track"}</span>
              <ExternalLink size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
