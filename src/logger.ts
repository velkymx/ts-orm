// Pluggable logging. VibeORM emits structured events through this interface and
// ships only a console default — enterprises inject their own logger (pino,
// winston, ...) to route events into their observability stack and to own
// rotation/redaction/transport. The ORM never touches the filesystem itself.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

// Numeric ranking so a configured minimum level can filter cheaply.
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Console logger honoring a minimum level. Defaults to 'warn' so production
 * stays quiet (errors + slow-query warnings only); set 'debug' to see SQL.
 * warn/error go to console.error, lower levels to console.log. Prefixed
 * [vibeorm]. meta is passed through untouched (no values/bindings are logged by
 * the ORM, so there is nothing to redact here).
 */
export function createConsoleLogger(minLevel: LogLevel = 'warn'): Logger {
    const min = LEVEL_ORDER[minLevel];

    const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
        if (LEVEL_ORDER[level] < min) return;
        const sink = level === 'warn' || level === 'error' ? console.error : console.log;
        const line = `[vibeorm] ${level}: ${message}`;
        if (meta) sink(line, meta);
        else sink(line);
    };

    return {
        debug: (message, meta) => emit('debug', message, meta),
        info: (message, meta) => emit('info', message, meta),
        warn: (message, meta) => emit('warn', message, meta),
        error: (message, meta) => emit('error', message, meta)
    };
}

// Module-level active logger, mirroring the single shared pool pattern. Swap it
// once at startup with setLogger(); all ORM modules read it via getLogger().
let current: Logger = createConsoleLogger();

/** Replace the active logger (e.g. a pino adapter). */
export function setLogger(logger: Logger): void {
    current = logger;
}

/** Get the active logger used by all ORM modules. */
export function getLogger(): Logger {
    return current;
}
