// Public Firebase web config + Web Push VAPID public key. These are client
// identifiers (not secrets) and are safe in the bundle. The service account
// (server secret) lives only in the FIREBASE_SERVICE_ACCOUNT server env var.
export const firebaseConfig = {
  apiKey: "AIzaSyBYdtG1ezZ4XEjGhhdaFVsYF7jHmMQOUeU",
  authDomain: "katalist-d2f9e.firebaseapp.com",
  projectId: "katalist-d2f9e",
  storageBucket: "katalist-d2f9e.firebasestorage.app",
  messagingSenderId: "485296168291",
  appId: "1:485296168291:web:9d8e2b1d50e55841974756",
  measurementId: "G-VLJQ76JV4Z",
} as const;

export const VAPID_KEY =
  "BGD0kLa8gZoc68nowAQQ877epuSNApF9Tkr_34ug9WYIA2ebVhe5356CcthxIztha9qexgytOVAFN3P6SrAyoX8";
