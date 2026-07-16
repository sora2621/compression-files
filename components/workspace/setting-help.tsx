import { Info } from "lucide-react";
import { useId } from "react";

export function SettingHelp({
  label,
  short,
  children,
}: {
  label: string;
  short: string;
  children?: React.ReactNode;
}) {
  const descriptionId = useId();
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-black text-[var(--text)]"
          aria-describedby={descriptionId}
        >
          {label}
        </span>
        <details className="group">
          <summary
            className="grid size-8 cursor-pointer list-none place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={`${label}の説明`}
          >
            <Info size={15} />
          </summary>
          <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs font-medium leading-5 text-[var(--muted)] shadow-lg">
            {children ?? short}
          </div>
        </details>
      </div>
      <p id={descriptionId} className="mt-1 text-xs font-medium text-[var(--muted)]">
        {short}
      </p>
    </div>
  );
}
