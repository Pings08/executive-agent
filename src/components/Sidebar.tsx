'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/store/AppContext';
import {
  LayoutDashboard,
  Target,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronLeft,
  Menu,
  Bell,
  Users,
  Building2,
} from 'lucide-react';
import { WORKSPACE_LABELS, WORKSPACE_COLORS, type Workspace } from '@/types';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/objectives', label: 'Objectives', icon: Target },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const ALL_ORGS: Workspace[] = ['biotech', 'tcr', 'sentient_x'];

export function useSelectedOrg() {
  const [org, setOrg] = useState<Workspace>('biotech');

  useEffect(() => {
    const saved = localStorage.getItem('ea_selected_org') as Workspace | null;
    if (saved && ALL_ORGS.includes(saved)) setOrg(saved);
  }, []);

  const selectOrg = (newOrg: Workspace) => {
    setOrg(newOrg);
    localStorage.setItem('ea_selected_org', newOrg);
    // Dispatch custom event so other components can react
    window.dispatchEvent(new CustomEvent('org-changed', { detail: newOrg }));
  };

  return [org, selectOrg] as const;
}

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { unreadAlertCount } = useApp();
  const [selectedOrg, setSelectedOrg] = useSelectedOrg();

  return (
    <aside
      className={`relative h-screen bg-surface border-r border-border transition-all duration-300 flex flex-col ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className="p-6 flex items-center justify-between">
        {!isCollapsed && (
          <span className="text-xl font-bold tracking-tight">EA</span>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-glass rounded-md transition-colors"
        >
          {isCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {/* Org Selector */}
      {!isCollapsed ? (
        <div className="px-3 mb-4">
          <div className="flex items-center gap-2 mb-2 px-2">
            <Building2 size={12} className="text-secondary" />
            <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Organization</span>
          </div>
          <div className="space-y-1">
            {ALL_ORGS.map(org => (
              <button
                key={org}
                onClick={() => setSelectedOrg(org)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  selectedOrg === org
                    ? WORKSPACE_COLORS[org]
                    : 'text-secondary hover:text-primary hover:bg-glass'
                }`}
              >
                {WORKSPACE_LABELS[org]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-3 mb-4 flex flex-col items-center gap-1">
          {ALL_ORGS.map(org => (
            <button
              key={org}
              onClick={() => setSelectedOrg(org)}
              className={`w-10 h-6 rounded text-[9px] font-bold transition-colors ${
                selectedOrg === org
                  ? WORKSPACE_COLORS[org]
                  : 'text-secondary hover:text-primary hover:bg-glass'
              }`}
              title={WORKSPACE_LABELS[org]}
            >
              {org === 'biotech' ? 'Ex' : org === 'tcr' ? 'TC' : 'Se'}
            </button>
          ))}
        </div>
      )}

      <nav className="mt-2 px-3 space-y-1 flex-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          const showBadge = item.href === '/' && unreadAlertCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''} ${isCollapsed ? 'justify-center' : ''} relative`}
            >
              <div className="relative">
                <Icon size={20} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white">
                    {unreadAlertCount > 9 ? '9+' : unreadAlertCount}
                  </span>
                )}
              </div>
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!isCollapsed && (
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-secondary">
            <Bell size={14} />
            <span>{unreadAlertCount} unread alert{unreadAlertCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
