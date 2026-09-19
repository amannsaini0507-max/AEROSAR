import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LiveOperations from './pages/LiveOperations';
import MissionControl from './pages/MissionControl';
import MissionHistory from './pages/MissionHistory';
import BriefingView from './pages/BriefingView';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<LiveOperations />} />
          <Route path="mission-control" element={<MissionControl />} />
          <Route path="mission-history" element={<MissionHistory />} />
          <Route path="briefing" element={<BriefingView />} />
          {/* old paths from the first version of the dashboard */}
          <Route path="mission-setup" element={<Navigate to="/mission-control" replace />} />
          <Route path="standalone" element={<Navigate to="/briefing" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
