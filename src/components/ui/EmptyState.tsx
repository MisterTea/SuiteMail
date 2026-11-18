import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Sparkles } from "lucide-react";

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  badge?: string;
  action?: ReactNode;
  className?: string;
} & (
  | { icon: LucideIcon; illustration?: never }
  | { illustration: ComponentType<{ size?: number; className?: string }>; icon?: never }
);

export function EmptyState({
  title,
  subtitle,
  badge,
  action,
  className = "",
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full min-h-[300px] text-center px-5 py-8 sm:px-6 sm:py-10 select-none animate-fadeIn ${className}`}
    >
      {"illustration" in rest && rest.illustration ? (
        <div className="relative mb-3.5 sm:mb-4 flex items-center justify-center">
          <div className="absolute inset-0 bg-accent/10 rounded-full blur-2xl transform scale-90 pointer-events-none" />
          <div className="w-32 h-32 sm:w-36 sm:h-36 flex items-center justify-center">
            <rest.illustration
              size={135}
              className="relative transition-transform duration-300 hover:scale-105"
            />
          </div>
        </div>
      ) : "icon" in rest && rest.icon ? (
        <div className="w-14 h-14 rounded-2xl bg-bg-secondary/80 border border-border-secondary flex items-center justify-center mb-4 text-text-secondary shadow-sm">
          {(() => {
            const Icon = rest.icon;
            return <Icon size={24} strokeWidth={1.75} />;
          })()}
        </div>
      ) : null}

      {badge && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-accent/15 via-accent/20 to-emerald-500/15 text-accent border border-accent/25 mb-3 shadow-xs">
          <Sparkles size={12} className="text-accent animate-pulse" />
          <span>{badge}</span>
        </div>
      )}

      <h3 className="text-base sm:text-lg font-semibold text-text-primary tracking-tight">
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs sm:text-sm text-text-secondary mt-1.5 max-w-xs sm:max-w-sm leading-relaxed">
          {subtitle}
        </p>
      )}

      {action && (
        <div className="mt-5 [&_button]:min-h-[44px] [&_button]:px-5 [&_button]:py-2.5 [&_button]:text-sm sm:[&_button]:min-h-[38px] touch-manipulation">
          {action}
        </div>
      )}
    </div>
  );
}
