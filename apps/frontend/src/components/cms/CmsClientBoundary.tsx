'use client';

import { useEffect, useState } from 'react';
import CmsShell from './CmsShell';

export function CmsClientBoundary({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Read browser authentication only after hydration. A dynamic/Suspense wrapper
  // can tear down SWR's cache effects while a cold navigation is still rendering.
  if (!mounted) {
    return <div role="status" className="flex min-h-screen items-center justify-center">Đang tải CMS…</div>;
  }

  return <CmsShell>{children}</CmsShell>;
}
