import { CheckCircle2, type LucideIcon } from "lucide-react";

export function ProcessingModeCard({
  icon: Icon,
  title,
  description,
  duration,
  reduction,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  duration: string;
  reduction: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative min-h-40 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
        selected
          ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-sm"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface)] text-[var(--primary)]">
          <Icon size={20} />
        </span>
        {selected && (
          <CheckCircle2 size={20} className="text-[var(--primary)]" aria-label="選択中" />
        )}
      </div>
      <h3 className="mt-4 text-sm font-black text-[var(--text)]">{title}</h3>
      <p className="mt-1 min-h-10 text-xs font-medium leading-5 text-[var(--muted)]">
        {description}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold text-[var(--muted)]">
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-1">
          時間: {duration}
        </span>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-1">
          削減: {reduction}
        </span>
      </div>
    </button>
  );
}
