import { createConsoleLogger, setLogger } from '../src/logger.js';
import { sanitizeError } from '../src/security.js';

describe('Logger', () => {
  afterEach(() => {
    // Reset to the default logger so injection in one test cannot leak to others.
    setLogger(createConsoleLogger());
    vi.restoreAllMocks();
  });

  test('console logger suppresses levels below minLevel', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createConsoleLogger('warn');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(log).not.toHaveBeenCalled();   // debug + info below 'warn'
    expect(err).toHaveBeenCalledTimes(2); // warn + error
  });

  test('console logger emits debug when minLevel is debug, with [vibeorm] prefix', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createConsoleLogger('debug').debug('hello');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[vibeorm]');
    expect(log.mock.calls[0][0]).toContain('hello');
  });

  test('setLogger injects a custom logger used by sanitizeError', () => {
    const calls = [];
    setLogger({
      debug() {},
      info() {},
      warn() {},
      error(message, meta) { calls.push([message, meta]); }
    });

    const clientMsg = sanitizeError(new Error('boom'), 'create', { table: 'users' });

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatch(/create/);
    expect(calls[0][1]).toMatchObject({ context: { table: 'users' } });
    // Still returns a sanitized, client-safe string.
    expect(typeof clientMsg).toBe('string');
  });

  test('sanitizeError does not log raw query bindings (PII safety)', () => {
    let logged;
    setLogger({ debug() {}, info() {}, warn() {}, error(_m, meta) { logged = meta; } });
    sanitizeError(new Error('fail'), 'update', { table: 'accounts' });
    // meta carries error metadata + context only — never values/bindings.
    expect(Object.keys(logged).sort()).toEqual(['code', 'context', 'errno', 'error', 'sqlState']);
  });
});
