import { createContext, useContext } from 'react';

const AuthContext = createContext({ benutzer: null, abmelden: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export default AuthContext;
