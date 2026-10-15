export const CMS_ROLES = [
  'ADMIN',
  'CONTENT',
  'GAMES_ADMIN',
  'READ_ONLY',
] as const;

export type CmsRole = (typeof CMS_ROLES)[number];

export const ALL_CMS_ROLES: readonly CmsRole[] = CMS_ROLES;

export const CMS_ROLE_INFO: Record<CmsRole, {
  label: string;
  shortLabel: string;
  description: string;
  startPath: string;
  capabilities: string[];
  restrictions: string[];
}> = {
  ADMIN: {
    label: 'Quản trị hệ thống',
    shortLabel: 'Admin',
    description: 'Quản lý cấu hình nền tảng, tài khoản, dữ liệu và toàn bộ nghiệp vụ đại hội.',
    startPath: '/cms',
    capabilities: ['Toàn quyền CMS', 'Quản lý tài khoản và sao lưu', 'Mở lại kết quả đã duyệt'],
    restrictions: ['Chỉ dùng cho quản trị kỹ thuật; không dùng chung tại bàn thi đấu'],
  },
  CONTENT: {
    label: 'Biên tập nội dung',
    shortLabel: 'Nội dung',
    description: 'Quản lý banner, tin tức và dữ liệu danh mục phục vụ website công khai.',
    startPath: '/cms/news',
    capabilities: ['Banner, tin tức và liên hệ', 'Dữ liệu sự kiện/VĐV', 'Danh mục môn và hạng đấu'],
    restrictions: ['Không điều hành lịch', 'Không nhập hoặc phê duyệt kết quả'],
  },
  GAMES_ADMIN: {
    label: 'Quản lý sự kiện',
    shortLabel: 'Sự kiện',
    description: 'Quản lý mọi sự kiện và toàn bộ nghiệp vụ đăng ký, thi đấu, thanh toán và kết quả.',
    startPath: '/cms/events',
    capabilities: ['Tạo, sửa, xóa sự kiện; quản lý VĐV và hạng đấu', 'Đăng ký, thanh toán, địa điểm và lịch thi đấu', 'Sinh và thu hồi cây đấu', 'Nhập, xác nhận, duyệt, công bố và khóa kết quả'],
    restrictions: ['Không quản lý tài khoản CMS, cấu hình hoặc sao lưu hệ thống', 'Không mở lại kết quả đã khóa', 'Không đặt trước cặp hoặc preview cây đấu'],
  },
  READ_ONLY: {
    label: 'Chỉ xem',
    shortLabel: 'Chỉ xem',
    description: 'Theo dõi dữ liệu, lịch, xung đột và kết quả mà không thay đổi hệ thống.',
    startPath: '/cms',
    capabilities: ['Xem dashboard và dữ liệu thi đấu', 'Xem báo cáo sẵn sàng/xung đột', 'Xem thống kê'],
    restrictions: ['Không được tạo, sửa, xóa, nhập điểm hoặc phê duyệt'],
  },
};

export const CMS_PAGE_ACCESS: Record<string, readonly CmsRole[]> = {
  '/cms': ALL_CMS_ROLES,
  '/cms/operations': ['ADMIN', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/events': ALL_CMS_ROLES,
  '/cms/registrations': ['ADMIN', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/athletes': ['ADMIN', 'CONTENT', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/sports': ['ADMIN', 'CONTENT', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/organizations': ['ADMIN', 'CONTENT', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/accounts': ['ADMIN', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/personnel': ['ADMIN', 'GAMES_ADMIN', 'READ_ONLY'],
  '/cms/users': ['ADMIN'],
  '/cms/account': ALL_CMS_ROLES,
  '/cms/statistics': ALL_CMS_ROLES,
  '/cms/banners': ['ADMIN', 'CONTENT'],
  '/cms/news': ['ADMIN', 'CONTENT'],
  '/cms/contacts': ['ADMIN', 'CONTENT'],
  '/cms/settings': ['ADMIN'],
};

export const DEMO_ROLE_USERNAMES: Record<CmsRole, string> = {
  ADMIN: 'demo.admin',
  CONTENT: 'demo.content',
  GAMES_ADMIN: 'demo.games',
  READ_ONLY: 'demo.viewer',
};

export function isCmsRole(role?: string | null): role is CmsRole {
  return Boolean(role && CMS_ROLES.includes(role as CmsRole));
}

export function canAccessCmsPath(pathname: string, role?: string | null) {
  if (!isCmsRole(role)) return false;
  if (pathname === '/cms') return true;

  if (/^\/cms\/matches\/[^/]+\/scoreboard$/.test(pathname)) return ['ADMIN', 'GAMES_ADMIN'].includes(role);

  const mutationRouteRoles: Array<{ matches: boolean; roles: readonly CmsRole[] }> = [
    {
      matches: pathname === '/cms/events/new' || /^\/cms\/events\/[^/]+\/edit$/.test(pathname),
      roles: ['ADMIN', 'CONTENT', 'GAMES_ADMIN'],
    },
    {
      matches: pathname === '/cms/athletes/new' || /^\/cms\/athletes\/[^/]+\/edit$/.test(pathname),
      roles: ['ADMIN', 'CONTENT', 'GAMES_ADMIN'],
    },
    {
      matches: pathname === '/cms/matches/new' || /^\/cms\/matches\/[^/]+\/edit$/.test(pathname),
      roles: ['ADMIN', 'CONTENT', 'GAMES_ADMIN'],
    },
  ];
  const mutationRoute = mutationRouteRoles.find((rule) => rule.matches);
  if (mutationRoute) return mutationRoute.roles.includes(role);

  const route = Object.keys(CMS_PAGE_ACCESS)
    .filter((key) => key !== '/cms')
    .sort((left, right) => right.length - left.length)
    .find((key) => pathname === key || pathname.startsWith(`${key}/`));

  return route ? CMS_PAGE_ACCESS[route].includes(role) : false;
}
