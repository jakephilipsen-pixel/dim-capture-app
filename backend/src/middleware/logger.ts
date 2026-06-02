import pino from "pino";
import pinoHttp from "pino-http";

const level = process.env.NODE_ENV === "test" ? "silent" : "info";

// Base application logger — use this instead of console.* in committed code.
export const logger = pino({ level });

export const requestLogger = pinoHttp({ logger });
