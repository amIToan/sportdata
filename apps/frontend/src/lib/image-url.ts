export type ImageVariant = 'avatar' | 'portrait' | 'logo' | 'card' | 'preview' | 'hero';

// Keep these dimensions aligned with backend/storage/image-variant.ts.
const transformations: Record<ImageVariant, string> = {
  avatar: 'c_fill,g_face,h_96,w_96',
  portrait: 'c_limit,h_480,w_320',
  logo: 'c_limit,h_240,w_240',
  card: 'c_limit,h_480,w_640',
  preview: 'c_limit,h_1600,w_1600',
  hero: 'c_limit,h_900,w_1600',
};

function isStorageImage(path: string) {
  return /^\/(?:api\/)?(?:participant-auth\/(?:avatar\/[^/]+|event-participations\/[^/]+\/avatar)|banners\/[^/]+\/image|sports\/[^/]+\/(?:logo|background)|events\/[^/]+\/(?:banner-image|logo-image|ticket-background))$/.test(path);
}

/** Cloudinary transformations are signed by the API; local/S3 keep their current response. */
export function imageUrl(source: string | null | undefined, variant: ImageVariant, revision?: string | number): string | undefined {
  if (!source) return undefined;
  if (source.startsWith('blob:') || source.startsWith('data:')) return source;
  try {
    const url = new URL(source, 'https://sportdata.invalid');
    if (isStorageImage(url.pathname)) {
      url.searchParams.set('variant', variant);
      if (revision !== undefined) url.searchParams.set('v', String(revision));
      return source.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.toString();
    }
    // External public Cloudinary URLs can use dynamic transformations directly.
    // Authenticated/signed URLs must go through the backend instead of rewriting their signature.
    if (url.hostname === 'res.cloudinary.com' && /^\/[^/]+\/image\/upload\//.test(url.pathname)
      && !url.pathname.includes('/s--') && !url.searchParams.has('__cld_token__')) {
      url.pathname = url.pathname.replace('/image/upload/', `/image/upload/${transformations[variant]},f_auto,q_auto:good/`);
      return url.toString();
    }
  } catch {
    return source;
  }
  return source;
}

export function imageSrcSet(source: string | null | undefined): string | undefined {
  if (!source || imageUrl(source, 'card') === source) return undefined;
  return `${imageUrl(source, 'card')} 640w, ${imageUrl(source, 'hero')} 1600w`;
}
