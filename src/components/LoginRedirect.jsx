import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Login from "./Login/login";

export default function LoginRedirect() {
  const { user } = useAuth();

  // Already logged in → dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Login />;
}