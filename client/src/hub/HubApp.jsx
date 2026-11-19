/**
 * The Learning Hub: a signed-in student's own place to learn between rooms.
 *
 *   /hub                         home: notice, reviews due, goals, paths, the weeks, the mastery map
 *   /hub/goals                   goals: an exam date and topics (only the student sees them)
 *   /hub/c/:classId              one class: units, chapters and topics with their states
 *   /hub/t/:topicId              a topic: prerequisites nearest first, its lesson
 *   /hub/t/:topicId/practice     practice on a topic, with hints and an answer after each attempt
 *   /hub/practice?topicIds=&mode=review   a review set across topics
 *   /hub/review                  reviews due and coming up
 *   /hub/errors                  the error log
 *   /hub/exam                    self-tests: start one, resume one, past results
 *   /hub/exam/:examId            one self-test, open or ended
 *   /hub/ready                   past Get Ready checks
 *   /hub/ready/:topicId          "Skip what I know · short check" before a topic
 *   /hub/ready/check/:checkId    one Get Ready check
 *
 * Every call goes through hubApi.js with the student's bearer token. Rooms stay
 * account-free: nothing here is reached from /join.
 */

import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import '../styles/hub.css';
import '../styles/hub-home.css';
import '../styles/hub-map.css';
import '../styles/hub-topic.css';
import '../styles/hub-practice.css';
import ClassMap from './ClassMap.jsx';
import Errors from './Errors.jsx';
import Exam from './Exam.jsx';
import GetReady from './GetReady.jsx';
import Goals from './Goals.jsx';
import Home from './Home.jsx';
import { flushPending } from './pending.js';
import Practice from './Practice.jsx';
import Review from './Review.jsx';
import Topic from './Topic.jsx';

export default function HubApp() {
  // Answers kept on this device from an earlier visit go first.
  useEffect(() => { flushPending(); }, []);
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="goals" element={<Goals />} />
      <Route path="c/:classId" element={<ClassMap />} />
      <Route path="t/:topicId" element={<Topic />} />
      <Route path="t/:topicId/practice" element={<Practice />} />
      <Route path="practice" element={<Practice />} />
      <Route path="review" element={<Review />} />
      <Route path="errors" element={<Errors />} />
      <Route path="exam" element={<Exam />} />
      <Route path="exam/:examId" element={<Exam />} />
      <Route path="ready" element={<GetReady />} />
      <Route path="ready/:topicId" element={<GetReady />} />
      <Route path="ready/check/:checkId" element={<GetReady />} />
      <Route path="*" element={<Navigate to="/hub" replace />} />
    </Routes>
  );
}
