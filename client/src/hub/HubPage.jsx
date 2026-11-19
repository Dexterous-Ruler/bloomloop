/**
 * The frame every hub screen sits in: the account shell, with the hub's own
 * crumb and the language switch. A student sees only their own progress here,
 * and the home says that their professor can see it too.
 */

import AccountShell from '../shell/AccountShell.jsx';
import Language from './Language.jsx';

export default function HubPage({ crumb = 'Learning Hub', title, sub, actions, width, language = true, children }) {
  return (
    <AccountShell
      current="hub"
      crumb={crumb}
      title={title}
      sub={sub}
      actions={language ? <>{actions}<Language /></> : actions}
      width={width}
    >
      <div className="hub">{children}</div>
    </AccountShell>
  );
}
