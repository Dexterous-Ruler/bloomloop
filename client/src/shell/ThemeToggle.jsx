/**
 * A plain button that flips the theme, for screens outside the frame. Its own
 * module so the student's join screen can have it without downloading the
 * frame it would otherwise come with.
 */

import { useTheme } from '../lib/theme.js';
import { Button, Tip } from '../ui/index.jsx';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Tip label={`Switch to ${next}`}>
      <Button variant="ghost" size="sm" icon={theme === 'dark' ? 'sun' : 'moon'} aria-label={`Switch to ${next} theme`} onClick={toggle} />
    </Tip>
  );
}
