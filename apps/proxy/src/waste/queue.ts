import { Queue, Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "../lib/logger.js";
import { runWasteDetection } from "./detector.js";

// Redis connection for BullMQ
const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Queue for waste detection jobs
export const wasteDetectionQueue = new Queue("waste-detection", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500, // Keep last 500 failed jobs
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

// Job data interface
export interface WasteDetectionJobData {
  eventId: string;
  sessionId: string;
  userId: string;
  teamId: string | null;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  toolCalls: string[];
  filesReferenced: string[];
  compactionTriggered: boolean;
  contextSizeBefore: number;
  contextSizeAfter: number;
}

// Worker to process waste detection jobs
let worker: Worker | null = null;

export function startWasteDetectionWorker(): void {
  if (worker) {
    logger.warn("Waste detection worker already started");
    return;
  }

  worker = new Worker<WasteDetectionJobData>(
    "waste-detection",
    async (job: Job<WasteDetectionJobData>) => {
      const startTime = Date.now();
      logger.info({ jobId: job.id, eventId: job.data.eventId }, "Processing waste detection job");

      try {
        await runWasteDetection(job.data);
        logger.info(
          { jobId: job.id, eventId: job.data.eventId, durationMs: Date.now() - startTime },
          "Waste detection completed"
        );
      } catch (err) {
        logger.error(
          { err, jobId: job.id, eventId: job.data.eventId },
          "Waste detection failed"
        );
        throw err; // Rethrow to trigger retry
      }
    },
    {
      connection,
      concurrency: 5, // Process up to 5 jobs in parallel
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, eventId: job?.data.eventId, err },
      "Waste detection job failed"
    );
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Waste detection worker error");
  });

  logger.info("Waste detection worker started");
}

export async function stopWasteDetectionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info("Waste detection worker stopped");
  }
  await connection.quit();
}

/**
 * Enqueue a waste detection job for an event
 * This is called after each event is captured
 */
export async function enqueueWasteDetection(data: WasteDetectionJobData): Promise<void> {
  try {
    await wasteDetectionQueue.add("detect", data, {
      jobId: `waste-${data.eventId}`, // Deduplicate by event ID
    });
    logger.debug({ eventId: data.eventId }, "Enqueued waste detection job");
  } catch (err) {
    // Never throw from enqueue - this shouldn't break the proxy
    logger.error({ err, eventId: data.eventId }, "Failed to enqueue waste detection job");
  }
}
