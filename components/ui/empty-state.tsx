import { FilePlus2, type LucideIcon } from "lucide-react";

import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = FilePlus2,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
        <Icon size={25} />
      </span>
      <h2 className="mt-4 text-lg font-black text-[var(--text)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-[var(--muted)]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
