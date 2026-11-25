import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleAuthProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { AccountType, AvailabilityStatus, EmployeeInvite, RoleKey, UserAccount } from '../types/domain';

export type PortalIntent = 'employee' | 'customer' | 'admin' | 'guest';

interface RegisterOptions {
  intent: PortalIntent;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  jobTitle?: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserAccount | null;
  authReady: boolean;
  portalIntent: PortalIntent;
  setPortalIntent: (intent: PortalIntent) => void;
  getToken: () => Promise<string | null>;
  signInWithGoogle: (intent: PortalIntent) => Promise<void>;
  signInWithEmail: (email: string, password: string, intent: PortalIntent) => Promise<void>;
  registerWithEmail: (opts: RegisterOptions) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updateAvailability: (availability: AvailabilityStatus) => Promise<void>;
  logout: () => Promise<void>;
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'sevenjoel326@gmail.com';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserAccount | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [portalIntent, setPortalIntent] = useState<PortalIntent>('employee');
  const [authError, setAuthError] = useState<string | null>(null);
  const pendingIntentRef = useRef<PortalIntent>('employee');
  const pendingCustomerPhoneRef = useRef<string>('');
  const pendingFullNameRef = useRef<string>('');

  const updateIntent = (intent: PortalIntent) => {
    setPortalIntent(intent);
    pendingIntentRef.current = intent;
  };

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setAuthReady(true);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      unsubProfile = onSnapshot(
        userRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserAccount;
            setProfile(data);
            setAuthReady(true);
          } else {
            // Create account profile strictly matching portal intent & invite verification
            try {
              const now = new Date().toISOString();
              const email = (user.email || '').toLowerCase();
              const intent = pendingIntentRef.current;
              const isBootstrapAdmin = email === BOOTSTRAP_SUPER_ADMIN_EMAIL && user.emailVerified;

              let accountType: AccountType = 'customer';
              let role: RoleKey = 'customer';
              let status: UserAccount['status'] = 'active';
              let departmentId = '';
              let departmentName = '';
              let jobTitle = '';
              let inviteId = '';

              if (isBootstrapAdmin && (intent === 'admin' || intent === 'employee')) {
                accountType = 'employee';
                role = 'super_admin';
                status = 'active';
                departmentName = 'Executive & IT';
                jobTitle = 'Super Administrator';
              } else if (intent === 'employee' || intent === 'admin') {
                accountType = 'employee';
                // Check for a pending admin-issued invite matching this email
                const inviteQ = query(
                  collection(db, 'employeeInvites'),
                  where('email', '==', email),
                  where('status', '==', 'pending')
                );
                const inviteSnap = await getDocs(inviteQ);
                if (!inviteSnap.empty) {
                  const invDoc = inviteSnap.docs[0];
                  const inv = invDoc.data() as EmployeeInvite;
                  inviteId = invDoc.id;
                  role = inv.role;
                  departmentId = inv.departmentId || '';
                  departmentName = inv.departmentName || '';
                  jobTitle = inv.jobTitle || '';
                  status = 'active';
                } else {
                  role = 'employee';
                  status = 'pending_approval';
                }
              } else if (intent === 'guest') {
                accountType = 'external_guest';
                role = 'external_guest';
                status = 'active';
              } else {
                accountType = 'customer';
                role = 'customer';
                status = 'active';
              }

              const newProfile: UserAccount = {
                uid: user.uid,
                email,
                fullName: pendingFullNameRef.current || user.displayName || email.split('@')[0] || 'User',
                ...(pendingCustomerPhoneRef.current ? { phone: pendingCustomerPhoneRef.current } : {}),
                ...(user.photoURL ? { photoUrl: user.photoURL } : {}),
                accountType,
                role,
                status,
                ...(departmentId ? { departmentId } : {}),
                ...(departmentName ? { departmentName } : {}),
                ...(jobTitle ? { jobTitle } : {}),
                ...(inviteId ? { inviteId } : {}),
                availability: 'available',
                mfaEnabled: false,
                biometricEnabled: false,
                createdAt: now,
                updatedAt: now,
              };

              const batch = writeBatch(db);
              batch.set(userRef, newProfile);

              if (inviteId) {
                batch.update(doc(db, 'employeeInvites', inviteId), {
                  status: 'claimed',
                  updatedAt: now,
                });
              }

              if (accountType === 'employee' && status === 'active') {
                batch.set(doc(db, 'employeeDirectory', user.uid), {
                  uid: user.uid,
                  fullName: newProfile.fullName,
                  role: newProfile.role,
                  ...(departmentId ? { departmentId } : {}),
                  ...(departmentName ? { departmentName } : {}),
                  ...(jobTitle ? { jobTitle } : {}),
                  availability: 'available',
                  ...(newProfile.photoUrl ? { photoUrl: newProfile.photoUrl } : {}),
                  updatedAt: now,
                });
              } else if (accountType === 'customer') {
                batch.set(doc(db, 'customerDirectory', user.uid), {
                  uid: user.uid,
                  displayName: newProfile.fullName,
                  ...(newProfile.photoUrl ? { photoUrl: newProfile.photoUrl } : {}),
                  availability: 'available',
                  updatedAt: now,
                });
              }

              batch.set(doc(collection(db, 'auditLogs')), {
                actorUid: user.uid,
                actorEmail: email,
                actorRole: role,
                action: 'USER_REGISTERED',
                targetType: 'user',
                targetId: user.uid,
                details: `Account created via ${intent} portal (${accountType}, status: ${status})`,
                severity: 'info',
                createdAt: now,
              });

              await batch.commit();
              setProfile(newProfile);
            } catch (err) {
              console.error('Failed to provision user profile:', err);
              setAuthError(
                err instanceof Error
                  ? err.message
                  : 'Unable to initialize your account profile. Please ensure your email is verified.'
              );
            } finally {
              setAuthReady(true);
            }
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const getToken = async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  const signInWithGoogle = async (intent: PortalIntent) => {
    setAuthError(null);
    updateIntent(intent);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string, intent: PortalIntent) => {
    setAuthError(null);
    updateIntent(intent);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Email sign-in failed.';
      if (msg.includes('operation-not-allowed')) {
        setAuthError(
          'Email/Password sign-in is not yet enabled in the Firebase Console for this project. Use Google Sign-In, or enable Email/Password under Firebase Console → Authentication → Sign-in method.'
        );
      } else {
        setAuthError(msg);
      }
      throw err;
    }
  };

  const registerWithEmail = async (opts: RegisterOptions) => {
    setAuthError(null);
    updateIntent(opts.intent);
    pendingCustomerPhoneRef.current = opts.phone?.trim() || '';
    pendingFullNameRef.current = opts.fullName.trim();
    try {
      const cred = await createUserWithEmailAndPassword(auth, opts.email.trim(), opts.password);
      await updateProfile(cred.user, { displayName: opts.fullName.trim() });
      await sendEmailVerification(cred.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      if (msg.includes('operation-not-allowed')) {
        setAuthError(
          'Email/Password registration is not yet enabled in Firebase Console → Authentication → Sign-in method. Please use Google Sign-In or enable Email/Password provider in Firebase Console.'
        );
      } else {
        setAuthError(msg);
      }
      throw err;
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    await sendPasswordResetEmail(auth, email.trim());
  };

  const updateAvailability = async (availability: AvailabilityStatus) => {
    if (!profile) return;
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        availability,
        updatedAt: now,
      });
      if (profile.accountType === 'employee' && profile.status === 'active') {
        await setDoc(
          doc(db, 'employeeDirectory', profile.uid),
          {
            uid: profile.uid,
            fullName: profile.fullName,
            role: profile.role,
            ...(profile.departmentId ? { departmentId: profile.departmentId } : {}),
            ...(profile.departmentName ? { departmentName: profile.departmentName } : {}),
            ...(profile.jobTitle ? { jobTitle: profile.jobTitle } : {}),
            availability,
            ...(profile.photoUrl ? { photoUrl: profile.photoUrl } : {}),
            updatedAt: now,
          },
          { merge: true }
        );
      } else if (profile.accountType === 'customer') {
        await setDoc(
          doc(db, 'customerDirectory', profile.uid),
          {
            uid: profile.uid,
            displayName: profile.fullName,
            ...(profile.photoUrl ? { photoUrl: profile.photoUrl } : {}),
            availability,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  const logout = async () => {
    setAuthError(null);
    if (profile && profile.status === 'active') {
      try {
        await updateAvailability('offline');
      } catch {
        // Best-effort offline presence update should never block signOut
      }
    }
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        authReady,
        portalIntent,
        setPortalIntent: updateIntent,
        getToken,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resendVerificationEmail,
        requestPasswordReset,
        updateAvailability,
        logout,
        authError,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
