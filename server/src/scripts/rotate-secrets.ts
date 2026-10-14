import { rotateSecrets } from '../services/rotation.services.js';
import { closeConnection } from '../config/db.js';
import { safeError } from '../utils/errors.js';
try {
  console.info(JSON.stringify(await rotateSecrets(process.argv.includes('--dry-run'))));
} catch (error) {
  console.error('Rotation failed: ' + safeError(error) + '; transaction rolled back');
  process.exitCode = 1;
} finally {
  await closeConnection();
}
