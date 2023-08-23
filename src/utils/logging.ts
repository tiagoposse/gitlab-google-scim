import winston from 'winston';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.json(),
  defaultMeta: { service: 'gitlab-sso-sync' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
  ],
});
