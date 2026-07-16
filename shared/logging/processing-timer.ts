import { logger } from "./logger";

interface ProcessingTimerContext {
  jobId?: string;
  fileId?: string;
}

export function createProcessingTimer(context: ProcessingTimerContext = {}) {
  const totalStartedAt = performance.now();
  return {
    async measure<T>(stage: string, operation: () => Promise<T>): Promise<T> {
      const startedAt = performance.now();
      try {
        return await operation();
      } finally {
        logger.info({
          ...context,
          stage,
          elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
        });
      }
    },
    finish(stage = "total-processing") {
      logger.info({
        ...context,
        stage,
        elapsedMs: Number((performance.now() - totalStartedAt).toFixed(3)),
      });
    },
  } as const;
}
