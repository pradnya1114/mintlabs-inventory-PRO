import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Import the local config file as a fallback for AI Studio
let localConfig: any = {};
try {
  localConfig = require('./firebase-applet-config.json');
} catch (e) {
  // Config file might not exist in production/Vercel
}

// Firebase configuration using environment variables for Vercel/Production
// Fallback to the local config file if environment variables are not set
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || localConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || localConfig.appId,
  firestoreDatabaseId: process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID || localConfig.firestoreDatabaseId,
};

// Check if we are in a browser environment and missing keys
if (typeof window !== 'undefined' && !firebaseConfig.apiKey) {
  console.warn('Firebase API Key is missing. If you are in AI Studio, this is expected until you set up secrets. If you are on Vercel, please add your environment variables.');
}

// Initialize Firebase SDK safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Export services with a check to prevent crashing during build/prerendering
export const db = firebaseConfig.apiKey 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)')
  : null as any;

// Auth is particularly sensitive to invalid API keys during initialization
export const auth = firebaseConfig.apiKey 
  ? getAuth(app) 
  : null as any;

export const storage = firebaseConfig.apiKey
  ? getStorage(app)
  : null as any;

// Helper to check if Firebase is properly configured
export const isFirebaseConfigured = !!firebaseConfig.apiKey;
