import { Check } from "lucide-react";

export type QualityPreset = "quality" | "balanced" | "small";

const content: Record<
  QualityPreset,
  { title: string; description: string; effect: string }
> = {
  quality: {
    title: "画質優先",
    description: "見た目をできるだけ維持します",
    effect: "削減は控えめ",
  },
  balanced: {
    title: "バランス",
    description: "画質と容量のバランスを取ります",
    effect: "おすすめ",
  },
  small: {
    title: "容量優先",
    description: "多少の変化を許容して小さくします",
    effect: "削減大",
  },
};

export function QualityPresetCard({
  value,
  selected,
  onSelect,
}: {
  value: QualityPreset;
  selected: boolean;
  onSelect: () => void;
}) {
  const item = content[value];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-28 items-start gap-3 rounded-2xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${selected ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
    >
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${selected ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border-strong)]"}`}
      >
        {selected && <Check size={14} />}
      </span>
      <span>
        <span className="block text-sm font-black text-[var(--text)]">{item.title}</span>
        <span className="mt-1 block text-xs font-medium leading-5 text-[var(--muted)]">
          {item.description}
        </span>
        <span className="mt-2 inline-block rounded-full bg-[var(--surface-subtle)] px-2 py-1 text-[9px] font-bold text-[var(--muted)]">
          {item.effect}
        </span>
      </span>
    </button>
  );
}
