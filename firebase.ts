import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
