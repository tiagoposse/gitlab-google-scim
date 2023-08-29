import { createLogger, format, transports, LogEntry } from 'winston';
import tty from 'tty';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'gitlab-sso-sync' },
  format: tty.isatty(process.stdout.fd) ? format.combine(
    format.colorize(),
    format.simple()
  ) : format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.printf((log: LogEntry) => {
        return JSON.stringify(log, null);
      }))
    })
  ],
});
