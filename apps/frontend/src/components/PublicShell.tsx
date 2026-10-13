'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, ConfigProvider, Drawer, Dropdown, Flex, Menu as AntMenu, Tooltip } from 'antd';
import { BarChart3, CalendarDays, ChevronDown, LogIn, LogOut, Mail, Menu, Moon, Newspaper, Sun, Trophy, UserRound, X } from 'lucide-react';
import {
  applyDocumentColorMode,
  createSportdataTheme,
  type SportdataColorMode,
} from '@/components/AntdProvider';
import { SITE_CONFIG } from '@/config/site';
import { clearParticipantSession, getParticipantAccount } from '@/lib/participant-auth';

const navigation = [
  { href: '/', label: 'Trang chủ', icon: BarChart3 },
  { href: '/events', label: 'Bộ môn', icon: CalendarDays },
  { href: '/news', label: 'Tin tức', icon: Newspaper },
  { href: '/contact', label: 'Liên hệ', icon: Mail },
];

export function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorMode, setColorMode] = useState<SportdataColorMode>('dark');
  const [participant, setParticipant] = useState<ReturnType<typeof getParticipantAccount>>(null);
  const isLight = colorMode === 'light';
  const publicTheme = useMemo(() => createSportdataTheme(colorMode), [colorMode]);
  const accountHref = '/account';
  const selectedKey = navigation.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  )?.href || '/';

  const mobileMenuItems = navigation.map(({ href, label, icon: Icon }) => ({
    key: href,
    label,
    icon: <Icon className="h-5 w-5" />,
  }));

  useEffect(() => {
    setMenuOpen(false);

    if (pathname.startsWith('/cms') || pathname === '/d') return;

    const savedTheme = localStorage.getItem('public_color_mode');
    let nextMode: SportdataColorMode = 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
      nextMode = savedTheme;
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      nextMode = 'light';
    }
    applyDocumentColorMode(nextMode);
    setColorMode(nextMode);
    setParticipant(getParticipantAccount());
  }, [pathname]);

  useEffect(() => {
    const sync = () => setParticipant(getParticipantAccount());
    window.addEventListener('participant-session-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('participant-session-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggleColorMode = () => {
    setColorMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('public_color_mode', next);
      applyDocumentColorMode(next);
      return next;
    });
  };

  const signOut = () => {
    clearParticipantSession();
    setParticipant(null);
    router.push('/');
  };

  const themeToggle = (
    <Tooltip title={isLight ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}>
      <Button
        type="text"
        shape="circle"
        aria-label={isLight ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
        aria-pressed={isLight}
        icon={isLight ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        onClick={toggleColorMode}
      />
    </Tooltip>
  );

  if (pathname.startsWith('/cms') || pathname === '/d') return <>{children}</>;

  return (
    <ConfigProvider theme={publicTheme}>
    <AntApp message={{ top: 76, duration: 4, maxCount: 3 }}>
    <div className={`min-h-screen ${isLight ? 'public-theme-light bg-[#f4f7fb]' : 'bg-sdark-950'}`}>
      <header className={`public-site-header sticky top-0 z-50 border-b backdrop-blur-xl ${isLight ? 'border-slate-200 bg-white/90' : 'border-white/10 bg-sdark-950/90'}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="SportData - Trang chủ">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sblue-400 to-sblue-700 shadow-lg shadow-sblue-500/20">
              <Trophy className="h-5 w-5 text-white" />
            </span>
            <span>
              <span className={`block text-base font-black tracking-tight ${isLight ? 'text-slate-950' : 'text-white'}`}>{SITE_CONFIG.name.toUpperCase()}</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-sblue-400">Nền tảng sự kiện</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Điều hướng chính">
            {navigation.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? isLight ? 'bg-sblue-500/10 text-sblue-700' : 'bg-white/10 text-white'
                      : isLight ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-950' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {participant ? (
              <Dropdown
                placement="bottomRight"
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'profile', icon: <UserRound className="h-4 w-4" />, label: 'Hồ sơ tài khoản' },
                    { type: 'divider' },
                    { key: 'logout', danger: true, icon: <LogOut className="h-4 w-4" />, label: 'Đăng xuất' },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'logout') signOut();
                    if (key === 'profile') router.push(accountHref);
                  },
                }}
              >
                <Button className="hidden sm:!inline-flex" icon={<UserRound className="h-4 w-4" />}>
                  <span className="max-w-40 truncate">{participant.displayName}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </Dropdown>
            ) : (
              <Link href="/account/login" className="hidden sm:block">
                <Button type="primary" icon={<LogIn className="h-4 w-4" />}>Đăng nhập</Button>
              </Link>
            )}
            {themeToggle}
            <Button
              type="text"
              onClick={() => setMenuOpen(true)}
              className="!inline-flex lg:!hidden"
              icon={<Menu className="h-5 w-5" />}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label="Mở menu"
            />
          </div>
        </div>
      </header>

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="left"
        size="min(288px, calc(100vw - 24px))"
        closable={false}
        rootClassName="lg:hidden"
        styles={{ body: { padding: 0 } }}
      >
        <Flex id="mobile-navigation" vertical className={`h-full overflow-x-hidden ${isLight ? 'bg-white' : 'bg-[#0d1425]'}`}>
          <Flex
            align="center"
            justify="space-between"
            className={`h-[72px] min-h-[72px] shrink-0 border-b px-5 ${isLight ? 'border-slate-200' : 'border-white/10'}`}
          >
            <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="SportData - Trang chủ" onClick={() => setMenuOpen(false)}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sblue-400 to-sblue-700 shadow-lg shadow-sblue-500/20">
                <Trophy className="h-5 w-5 text-white" />
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-base font-black tracking-tight ${isLight ? 'text-slate-950' : 'text-white'}`}>{SITE_CONFIG.name.toUpperCase()}</span>
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-sblue-400">Nền tảng sự kiện</span>
              </span>
            </Link>
            <Button
              type="text"
              shape="circle"
              icon={<X className="h-5 w-5" />}
              aria-label="Đóng menu"
              onClick={() => setMenuOpen(false)}
            />
          </Flex>

          <AntMenu
            theme={isLight ? 'light' : 'dark'}
            mode="inline"
            selectedKeys={[selectedKey]}
            items={mobileMenuItems}
            className="flex-1 border-0 px-3 py-5"
            onClick={({ key }) => {
              router.push(key);
              setMenuOpen(false);
            }}
          />
          <div className={`border-t p-4 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
            <Button
              block
              type="primary"
              icon={participant ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              onClick={() => {
                router.push(participant ? accountHref : '/account/login');
                setMenuOpen(false);
              }}
            >
              {participant ? 'Tài khoản SportData' : 'Đăng nhập / Đăng ký'}
            </Button>
            {participant && (
              <Button
                block
                type="text"
                className="mt-2"
                icon={<LogOut className="h-4 w-4" />}
                onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }}
              >
                Đăng xuất
              </Button>
            )}
          </div>
        </Flex>
      </Drawer>

      <main>{children}</main>

      <footer className={`border-t ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-sdark-950'}`}>
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-slate-500 sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
          <div className="max-w-xl">
            <p className={`font-black ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>{SITE_CONFIG.legalName}</p>
            <p className="mt-2 leading-6">{SITE_CONFIG.description}</p>
            <p className="mt-4 text-xs">© 2026 {SITE_CONFIG.name}. Bảo lưu mọi quyền.</p>
          </div>
          <div className="flex flex-wrap content-start gap-x-5 gap-y-3 lg:max-w-lg lg:justify-end">
            {navigation.slice(1).map((item) => (
              <Link
                href={item.href}
                key={item.href}
                className={isLight ? 'hover:text-slate-950' : 'hover:text-slate-200'}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
    </AntApp>
    </ConfigProvider>
  );
}
