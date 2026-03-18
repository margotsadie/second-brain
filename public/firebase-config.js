// ── Firebase Configuration ──────────────────────────────────────
// Replace these values with your own from the Firebase Console:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (or use existing)
// 3. Go to Project Settings > General > Your apps > Web app
// 4. Copy your config values below

const firebaseConfig = {
  apiKey: "AIzaSyDcGm6it9KnLG9kpWr-CUQOo46Yfj3Aw3k",
  authDomain: "second-brain-b2081.firebaseapp.com",
  projectId: "second-brain-b2081",
  storageBucket: "second-brain-b2081.firebasestorage.app",
  messagingSenderId: "133210424296",
  appId: "1:133210424296:web:463929bb69a43d1a3b5a5d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
