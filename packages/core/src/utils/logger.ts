/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Structured logger for Cloudflare Workers Logs
 * 
 * Automatically emits to Workers Logs free tier (200k events/day, 3-day retention).
 * Uses structured JSON format for better filtering and analysis in the dashboard.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private logLevel: LogLevel;
  private requestId?: string;

  constructor(logLevel: LogLevel = 'info') {
    this.logLevel = logLevel;
  }

  /**
   * Set request ID for correlation across log entries
   */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  /**
   * Get current request ID
   */
  getRequestId(): string | undefined {
    return this.requestId;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Check if a log level should be emitted
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  /**
   * Create log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (this.requestId) {
      entry.requestId = this.requestId;
    }

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    return entry;
  }

  /**
   * Emit log entry
   */
  private emit(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.createLogEntry(level, message, context, error);
    const jsonString = JSON.stringify(entry);

    // Use appropriate console method based on level
    switch (level) {
      case 'debug':
        console.log(jsonString);
        break;
      case 'info':
        console.log(jsonString);
        break;
      case 'warn':
        console.warn(jsonString);
        break;
      case 'error':
        console.error(jsonString);
        break;
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.emit('debug', message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.emit('info', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context?: LogContext, error?: Error): void {
    this.emit('error', message, context, error);
  }
}

// Create singleton instance
let loggerInstance: Logger | null = null;

/**
 * Get logger instance
 * Creates a new instance if one doesn't exist
 */
export function getLogger(logLevel?: LogLevel): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(logLevel);
  }
  if (logLevel) {
    loggerInstance.setLevel(logLevel);
  }
  return loggerInstance;
}

/**
 * Create a new logger instance (useful for testing)
 */
export function createLogger(logLevel: LogLevel = 'info'): Logger {
  return new Logger(logLevel);
}

