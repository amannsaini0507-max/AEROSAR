import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Theme } from '../hooks/useTheme';
import type { MissionModel } from '../types';
import type { LinkView } from '../lib/derive';
import ConnectionIndicator from './ConnectionIndicator';
import { SparkleIcon, PulseIcon, SlidersIcon, ClockIcon, GlobeIcon, HamburgerIcon, SunIcon, MoonIcon } from './icons';

const NAV_ITEMS = [
  { to: '/', label: 'Live operations', icon: <PulseIcon />, end: true },
  { to: '/mission-control', label: 'Mission control', icon: <SlidersIcon /> },
  { to: '/mission-history', label: 'Mission history', icon: <ClockIcon /> },
  { to: '/briefing', label: 'Briefing view', icon: <GlobeIcon /> }
];

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  model: MissionModel;
  link: LinkView;
}

export default function NavHeader({ theme, onToggleTheme, model, link }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="nav">
        <div className="nav__brand">
          <div className="nav__brand-mark">
            <SparkleIcon />
          </div>
          <div>
            <div className="nav__brand-title">
              Aero<span>SAR</span>
            </div>
            <div className="nav__brand-subtitle">Command center</div>
          </div>
        </div>

        <nav className="nav__links">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => 'nav__link' + (isActive ? ' is-active' : '')}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav__right">
          <div className="nav__mission mono" title="Current mission">
            {model.mission ? model.mission.missionId : 'No mission'}
          </div>
          {model.source === 'simulator' && (
            <span className="sim-badge" title="Data comes from the built-in demo simulator, not the drone">
              Simulated data
            </span>
          )}
          <ConnectionIndicator link={link} compact />
          <button
            className="theme-toggle"
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title="Toggle theme"
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button
            className="nav__menu-toggle"
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      <nav className={'nav__mobile-links' + (menuOpen ? ' is-open' : '')}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'nav__link' + (isActive ? ' is-active' : '')}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
