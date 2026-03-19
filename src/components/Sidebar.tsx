'use client';

import { useState } from 'react';
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
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/objectives', label: 'Objectives', icon: Target },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { unreadAlertCount } = useApp();

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

      <nav className="mt-4 px-3 space-y-1 flex-1">
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
