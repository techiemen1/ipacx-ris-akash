import React, { createContext, useContext, useState, useEffect } from "react";
import { logLogoutEvent } from "../utils/auditClient";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore user and token from sessionStorage
  useEffect(() => {
    const storedUser = sessionStorage.getItem("user");
    const storedToken = sessionStorage.getItem("token");
    if (storedUser && storedToken) {
      setUser(JSON.parse(storedUser));
      setToken(storedToken);
    }
    setLoading(false);
  }, []);

  // Login with token
  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    sessionStorage.setItem("user", JSON.stringify(userData));
    sessionStorage.setItem("token", authToken);
  };

  // Logout
  const logout = async () => {
    await logLogoutEvent();
    setUser(null);
    setToken(null);
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    window.location.href = "/";
  };

  // Expire token (for idle timeout)
  const expireToken = () => {
    setToken(null);
    sessionStorage.removeItem("token");
    // Keep user data for potential re-login, but clear token
  };

  // Setup idle timeout for auto-logout
  useEffect(() => {
    let timeoutId;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      if (token) {
        // 15 minutes = 15 * 60 * 1000 ms
        timeoutId = setTimeout(() => {
          logout();
          alert("You have been automatically logged out due to 15 minutes of inactivity.");
        }, 15 * 60 * 1000);
      }
    };

    if (token) {
      // Listen to these events to detect activity
      const events = ["mousemove", "keydown", "scroll", "click"];
      events.forEach((event) => window.addEventListener(event, resetTimer));

      // Start the timer initially
      resetTimer();

      // Cleanup
      return () => {
        clearTimeout(timeoutId);
        events.forEach((event) => window.removeEventListener(event, resetTimer));
      };
    }
  }, [token]);


  return (
    <AuthContext.Provider value={{ user, token, login, logout, expireToken, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
