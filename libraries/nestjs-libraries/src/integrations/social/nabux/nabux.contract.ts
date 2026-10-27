// HTTP contract for Nabux channel providers.
// The hub (or a platform MCP) must implement these paths. See docs/nabux-providers.md.

export const NABUX_DEFAULT_BASE_URL = 'https://social.nabuxai.com';

/** Optional. Overrides the connect-form default and the publish fallback base URL. */
export const NABUX_BASE_URL_ENV = 'NABUX_SOCIAL_BASE_URL';

/** `{accountKey}` is encoded when the URL is built. */
export const NABUX_PUBLISH_PATH =
  '/internal/v1/accounts/{accountKey}/publish';

/** Profile lookup used at connect time. A missing route still allows connect. */
export const NABUX_PROFILE_PATH = '/internal/v1/accounts/{accountKey}';

/** Status values Postiz treats as a finished publish. `pending` is rejected. */
export const NABUX_PUBLISH_SUCCESS_STATUSES = [
  'published',
  'success',
  'completed',
  'ok',
  'posted',
] as const;

export type NabuxChannel = {
  identifier: string;
  name: string;
  platform: string;
  maxLength: number;
};

// `platform` is the value sent in the publish JSON. Character limits mirror
// the native Postiz providers where those exist; the four messengers and
// WhatsApp use a 4096 messaging cap.
export const NABUX_CHANNELS: readonly NabuxChannel[] = [
  { identifier: 'nabux-bale', name: 'Bale', platform: 'bale', maxLength: 4096 },
  {
    identifier: 'nabux-eitaa',
    name: 'Eitaa',
    platform: 'eitaa',
    maxLength: 4096,
  },
  {
    identifier: 'nabux-rubika',
    name: 'Rubika',
    platform: 'rubika',
    maxLength: 4096,
  },
  {
    identifier: 'nabux-soroush',
    name: 'Soroush',
    platform: 'soroush',
    maxLength: 4096,
  },
  {
    identifier: 'nabux-whatsapp',
    name: 'WhatsApp',
    platform: 'whatsapp',
    maxLength: 4096,
  },
  {
    identifier: 'nabux-telegram',
    name: 'Nabux Telegram',
    platform: 'telegram',
    maxLength: 4096,
  },
  {
    identifier: 'nabux-instagram',
    name: 'Nabux Instagram',
    platform: 'instagram',
    maxLength: 2200,
  },
  {
    identifier: 'nabux-facebook',
    name: 'Nabux Facebook',
    platform: 'facebook',
    maxLength: 63206,
  },
  { identifier: 'nabux-x', name: 'Nabux X', platform: 'x', maxLength: 280 },
  {
    identifier: 'nabux-linkedin',
    name: 'Nabux LinkedIn',
    platform: 'linkedin',
    maxLength: 3000,
  },
  {
    identifier: 'nabux-threads',
    name: 'Nabux Threads',
    platform: 'threads',
    maxLength: 500,
  },
  {
    identifier: 'nabux-tiktok',
    name: 'Nabux TikTok',
    platform: 'tiktok',
    maxLength: 2000,
  },
  {
    identifier: 'nabux-youtube',
    name: 'Nabux YouTube',
    platform: 'youtube',
    maxLength: 5000,
  },
];

export function nabuxChannel(platform: string): NabuxChannel {
  const found = NABUX_CHANNELS.find((channel) => channel.platform === platform);
  if (!found) {
    throw new Error(`Unknown Nabux platform: ${platform}`);
  }
  return found;
}

export function normalizeNabuxBaseUrl(value: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Nabux base URL is not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Nabux base URL must start with http:// or https://');
  }

  return trimmed;
}

export function nabuxAccountUrl(baseUrl: string, pathTemplate: string, accountKey: string) {
  const base = normalizeNabuxBaseUrl(baseUrl);
  const path = pathTemplate.replace(
    '{accountKey}',
    encodeURIComponent(accountKey)
  );
  return `${base}${path}`;
}

export function nabuxPublishUrl(baseUrl: string, accountKey: string) {
  return nabuxAccountUrl(baseUrl, NABUX_PUBLISH_PATH, accountKey);
}

export function nabuxProfileUrl(baseUrl: string, accountKey: string) {
  return nabuxAccountUrl(baseUrl, NABUX_PROFILE_PATH, accountKey);
}

const VIDEO_EXTENSION =
  /\.(mp4|mov|m4v|webm|mkv|avi)(?:$|[?#])/i;

export function nabuxMediaType(media: {
  type?: string;
  path?: string;
  url?: string;
}): 'image' | 'video' {
  if (media?.type === 'video') {
    return 'video';
  }

  const name = `${media?.path || ''} ${media?.url || ''}`;
  return VIDEO_EXTENSION.test(name) ? 'video' : 'image';
}

function joinPublicUrl(base: string, staticDir: string, relativePath: string) {
  const root = base.replace(/\/+$/, '');
  const dir = staticDir.replace(/^\/+|\/+$/g, '');
  const relative = relativePath.replace(/^\/+/, '');
  return [root, dir, relative].filter(Boolean).join('/');
}

// Postiz's media resolver puts the public URL on `url` and, for local storage,
// a disk path on `path`. The hub pulls media itself, so only a public URL is sent.
export function nabuxPublicMediaUrl(media: {
  path?: string;
  url?: string;
}): string {
  const candidates = [media?.url, media?.path].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const remote = candidates.find((value) => /^https?:\/\//i.test(value));
  if (remote) {
    return remote;
  }

  const path = media?.path || media?.url || '';
  const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (!frontend || !path) {
    return path;
  }

  const uploadDirectory = process.env.UPLOAD_DIRECTORY || '';
  const relative =
    uploadDirectory && path.startsWith(uploadDirectory)
      ? path.slice(uploadDirectory.length)
      : path;

  return joinPublicUrl(
    frontend,
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY || '/uploads',
    relative
  );
}

export function buildNabuxPublishBody(input: {
  platform: string;
  postId: string;
  text: string;
  settings?: unknown;
  media?: Array<{ type?: string; path?: string; url?: string }>;
}) {
  return {
    platform: input.platform,
    text: input.text || '',
    media: (input.media || []).map((item) => ({
      url: nabuxPublicMediaUrl(item),
      type: nabuxMediaType(item),
    })),
    settings: input.settings ?? {},
    postiz_post_id: input.postId,
  };
}

export function nabuxErrorMessage(body: string): string {
  if (!body) {
    return '';
  }

  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error || parsed?.message || parsed?.detail;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  } catch (err) {
    return '';
  }

  return '';
}

export function mapNabuxPublishResponse(payload: any):
  | { ok: true; postId: string; releaseURL: string; status: string }
  | { ok: false; message: string } {
  const id = payload?.id;
  if (id === undefined || id === null || String(id).trim() === '') {
    return {
      ok: false,
      message: 'Nabux publish response did not include an id',
    };
  }

  const status = String(payload?.status || 'published').toLowerCase();
  if (status === 'pending' || status === 'processing' || status === 'queued') {
    return {
      ok: false,
      message:
        'Nabux publish returned a pending status. The hub must finish the publish in this request and return a terminal status such as "published".',
    };
  }

  if (
    !NABUX_PUBLISH_SUCCESS_STATUSES.includes(
      status as (typeof NABUX_PUBLISH_SUCCESS_STATUSES)[number]
    )
  ) {
    return {
      ok: false,
      message:
        nabuxErrorMessage(JSON.stringify(payload)) ||
        `Nabux publish failed with status "${status}"`,
    };
  }

  return {
    ok: true,
    postId: String(id),
    releaseURL: payload?.url ? String(payload.url) : '',
    status,
  };
}
