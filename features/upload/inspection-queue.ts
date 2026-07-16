type PendingTask = () => void;

export function createTaskLimiter(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }

  let active = 0;
  const pending: PendingTask[] = [];

  const runNext = () => {
    while (active < concurrency && pending.length > 0) {
      active += 1;
      pending.shift()?.();
    }
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        void task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            runNext();
          });
      });
      runNext();
    });
  };
}

const limitImageInspection = createTaskLimiter(4);
const limitMediaInspection = createTaskLimiter(2);

/** MIME is used only to choose a resource limit; actual format validation is server-side. */
export function scheduleInspection<T>(file: File, task: () => Promise<T>) {
  return (file.type.startsWith("image/") ? limitImageInspection : limitMediaInspection)(
    task,
  );
}
