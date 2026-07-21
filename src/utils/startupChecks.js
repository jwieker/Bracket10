import { db as firestoreDb } from '../config/firestore.js';
import Logger from './logger.js';

/**
 * Verifies access to Firestore by listing collections.
 */
export async function verifyDatabaseAccess() {
  Logger.info(`Verifying Firestore database access...`);
  try {
    await firestoreDb.listCollections();
    Logger.info(`Successfully accessed Firestore. Permissions are sufficient.`);
  } catch (error) {
    Logger.error(`Failed to verify Firestore access:`, error.message);
    throw new Error(`Firestore access check failed: ${error.message}`, {
      cause: error,
    });
  }
}
