/**
 * The Learning Hub for a professor (and, read-only, the department's HOD).
 *
 *   /hubs                        the classes and their hubs
 *   /hubs/c/:classId             one class (?tab=structure|progress|states)
 *   /hubs/c/:classId/s/:rosterId one student's hub, read-only
 *   /hubs/ch/:contentId          one chapter (?tab=topics|explanations|hints|translations|languages)
 *   /hubs/t/:topicId             one topic (?tab=links|lessons)
 *   /hubs/links                  proposed prerequisite links waiting for a decision
 *
 * The server decides who may change what (canEdit, access: 'reader'); every
 * control hides when it says no.
 */

import { Navigate, Route, Routes } from 'react-router-dom';

import '../styles/hub.css';
import '../styles/hub-staff.css';
import '../styles/hub-queues.css';
import '../styles/hub-progress.css';
import LinkQueue from './LinkQueue.jsx';
import StaffChapter from './StaffChapter.jsx';
import StaffClass from './StaffClass.jsx';
import StaffHome from './StaffHome.jsx';
import StaffTopic from './StaffTopic.jsx';
import StudentProgress from './StudentProgress.jsx';

export default function HubStaffApp() {
  return (
    <Routes>
      <Route index element={<StaffHome />} />
      <Route path="c/:classId" element={<StaffClass />} />
      <Route path="c/:classId/s/:rosterId" element={<StudentProgress />} />
      <Route path="ch/:contentId" element={<StaffChapter />} />
      <Route path="t/:topicId" element={<StaffTopic />} />
      <Route path="links" element={<LinkQueue />} />
      <Route path="*" element={<Navigate to="/hubs" replace />} />
    </Routes>
  );
}
