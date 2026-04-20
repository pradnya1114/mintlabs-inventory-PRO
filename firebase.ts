import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

// Import the local config file as a fallback for AI Studio
let localConfig: any = {};
try {
  localConfig = require('./firebase-applet-config.json');
} catch (e) {
  // Config file might not exist in production/Vercel
}

// Firebase configuration using environment variables for Vercel/Production
// Fallback to the local config file if environment variables are not set
const rawProjectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || localConfig.projectId || '').trim();
const rawDatabaseId = (process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID || localConfig.firestoreDatabaseId || '').trim();

// INTELLIGENT AUTO-RECOVERY: Detect if user swapped Project ID and Database ID
// Real project IDs: "led10-2e780"
// Database IDs: "ai-studio-8aadbe5a-8a6c-..."
// If Project ID is the long string, it is definitely a mistake.
const isProjectIdMistake = rawProjectId.startsWith('ai-studio-');
const isDatabaseIdMistake = rawDatabaseId.length > 0 && !rawDatabaseId.startsWith('ai-studio-');

// We swap ONLY if it looks clearly like a swap, otherwise we favor the raw values
// but we ALWAYS ensure projectId is the short name if we have a fallback
const isSwappedDetected = isProjectIdMistake && (isDatabaseIdMistake || !!localConfig.projectId);

let projectId = rawProjectId;
let databaseId = rawDatabaseId;

if (isProjectIdMistake && localConfig.projectId) {
  projectId = localConfig.projectId; // Force short ID for auth
  databaseId = rawProjectId; // The long ID belongs in databaseId
}

// Ensure authDomain is ALWAYS derived from the true projectId to fix Login
const authDomain = `${projectId}.firebaseapp.com`;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: authDomain,
  projectId: projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || localConfig.appId,
  firestoreDatabaseId: databaseId,
};

// Check if we are in a browser environment and missing keys
if (typeof window !== 'undefined' && !firebaseConfig.apiKey) {
  console.warn('Firebase API Key is missing. If you are in AI Studio, this is expected until you set up secrets. If you are on Vercel, please add your environment variables.');
}

// Initialize Firebase SDK safely
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Determine the most likely storage bucket name if missing
const derivedStorageBucket = firebaseConfig.storageBucket || 
  (firebaseConfig.projectId ? `${firebaseConfig.projectId}.firebasestorage.app` : '');

// Export services with a check to prevent crashing during build/prerendering
export const db = firebaseConfig.apiKey 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)')
  : null as any;

// Auth is particularly sensitive to invalid API keys during initialization
export const auth = firebaseConfig.apiKey 
  ? getAuth(app) 
  : null as any;

// Set persistence to local to ensure session survives refreshes
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error('Auth persistence error:', err);
  });
}

// Storage can be initialized with a specific bucket if the main config is missing it
export const storage = firebaseConfig.apiKey
  ? getStorage(app, derivedStorageBucket || undefined)
  : null as any;

// Create a copy of the config for UI display and diagnostics
export const activeConfig = {
  projectId: firebaseConfig.projectId,
  storageBucket: derivedStorageBucket,
  databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
  isSwapped: isSwappedDetected,
  expectedProjectId: localConfig.projectId,
  expectedDatabaseId: localConfig.firestoreDatabaseId
};

// Helper to check if Firebase is properly configured
export const isFirebaseConfigured = !!firebaseConfig.apiKey;

export { getStorage, getFirestore };
export type { FirebaseStorage, Firestore };
