import React from 'react';
import { render } from '@testing-library/react';
import App from './App';
import { AuthProvider } from './context/AuthContext';

test('renders IPACX-RIS application shell without crashing', () => {
  const { container } = render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  expect(container).toBeInTheDocument();
});
