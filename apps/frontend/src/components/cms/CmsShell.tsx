'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import useSWR, { SWRConfig } from 'swr';
import { api, clearAuthToken, fetcher, getAuthToken } from '@/lib/api';
import {
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Flex,
  Layout,
  Menu as AntMenu,
  Popover,
  Spin,
  Tooltip,
  Typography,
} from 'antd';
import {
  Building2,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu as MenuIcon,
  Images,
  Moon,
  Newspaper,
  Settings,
  Sun,
  Trophy,
  User,
  UserCog,
  Users,
} from 'lucide-react';
import {
  applyDocumentColorMode,
  createSportdataTheme,
  type SportdataColorMode,
} from '@/components/AntdProvider';
import {
  canAccessCmsPath,
  CMS_PAGE_ACCESS,
  CMS_ROLE_INFO,
  isCmsRole,
  type CmsRole,
} from '@/lib/cms-access';

type CmsNavLeaf = {
  label: string;
  key: string;
  icon: React.ReactNode;
  roles: readonly CmsRole[];
};

type CmsNavGroup = {
  label: string;
  key: string;
  icon: React.ReactNode;
  children: CmsNavLeaf[];
};

type CmsNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const navItems: Array<CmsNavLeaf | CmsNavGroup> = [
  { label: 'Dashboard', key: '/cms', icon: <LayoutDashboard className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms'] },
  { label: 'Sự kiện', key: '/cms/events', icon: <CalendarDays className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/events'] },
  { label: 'Bộ môn & hạng đấu', key: '/cms/sports', icon: <Trophy className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/sports'] },
  { label: 'Liên hệ', key: '/cms/contacts', icon: <Mail className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/contacts'] },
  {
    label: 'Đơn vị & vận động viên',
    key: 'cms-participants',
    icon: <Building2 className="h-5 w-5" />,
    children: [
      { label: 'Danh sách đơn vị', key: '/cms/organizations', icon: <Building2 className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/organizations'] },
      { label: 'Danh sách VĐV', key: '/cms/athletes', icon: <Users className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/athletes'] },
      { label: 'Trọng tài, trưởng đoàn & HLV', key: '/cms/personnel', icon: <UserCog className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/personnel'] },
    ],
  },
  {
    label: 'Nội dung website',
    key: 'cms-content',
    icon: <Newspaper className="h-5 w-5" />,
    children: [
      { label: 'Banner trang chủ', key: '/cms/banners', icon: <Images className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/banners'] },
      { label: 'Tin tức', key: '/cms/news', icon: <Newspaper className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/news'] },
    ],
  },
  {
    label: 'Hệ thống & tài khoản',
    key: 'cms-system',
    icon: <Settings className="h-5 w-5" />,
    children: [
      { label: 'Tài khoản CMS', key: '/cms/users', icon: <UserCog className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/users'] },
      { label: 'Cài đặt hệ thống', key: '/cms/settings', icon: <Settings className="h-5 w-5" />, roles: CMS_PAGE_ACCESS['/cms/settings'] },
    ],
  },
];

const publicAuthPaths = ['/cms/login', '/cms/forgot-password', '/cms/reset-password'];

function CmsChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [colorMode, setColorMode] = useState<SportdataColorMode>('dark');
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>([]);
  const isPublicAuthPath = publicAuthPaths.includes(pathname);
  const token = getAuthToken();
  const { data: profile, error: profileError, mutate: retryProfile } = useSWR<{ username?: string; email?: string; role?: string }>(
    token && !isPublicAuthPath ? '/auth/profile' : null,
    fetcher,
    { shouldRetryOnError: (error) => ![401, 403].includes(error.response?.status) },
  );
  const userRole = profile?.role || null;
  const userLabel = profile?.username || profile?.email || null;
  const authenticated = Boolean(profile && isCmsRole(userRole));
  const { data: notifications, mutate: mutateNotifications } = useSWR<{
    items: CmsNotification[];
    unreadCount: number;
  }>(authenticated ? '/notifications?limit=20' : null, fetcher, { refreshInterval: 10_000 });

  const isLight = colorMode === 'light';
  const cmsTheme = useMemo(() => createSportdataTheme(colorMode), [colorMode]);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem('cms_sidebar_collapsed') === 'true');

    const savedTheme = localStorage.getItem('cms_color_mode');
    let nextMode: SportdataColorMode = 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
      nextMode = savedTheme;
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      nextMode = 'light';
    }
    applyDocumentColorMode(nextMode);
    setColorMode(nextMode);
  }, []);

  useEffect(() => {
    if (isPublicAuthPath) return;
    if (!token || (profile && !isCmsRole(profile.role))) {
      clearAuthToken();
      router.replace('/cms/login');
    }
    if (profile && isCmsRole(profile.role)) localStorage.setItem('cms_user', JSON.stringify(profile));
  }, [isPublicAuthPath, profile, router, token]);

  useEffect(() => {
    if (!authenticated || isPublicAuthPath || !userRole) return;
    if (!canAccessCmsPath(pathname, userRole)) {
      router.replace(isCmsRole(userRole) ? CMS_ROLE_INFO[userRole].startPath : '/cms/login');
    }
  }, [authenticated, isPublicAuthPath, pathname, router, userRole]);

  const visibleNavItems = useMemo<Array<CmsNavLeaf | CmsNavGroup>>(() => {
    if (!isCmsRole(userRole)) return [];
    const items: Array<CmsNavLeaf | CmsNavGroup> = [];
    navItems.forEach((item) => {
      if ('children' in item) {
        const children = item.children.filter((child) => child.roles.includes(userRole));
        if (children.length) items.push({ ...item, children });
        return;
      }
      if (item.roles.includes(userRole)) items.push(item);
    });
    return items;
  }, [userRole]);

  const visibleNavLeaves = useMemo<CmsNavLeaf[]>(
    () => visibleNavItems.flatMap((item) => 'children' in item ? item.children : [item]),
    [visibleNavItems],
  );

  const selectedKey = useMemo(() => {
    return [...visibleNavLeaves]
      .sort((left, right) => right.key.length - left.key.length)
      .find((item) => item.key === '/cms' ? pathname === '/cms' : pathname.startsWith(item.key))
      ?.key || (pathname === '/cms' ? '/cms' : '');
  }, [pathname, visibleNavLeaves]);

  useEffect(() => {
    const activeGroup = visibleNavItems.find((item) => (
      'children' in item
      && item.children.some((child) => pathname === child.key || pathname.startsWith(`${child.key}/`))
    ));
    if (!activeGroup) return;
    setOpenMenuKeys((current) => current.includes(activeGroup.key)
      ? current
      : [...current, activeGroup.key]);
  }, [pathname, visibleNavItems]);

  // Ant Design buttons with href render anchors. Route ordinary CMS clicks
  // through Next so forms and detail links keep the shell and its cache alive.
  const navigateCmsLink = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || (url.pathname !== '/cms' && !url.pathname.startsWith('/cms/'))) return;
    event.preventDefault();
    router.push(`${url.pathname}${url.search}${url.hash}`);
  };

  const handleLogout = () => {
    clearAuthToken();
    router.replace('/cms/login');
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem('cms_sidebar_collapsed', String(next));
      return next;
    });
  };

  const toggleColorMode = () => {
    setColorMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cms_color_mode', next);
      applyDocumentColorMode(next);
      return next;
    });
  };

  const openNotification = async (notification: CmsNotification) => {
    if (!notification.readAt) await api.patch(`/notifications/${notification.id}/read`);
    await mutateNotifications();
    if (notification.href) router.push(notification.href);
  };

  const markAllNotificationsRead = async () => {
    await api.patch('/notifications/read-all');
    await mutateNotifications();
  };

  const notificationContent = (
    <div className="w-[min(380px,calc(100vw-32px))]">
      <div className="flex items-center justify-between border-b border-slate-200/15 px-1 pb-3">
        <Typography.Text strong>Thông báo CMS</Typography.Text>
        <Button type="link" size="small" disabled={!notifications?.unreadCount} onClick={() => void markAllNotificationsRead()}>
          Đánh dấu đã đọc
        </Button>
      </div>
      <div className="max-h-[420px] overflow-y-auto py-2">
        {notifications?.items?.length ? notifications.items.map((notification) => (
          <button
            type="button"
            key={notification.id}
            className={`block w-full rounded-lg px-3 py-3 text-left transition hover:bg-slate-500/10 ${notification.readAt ? 'opacity-65' : 'bg-sky-500/[0.07]'}`}
            onClick={() => void openNotification(notification)}
          >
            <span className="flex items-start gap-2">
              {!notification.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
              <span className="min-w-0">
                <Typography.Text strong className="block text-sm">{notification.title}</Typography.Text>
                <Typography.Text type="secondary" className="mt-1 block text-xs leading-5">{notification.message}</Typography.Text>
                <Typography.Text type="secondary" className="mt-1 block text-[11px]">
                  {new Date(notification.createdAt).toLocaleString('vi-VN')}
                </Typography.Text>
              </span>
            </span>
          </button>
        )) : <div className="px-4 py-8 text-center text-sm text-slate-500">Chưa có thông báo</div>}
      </div>
    </div>
  );

  const renderThemeToggle = () => (
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

  const renderNavigation = (compact = false) => (
    <Flex vertical className={`h-full ${isLight ? 'bg-white' : 'bg-[#0d1425]'}`}>
      <Flex
        align="center"
        justify={compact ? 'center' : 'flex-start'}
        gap={11}
        className={`h-[72px] min-h-[72px] shrink-0 border-b ${isLight ? 'border-slate-200' : 'border-white/10'} ${compact ? 'px-3' : 'px-6'}`}
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sblue-400 to-sblue-700 shadow-lg shadow-sblue-500/20">
          <Trophy className="h-5 w-5 text-white" />
        </span>
        {!compact && <div>
          <Typography.Text strong className={`block text-base tracking-tight ${isLight ? '!text-slate-900' : '!text-white'}`}>SportCMS</Typography.Text>
          <Typography.Text type="secondary" className="text-[11px] uppercase tracking-[0.14em]">Control center</Typography.Text>
        </div>}
      </Flex>

      <AntMenu
        theme={isLight ? 'light' : 'dark'}
        mode="inline"
        inlineCollapsed={compact}
        selectedKeys={[selectedKey]}
        openKeys={openMenuKeys}
        onOpenChange={(keys) => setOpenMenuKeys(keys as string[])}
        items={visibleNavItems.map((item) => {
          if ('children' in item) {
            return {
              label: item.label,
              key: item.key,
              icon: item.icon,
              children: item.children.map(({ roles: _roles, ...child }) => child),
            };
          }
          const { roles: _roles, ...menuItem } = item;
          return menuItem;
        })}
        className={`flex-1 overflow-y-auto border-0 py-5 ${compact ? 'px-2' : 'px-3'}`}
        onClick={({ key }) => {
          router.push(key);
          setSidebarOpen(false);
        }}
      />

    </Flex>
  );

  if (!isPublicAuthPath && (!authenticated || !canAccessCmsPath(pathname, userRole))) {
    return (
      <ConfigProvider theme={cmsTheme}>
        <Flex className={`min-h-screen ${isLight ? 'cms-theme-light bg-[#f4f7fb]' : 'bg-[#070b16]'}`} align="center" justify="center">
          {profileError ? <Flex vertical align="center" gap={12}><Typography.Text>Không thể kiểm tra phiên đăng nhập. Vui lòng thử lại.</Typography.Text><Button onClick={() => void retryProfile()}>Thử lại</Button></Flex> : <Spin size="large" description="Đang tải CMS" />}
        </Flex>
      </ConfigProvider>
    );
  }

  if (isPublicAuthPath) {
    return (
      <ConfigProvider theme={cmsTheme}>
        <div className={`min-h-screen ${isLight ? 'cms-theme-light bg-[#f4f7fb]' : 'bg-[#070b16]'}`}>
          <div className="fixed right-4 top-4 z-50">{renderThemeToggle()}</div>
          {children}
        </div>
      </ConfigProvider>
    );
  }

  if (/^\/cms\/matches\/[^/]+\/scoreboard$/.test(pathname)) {
    return <ConfigProvider theme={cmsTheme}>{canAccessCmsPath(pathname, userRole) ? children : null}</ConfigProvider>;
  }

  return (
    <ConfigProvider theme={cmsTheme}>
      <Layout
        hasSider
        className={isLight ? 'cms-theme-light bg-[#f4f7fb]' : 'bg-[#070b16]'}
        style={{ minHeight: '100vh' }}
      >
        <Layout.Sider
          width={264}
          collapsedWidth={80}
          collapsed={sidebarCollapsed}
          trigger={null}
          theme={isLight ? 'light' : 'dark'}
          className={`!fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r lg:!block ${isLight ? 'border-slate-200' : 'border-white/10'}`}
        >
          {renderNavigation(sidebarCollapsed)}
        </Layout.Sider>

        <Drawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          placement="left"
          size={264}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          {renderNavigation(false)}
        </Drawer>

        <Layout
          className={`cms-layout-main min-w-0 ${isLight ? 'bg-[#f4f7fb]' : 'bg-[#070b16]'}`}
          style={{
            '--cms-sidebar-width': `${sidebarCollapsed ? 80 : 264}px`,
            minHeight: '100vh',
          } as React.CSSProperties}
        >
          <header className={`sticky top-0 z-30 flex h-[72px] min-h-[72px] shrink-0 items-center justify-between border-b px-4 leading-normal backdrop-blur-xl sm:px-7 ${isLight ? 'border-slate-200 bg-white/95' : 'border-white/10 bg-[#0d1425]/95'}`}>
            <Flex align="center" gap={14}>
              <Button
                type="text"
                className="!inline-flex lg:!hidden"
                aria-label="Mở điều hướng"
                icon={<MenuIcon className="h-5 w-5" />}
                onClick={() => setSidebarOpen(true)}
              />
              <Button
                type="text"
                className="!hidden lg:!inline-flex"
                aria-label={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
                title={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
                icon={sidebarCollapsed
                  ? <ChevronsRight className="h-5 w-5" />
                  : <ChevronsLeft className="h-5 w-5" />}
                onClick={toggleSidebar}
              />
              <div>
                <Typography.Text strong className={`block text-sm ${isLight ? '!text-slate-900' : '!text-slate-200'}`}>Trung tâm quản trị</Typography.Text>
                <Typography.Text type="secondary" className="hidden text-xs sm:block">Dữ liệu vận động viên và giải đấu</Typography.Text>
              </div>
            </Flex>

            <Flex align="center" gap={8} className="h-full">
              {renderThemeToggle()}
              <Popover content={notificationContent} trigger="click" placement="bottomRight">
                <Badge count={notifications?.unreadCount || 0} overflowCount={99} size="small">
                  <Button type="text" shape="circle" aria-label="Mở thông báo CMS" icon={<Bell className="h-5 w-5" />} />
                </Badge>
              </Popover>
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{
                  items: [
                    { key: 'account', icon: <User className="h-4 w-4" />, label: 'Tài khoản của tôi' },
                    { key: 'password', icon: <KeyRound className="h-4 w-4" />, label: 'Đổi mật khẩu' },
                    { type: 'divider' },
                    { key: 'logout', danger: true, icon: <LogOut className="h-4 w-4" />, label: 'Đăng xuất' },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'logout') {
                      handleLogout();
                      return;
                    }
                    router.push(key === 'password' ? '/cms/account/password' : '/cms/account');
                  },
                }}
              >
                <Button
                  type="text"
                  className={`group !h-[58px] !rounded-xl !px-2 sm:!pl-3 ${isLight ? 'hover:!bg-slate-100' : 'hover:!bg-white/[0.05]'}`}
                  aria-label="Mở menu tài khoản"
                >
                  <Flex align="center" gap={10}>
                    <Avatar size={38} icon={<User className="h-4 w-4" />} className="bg-sblue-500/20 text-sblue-400" />
                    <div className="hidden text-left sm:block">
                      <Typography.Text strong className="block text-sm group-hover:text-sblue-500">{userLabel || 'Admin'}</Typography.Text>
                      <Typography.Text type="secondary" className="block text-xs">
                        {isCmsRole(userRole) ? CMS_ROLE_INFO[userRole].shortLabel : 'Người dùng'}
                      </Typography.Text>
                    </div>
                    <ChevronDown className="hidden h-4 w-4 text-slate-500 sm:block" />
                  </Flex>
                </Button>
              </Dropdown>
            </Flex>
          </header>

          <Layout.Content onClick={navigateCmsLink} className="flex-1 p-4 sm:p-7 lg:p-8">{children}</Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

// Keep CMS requests in a browser cache scoped to the current login session.
const cmsCacheConfig = { provider: () => new Map() };

export default function CmsShell({ children }: { children: React.ReactNode }) {
  // Login/logout navigation updates the token and must replace the session cache.
  usePathname();
  const session = getAuthToken() || 'anonymous';
  return <SWRConfig key={session} value={cmsCacheConfig}><CmsChrome>{children}</CmsChrome></SWRConfig>;
}
