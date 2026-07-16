import { Check, Lightbulb } from "lucide-react";

export function RecommendationCard({
  title,
  description,
  reason,
  applied,
  onApply,
}: {
  title: string;
  description: string;
  reason: string;
  applied?: boolean;
  onApply?: () => void;
}) {
  return (
    <article className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-900 dark:bg-cyan-950/30">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-cyan-700 dark:bg-slate-900 dark:text-cyan-300">
          <Lightbulb size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <p className="mt-1 text-xs font-bold text-cyan-900 dark:text-cyan-100">
            {description}
          </p>
          <p className="mt-2 text-[11px] font-medium leading-5 text-slate-600 dark:text-slate-300">
            理由: {reason}
          </p>
        </div>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            disabled={applied}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-[10px] font-black text-cyan-800 shadow-sm disabled:text-emerald-700 dark:bg-slate-900 dark:text-cyan-200"
          >
            {applied && <Check size={13} />} {applied ? "反映済み" : "反映する"}
          </button>
        )}
      </div>
    </article>
  );
}
