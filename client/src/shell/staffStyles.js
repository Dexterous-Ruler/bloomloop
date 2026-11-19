// The stylesheets only the console and the account screens use. main.jsx loads
// this alongside each of those screens, so a phone at /join never downloads them.
import '../styles/teach.css';
import '../styles/live.css';
import '../styles/account.css';
import '../styles/auth.css';
import '../styles/insight.css';
import '../styles/review.css';
import '../styles/author.css';
import '../styles/items.css';
import '../styles/roomset.css';
// Phase 3: classes, the room's lobby and attendance, teacher records, live
// insights and the projector's controls. The wall itself (styles/wall.css)
// is imported by teach/Wall.jsx alone.
import '../styles/classes.css';
import '../styles/attend.css';
import '../styles/records.css';
import '../styles/coach.css';
import '../styles/beam.css';
// The icons only these screens draw (the phone's are in ui/Icon.jsx).
import '../ui/staffIcons.js';
// Phase 4: course outcomes, attainment, the marks register, roster import.
import '../styles/reports.css';
import '../styles/outcomes.css';
import '../styles/attain.css';
import '../styles/register.css';
