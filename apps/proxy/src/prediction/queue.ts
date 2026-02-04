import { Queue, Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "../lib/logger.js";
import {
  trainModel,
  setModelWeights,
  type TrainingDataPoint,
  type TaskType,
  type ModelWeights,
} from "@prune/intelligence";

// Redis connection for BullMQ
const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Queue for model training jobs
export const modelTrainingQueue = new Queue("model-training", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

// Job data interface
export interface ModelTrainingJobData {
  teamId: string | null; // null for global model
  triggeredBy: "scheduled" | "manual";
}

// Worker to process model training jobs
let worker: Worker | null = null;

/**
 * Fetch training data from the events table.
 * In production, this would query the database.
 */
async function fetchTrainingData(teamId: string | null): Promise<TrainingDataPoint[]> {
  // This is a stub - in production, query the database
  // The actual implementation would:
  // 1. Query events table for the last 30 days
  // 2. Join with sessions to get session depth
  // 3. Extract task_type from task_metadata
  // 4. Calculate actual cost from tokens and model pricing

  logger.info({ teamId }, "Fetching training data (stub)");

  // Return empty array for now - the model will use default weights
  return [];
}

/**
 * Save model weights to the database.
 */
async function saveModelWeights(teamId: string | null, weights: ModelWeights): Promise<void> {
  // This is a stub - in production, insert into prediction_models table
  logger.info(
    {
      teamId,
      eventCount: weights.eventCount,
      r2Score: weights.r2Score,
      mae: weights.meanAbsoluteError,
    },
    "Saving model weights (stub)"
  );
}

/**
 * Load model weights from the database.
 */
export async function loadModelWeights(teamId: string | null): Promise<ModelWeights | null> {
  // This is a stub - in production, query prediction_models table
  // for the active model with matching team_id
  logger.info({ teamId }, "Loading model weights (stub)");
  return null;
}

export function startModelTrainingWorker(): void {
  if (worker) {
    logger.warn("Model training worker already started");
    return;
  }

  worker = new Worker<ModelTrainingJobData>(
    "model-training",
    async (job: Job<ModelTrainingJobData>) => {
      const startTime = Date.now();
      const { teamId, triggeredBy } = job.data;

      logger.info({ jobId: job.id, teamId, triggeredBy }, "Starting model training job");

      try {
        // Fetch training data
        const trainingData = await fetchTrainingData(teamId);

        if (trainingData.length < 100) {
          logger.info(
            { teamId, dataCount: trainingData.length },
            "Insufficient training data, skipping model training"
          );
          return { skipped: true, reason: "insufficient_data", dataCount: trainingData.length };
        }

        // Train the model
        const weights = trainModel(trainingData);

        // Save weights to database
        await saveModelWeights(teamId, weights);

        // Update in-memory weights if this is the global model
        if (teamId === null) {
          setModelWeights(weights);
        }

        logger.info(
          {
            jobId: job.id,
            teamId,
            durationMs: Date.now() - startTime,
            eventCount: weights.eventCount,
            r2Score: weights.r2Score,
            mae: weights.meanAbsoluteError,
          },
          "Model training completed"
        );

        return {
          skipped: false,
          eventCount: weights.eventCount,
          r2Score: weights.r2Score,
          meanAbsoluteError: weights.meanAbsoluteError,
        };
      } catch (err) {
        logger.error({ err, jobId: job.id, teamId }, "Model training failed");
        throw err;
      }
    },
    {
      connection,
      concurrency: 1, // Only train one model at a time
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, teamId: job?.data.teamId, err },
      "Model training job failed"
    );
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Model training worker error");
  });

  logger.info("Model training worker started");
}

export async function stopModelTrainingWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info("Model training worker stopped");
  }
  await connection.quit();
}

/**
 * Schedule weekly model retraining.
 * Call this on app startup.
 */
export async function scheduleWeeklyRetraining(): Promise<void> {
  // Remove existing scheduled jobs
  const scheduledJobs = await modelTrainingQueue.getRepeatableJobs();
  for (const job of scheduledJobs) {
    if (job.name === "weekly-retrain") {
      await modelTrainingQueue.removeRepeatableByKey(job.key);
    }
  }

  // Schedule new weekly job (runs every Sunday at 3am UTC)
  await modelTrainingQueue.add(
    "weekly-retrain",
    { teamId: null, triggeredBy: "scheduled" as const },
    {
      repeat: {
        pattern: "0 3 * * 0", // Every Sunday at 3am UTC
      },
    }
  );

  logger.info("Scheduled weekly model retraining");
}

/**
 * Manually trigger model retraining.
 */
export async function triggerModelRetraining(teamId: string | null = null): Promise<void> {
  await modelTrainingQueue.add(
    "manual-retrain",
    { teamId, triggeredBy: "manual" as const },
    {
      jobId: `manual-${teamId ?? "global"}-${Date.now()}`,
    }
  );

  logger.info({ teamId }, "Triggered manual model retraining");
}

/**
 * Initialize the prediction system.
 * Load existing model weights from the database.
 */
export async function initializePredictionSystem(): Promise<void> {
  try {
    const weights = await loadModelWeights(null);
    if (weights) {
      setModelWeights(weights);
      logger.info(
        { eventCount: weights.eventCount, r2Score: weights.r2Score },
        "Loaded existing model weights"
      );
    } else {
      logger.info("No existing model weights found, using defaults");
    }
  } catch (err) {
    logger.error({ err }, "Failed to load model weights, using defaults");
  }
}
