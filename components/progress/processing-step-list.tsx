import { Ban, Check, Circle, LoaderCircle, X } from "lucide-react";
import { useId } from "react";

import { stepStatusLabels } from "@/components/progress/utils";

import type { ProcessingStep } from "@/components/progress/types";

export interface ProcessingStepListProps {
  steps: ProcessingStep[];
  title?: string;
  className?: string;
}

const statusStyles = {
  pending: {
    wrapper: "border-slate-200 bg-white text-slate-400",
    icon: <Circle size={14} aria-hidden="true" />,
  },
  processing: {
    wrapper: "border-indigo-200 bg-indigo-50 text-[#5865e8]",
    icon: (
      <LoaderCircle
        size={15}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    ),
  },
  completed: {
    wrapper: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <Check size={15} strokeWidth={3} aria-hidden="true" />,
  },
  failed: {
    wrapper: "border-rose-200 bg-rose-50 text-rose-700",
    icon: <X size={15} strokeWidth={3} aria-hidden="true" />,
  },
  cancelled: {
    wrapper: "border-slate-300 bg-slate-100 text-slate-600",
    icon: <Ban size={14} aria-hidden="true" />,
  },
} as const;

export function ProcessingStepList({
  steps,
  title = "処理ステップ",
  className,
}: ProcessingStepListProps) {
  const titleId = useId();
  const activeStep = steps.find((step) => step.status === "processing");

  return (
    <section className={className} aria-labelledby={titleId}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 id={titleId} className="font-black text-slate-900">
          {title}
        </h3>
        <span className="text-[11px] font-bold tabular-nums text-slate-500">
          {steps.filter((step) => step.status === "completed").length} / {steps.length}{" "}
          完了
        </span>
      </div>

      <ol className="space-y-0" aria-label={title}>
        {steps.map((step, index) => {
          const style = statusStyles[step.status];
          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < steps.length - 1 && (
                <span
                  className={`absolute bottom-0 left-[15px] top-8 w-px ${
                    step.status === "completed" ? "bg-emerald-300" : "bg-slate-200"
                  }`}
                  aria-hidden="true"
                />
              )}
              <span
                className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full border ${style.wrapper}`}
              >
                {style.icon}
                <span className="sr-only">{stepStatusLabels[step.status]}</span>
              </span>
              <div
                className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${style.wrapper} ${
                  step.status === "processing" ? "ring-2 ring-indigo-100" : ""
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-black text-slate-800">
                    {index + 1}. {step.label}
                  </span>
                  <span className="text-[10px] font-black">
                    {stepStatusLabels[step.status]}
                  </span>
                </div>
                {step.description && (
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {activeStep ? `現在の処理: ${activeStep.label}` : "処理中のステップはありません"}
      </p>
    </section>
  );
}
