import { useEffect, useState } from 'react';

export const useTheme = () => {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return { isDark, toggleTheme: () => setIsDark(v => !v) };
};
