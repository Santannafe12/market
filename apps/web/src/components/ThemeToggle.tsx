import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const THEME_KEY = 'market.theme';

/** The class on <html> is the only theme switch. index.html applies the saved value before React. */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // Private mode: the theme still changes for this tab.
    }
    setDark(next);
  }

  const label = dark ? 'Usar tema claro' : 'Usar tema escuro';
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
