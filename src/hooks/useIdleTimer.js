import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";

export default function useIdleTimer(idleTime = 15 * 60 * 1000) {
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!user) return;

    let timer;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        alert("Session expired due to inactivity. Please login again.");
        logout();
      }, idleTime);
    };

    // Reset timer on any user activity
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart", "touchmove"];
    events.forEach((event) =>
      window.addEventListener(event, resetTimer, { passive: true })
    );

    resetTimer(); // Start the timer initially

    return () => {
      clearTimeout(timer);
      events.forEach((event) =>
        window.removeEventListener(event, resetTimer)
      );
    };
  }, [user, idleTime, logout]);
}
