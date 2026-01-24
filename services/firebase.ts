/**
 * Firebase Configuration and Initialization
 * 
 * Este arquivo configura e inicializa o Firebase SDK
 * para autenticação, Firestore e Storage.
 */

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  Auth, 
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  serverTimestamp,
  onSnapshot,
  QuerySnapshot,
  DocumentSnapshot
} from 'firebase/firestore';
import { 
  getStorage, 
  Storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Validate Firebase configuration
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'your_firebase_api_key_here') {
  console.error('❌ Firebase API Key não configurada!');
  console.error('Por favor, configure as variáveis do Firebase no arquivo .env.local');
  console.error('Veja o arquivo CONFIGURAR_FIREBASE.md para instruções');
}

// Initialize Firebase (only if not already initialized)
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize services
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: Storage = getStorage(app);

// Auth Providers
export const googleProvider = new GoogleAuthProvider();

// Auth Helper Functions
export const authHelpers = {
  signInWithEmail: (email: string, password: string) => 
    signInWithEmailAndPassword(auth, email, password),
  
  signUpWithEmail: (email: string, password: string) => 
    createUserWithEmailAndPassword(auth, email, password),
  
  signOut: () => signOut(auth),
  
  resetPassword: (email: string) => 
    sendPasswordResetEmail(auth, email),
  
  updateUserProfile: (user: FirebaseUser, data: { displayName?: string; photoURL?: string }) =>
    updateProfile(user, data),
  
  onAuthStateChanged: (callback: (user: FirebaseUser | null) => void) =>
    onAuthStateChanged(auth, callback)
};

// Firestore Helper Functions
export const firestoreHelpers = {
  // Collections
  getCollection: (collectionName: string) => collection(db, collectionName),
  
  // Documents
  getDoc: async (collectionName: string, docId: string) => {
    const docRef = doc(db, collectionName, docId);
    return await getDoc(docRef);
  },
  
  setDoc: async (collectionName: string, docId: string, data: any) => {
    const docRef = doc(db, collectionName, docId);
    return await setDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  },
  
  updateDoc: async (collectionName: string, docId: string, data: any) => {
    const docRef = doc(db, collectionName, docId);
    return await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  },
  
  deleteDoc: async (collectionName: string, docId: string) => {
    const docRef = doc(db, collectionName, docId);
    return await deleteDoc(docRef);
  },
  
  // Queries
  queryCollection: (
    collectionName: string,
    constraints: Array<any> = [],
    orderByField?: string,
    orderDirection: 'asc' | 'desc' = 'desc',
    limitCount?: number
  ) => {
    const collectionRef = collection(db, collectionName);
    let q = query(collectionRef, ...constraints);
    
    if (orderByField) {
      q = query(q, orderBy(orderByField, orderDirection));
    }
    
    if (limitCount) {
      q = query(q, limit(limitCount));
    }
    
    return q;
  },
  
  getDocs: async (q: any) => await getDocs(q),
  
  // Real-time listeners
  onSnapshot: (
    collectionName: string,
    callback: (snapshot: QuerySnapshot) => void,
    constraints: Array<any> = [],
    orderByField?: string,
    orderDirection: 'asc' | 'desc' = 'desc'
  ) => {
    const q = firestoreHelpers.queryCollection(
      collectionName,
      constraints,
      orderByField,
      orderDirection
    );
    return onSnapshot(q, callback);
  },
  
  // Timestamp helpers
  serverTimestamp: () => serverTimestamp(),
  timestamp: (date: Date) => Timestamp.fromDate(date),
  toDate: (timestamp: Timestamp) => timestamp.toDate()
};

// Storage Helper Functions
export const storageHelpers = {
  uploadFile: async (path: string, file: Blob | Uint8Array, metadata?: any) => {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(storageRef);
  },
  
  getDownloadURL: async (path: string) => {
    const storageRef = ref(storage, path);
    return await getDownloadURL(storageRef);
  },
  
  deleteFile: async (path: string) => {
    const storageRef = ref(storage, path);
    return await deleteObject(storageRef);
  }
};

// Export default app for advanced usage
export default app;
