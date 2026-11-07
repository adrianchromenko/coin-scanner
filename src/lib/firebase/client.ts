"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase web config. These NEXT_PUBLIC_ values are baked into the browser
 * bundle at build time; they identify the project and are safe to expose.
 * Access is controlled by Firestore security rules (see firestore.rules).
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True when the deployment has a Firebase project configured. Accounts are hidden otherwise. */
export const firebaseEnabled = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

type Services = { app: FirebaseApp; auth: Auth; db: Firestore };
let cached: Services | null = null;

/** Lazily initialise the Firebase app, auth and Firestore (browser only). */
export function firebase(): Services {
  if (!firebaseEnabled) {
    throw new Error("Accounts are not set up on this deployment (NEXT_PUBLIC_FIREBASE_* is missing)");
  }
  if (!cached) {
    const app = getApps().length ? getApp() : initializeApp(config);
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return cached;
}
