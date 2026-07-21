import { Firestore } from '@google-cloud/firestore';

// `GOOGLE_CLOUD_PROJECT` is set automatically inside Google Cloud Run / App
// Engine. Locally, set it in `.env` (or via `gcloud auth application-default
// login`, which exports it). If neither is set the Firestore client falls
// back to Application Default Credentials' project.
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;

export const db = new Firestore(projectId ? { projectId } : {});
