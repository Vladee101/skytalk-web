import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AudioDevPage from './pages/AudioDevPage';
import Ended from './pages/Ended';
import Landing from './pages/Landing';
import StudentSession from './pages/StudentSession';
import TutorDashboard from './pages/TutorDashboard';
import TutorSession from './pages/TutorSession';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tutor" element={<Landing />} />
        <Route path="/tutor/dashboard" element={<TutorDashboard />} />
        <Route path="/tutor/:roomId" element={<TutorSession />} />
        <Route path="/student/:roomId" element={<StudentSession />} />
        <Route path="/ended" element={<Ended />} />
        <Route path="/dev/audio" element={<AudioDevPage />} />
      </Routes>
    </BrowserRouter>
  );
}
