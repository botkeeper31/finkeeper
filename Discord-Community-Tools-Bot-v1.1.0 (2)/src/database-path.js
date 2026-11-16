import { isAbsolute, join, relative, resolve } from 'node:path';

const LOCAL_DATABASE_PATH = './data/community-bot.sqlite';
const RAILWAY_DATABASE_FILENAME = 'community-bot.sqlite';

export function resolveDatabasePath(environment = process.env) {
  const configuredPath = environment.DATABASE_PATH?.trim();
  const volumeMountPath = environment.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const runningOnRailway = Boolean(
    environment.RAILWAY_ENVIRONMENT_ID
    || environment.RAILWAY_PROJECT_ID
    || environment.RAILWAY_SERVICE_ID,
  );

  if (!runningOnRailway) return configuredPath || LOCAL_DATABASE_PATH;
  if (!volumeMountPath) {
    throw new Error('Persistent storage is not configured. Attach a Railway volume before starting the bot.');
  }

  const databasePath = configuredPath || join(volumeMountPath, RAILWAY_DATABASE_FILENAME);
  if (!isPathInside(databasePath, volumeMountPath)) {
    throw new Error(`DATABASE_PATH must be inside the Railway volume mounted at ${volumeMountPath}.`);
  }
  return databasePath;
}

function isPathInside(filePath, directoryPath) {
  const relativePath = relative(resolve(directoryPath), resolve(filePath));
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}
