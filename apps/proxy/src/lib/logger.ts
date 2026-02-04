import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Create child logger with correlation ID
export function createRequestLogger(correlationId: string) {
  return logger.child({ correlationId });
}
