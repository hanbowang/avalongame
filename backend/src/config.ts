import dotenv from 'dotenv';

dotenv.config();

const getRequired = (value: string | undefined, key: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: getRequired(process.env.CORS_ORIGIN, 'CORS_ORIGIN'),
  sessionSecret: getRequired(process.env.SESSION_SECRET, 'SESSION_SECRET')
};
