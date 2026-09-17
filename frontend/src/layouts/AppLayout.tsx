import { Outlet } from 'react-router-dom';
import { useMissionFeed, type MissionControls, type RecordedMessage } from '../hooks/useMissionFeed';
import { useTheme, type Theme } from '../hooks/useTheme';
import NavHeader from '../components/NavHeader';
import AlertToasts from '../components/AlertToasts';
import { WS_URL } from '../lib/config';
import { deriveLink, type LinkView } from '../lib/derive';
import type { MissionModel } from '../types';

export type LayoutContext = {
  model: MissionModel;
  now: number;
  link: LinkView;
  theme: Theme;
  controls: MissionControls;
  getSessionLog: () => RecordedMessage[];
};

export default function AppLayout() {
  const { model, now, controls, getSessionLog } = useMissionFeed(WS_URL);
  const { theme, toggleTheme } = useTheme();
  const link = deriveLink(model, now);

  return (
    <div className="app">
      <NavHeader theme={theme} onToggleTheme={toggleTheme} model={model} link={link} />
      <AlertToasts alerts={model.alerts} />
      <Outlet context={{ model, now, link, theme, controls, getSessionLog } satisfies LayoutContext} />
    </div>
  );
}
