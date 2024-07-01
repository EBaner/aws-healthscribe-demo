import React, { createContext, useContext } from 'react';

import { useAuthenticator } from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import { AuthUser } from 'aws-amplify/auth';

import config from '@/amplifyconfiguration.json';

// Move this to your app's entry point if it's not already there
Amplify.configure(config);

interface CustomAttributes {
    'custom:Clinic'?: string;
    [key: string]: string | undefined;
}

type ExtendedAuthUser = AuthUser & {
    attributes?: CustomAttributes;
};

interface AuthContextType {
    isUserAuthenticated: boolean;
    user: ExtendedAuthUser | null;
    signOut: () => void;
}

export const AuthContext = createContext<AuthContextType>({
    isUserAuthenticated: false,
    user: null,
    signOut: () => {},
});

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuthContext must be used within an AuthContextProvider');
    }
    return context;
}

export default function AuthContextProvider({ children }: { children: React.ReactNode }) {
    const { authStatus, user, signOut } = useAuthenticator((context) => [context.user]);

    const authContextValue: AuthContextType = {
        isUserAuthenticated: authStatus === 'authenticated',
        user: user as ExtendedAuthUser,
        signOut: signOut,
    };

    return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
}
