interface ImageSaveStatusProps {
  message: string;
  error?: boolean;
}

export function ImageSaveStatus({ message, error = false }: ImageSaveStatusProps) {
  return (
    <p
      className={`min-h-4 text-[11px] font-bold ${
        error ? "text-rose-700 dark:text-rose-300" : "text-[var(--muted)]"
      }`}
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {message}
    </p>
  );
}
