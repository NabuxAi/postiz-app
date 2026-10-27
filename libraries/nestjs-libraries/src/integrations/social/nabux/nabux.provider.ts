import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import {
  buildNabuxPublishBody,
  mapNabuxPublishResponse,
  NABUX_BASE_URL_ENV,
  NABUX_DEFAULT_BASE_URL,
  nabuxChannel,
  nabuxErrorMessage,
  nabuxProfileUrl,
  nabuxPublishUrl,
  NabuxChannel,
  normalizeNabuxBaseUrl,
} from '@gitroom/nestjs-libraries/integrations/social/nabux/nabux.contract';

type NabuxForm = {
  baseUrl?: string;
  accountKey?: string;
  token?: string;
};

// Form providers persist the submitted fields with AuthService.fixedEncryption
// on Integration.customInstanceDetails. The bearer token is also kept on the
// integration token column, the same way other form providers keep a credential
// they send on later requests.
export class NabuxProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier: string;
  name: string;
  readonly platform: string;
  private readonly textLimit: number;
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  toolTip: string;

  constructor(channel: NabuxChannel) {
    super();
    this.identifier = channel.identifier;
    this.name = channel.name;
    this.platform = channel.platform;
    this.textLimit = channel.maxLength;
    this.toolTip = `Publishes to ${channel.name} through your Nabux MCP. Connect with the hub base URL, account key and API token.`;
  }

  maxLength() {
    return this.textLimit;
  }

  override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    const message = nabuxErrorMessage(body);

    if (status === 401) {
      return {
        type: 'refresh-token',
        value:
          message ||
          'Nabux rejected the API token. Reconnect the channel with a valid token.',
      };
    }

    if (status === 429) {
      return {
        type: 'retry',
        value: message || 'Nabux rate limit reached, retrying',
      };
    }

    if (status === 404) {
      return {
        type: 'bad-body',
        value: message || 'Nabux account was not found',
      };
    }

    if (message) {
      return {
        type: 'bad-body',
        value: message,
      };
    }

    return undefined;
  }

  async customFields() {
    return [
      {
        key: 'baseUrl',
        label: 'Nabux base URL',
        defaultValue:
          process.env[NABUX_BASE_URL_ENV] || NABUX_DEFAULT_BASE_URL,
        validation: `/^https?:\\/\\/[^\\s]+$/`,
        type: 'text' as const,
        hint: 'Origin of the Nabux SocialMCP hub, or of one platform MCP that implements the same publish contract.',
      },
      {
        key: 'accountKey',
        label: 'Account key',
        validation: `/^[^\\s]{1,200}$/`,
        type: 'text' as const,
        hint: 'Account id on that hub. It is placed in the publish URL.',
      },
      {
        key: 'token',
        label: 'API token',
        validation: `/^.{8,}$/`,
        type: 'password' as const,
        hint: 'Sent as Authorization: Bearer. Stored encrypted with the other connect fields.',
      },
    ];
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let form: NabuxForm;
    try {
      form = JSON.parse(Buffer.from(params.code, 'base64').toString());
    } catch (err) {
      return 'Nabux connect details could not be read. Try connecting again.';
    }

    const accountKey = String(form.accountKey || '').trim();
    const token = String(form.token || '').trim();
    if (!accountKey || /[\/\\]/.test(accountKey)) {
      return 'Account key is missing or contains a slash';
    }
    if (token.length < 8) {
      return 'API token is too short';
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeNabuxBaseUrl(
        form.baseUrl || process.env[NABUX_BASE_URL_ENV] || NABUX_DEFAULT_BASE_URL
      );
    } catch (err: any) {
      return err?.message || 'Nabux base URL is invalid';
    }

    const profile = await this.loadProfile(baseUrl, accountKey, token);
    if (profile.error) {
      return profile.error;
    }

    return {
      id: `${this.identifier}:${accountKey}`,
      name: profile.name || accountKey,
      accessToken: token,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: profile.picture || '',
      username: profile.username || accountKey,
    };
  }

  private async loadProfile(baseUrl: string, accountKey: string, token: string) {
    const fallback = {
      name: accountKey,
      username: accountKey,
      picture: '',
      error: '',
    };

    let response: Response;
    try {
      response = await fetch(nabuxProfileUrl(baseUrl, accountKey), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
      });
    } catch (err) {
      console.log(`Nabux profile lookup failed for ${this.identifier}`);
      return fallback;
    }

    // The hub may not have a profile route yet. Connect with the typed key.
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return fallback;
    }

    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      return {
        ...fallback,
        error:
          nabuxErrorMessage(body) ||
          'Nabux rejected the API token. Check the token and account key.',
      };
    }

    if (!response.ok) {
      return fallback;
    }

    try {
      const profile = await response.json();
      return {
        name: String(
          profile?.name || profile?.display_name || profile?.username || accountKey
        ),
        username: String(
          profile?.username || profile?.handle || profile?.name || accountKey
        ),
        picture: String(
          profile?.picture || profile?.avatar || profile?.avatar_url || ''
        ),
        error: '',
      };
    } catch (err) {
      return fallback;
    }
  }

  private readConnection(accessToken: string, integration: Integration) {
    const stored = this.readStoredForm(integration?.customInstanceDetails);
    const accountKey =
      String(stored.accountKey || '').trim() ||
      String(integration?.internalId || '').replace(
        new RegExp(`^${this.identifier}:`),
        ''
      );
    const baseUrl = normalizeNabuxBaseUrl(
      stored.baseUrl ||
        process.env[NABUX_BASE_URL_ENV] ||
        NABUX_DEFAULT_BASE_URL
    );
    const token = String(stored.token || accessToken || '').trim();
    return { baseUrl, accountKey, token };
  }

  private readStoredForm(raw?: string | null): NabuxForm {
    if (!raw) {
      return {};
    }

    let decoded = raw;
    try {
      decoded = AuthService.fixedDecryption(raw);
    } catch (err) {
      decoded = raw;
    }

    try {
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (err) {
      return {};
    }

    return {};
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    let baseUrl: string;
    let accountKey: string;
    let token: string;
    try {
      ({ baseUrl, accountKey, token } = this.readConnection(
        accessToken,
        integration
      ));
    } catch (err: any) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        err?.message || 'Nabux channel settings are invalid. Reconnect it.'
      );
    }

    if (!accountKey || /[\/\\]/.test(accountKey) || !token) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Nabux channel is missing its account key or API token. Reconnect it.'
      );
    }

    const results: PostResponse[] = [];
    for (const post of postDetails) {
      const payload = buildNabuxPublishBody({
        platform: this.platform,
        postId: post.id,
        text: post.message,
        settings: post.settings,
        media: post.media,
      });

      const response = await this.fetch(
        nabuxPublishUrl(baseUrl, accountKey),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        },
        this.identifier
      );

      let body: any;
      try {
        body = await response.json();
      } catch (err) {
        throw new BadBody(
          this.identifier,
          '',
          JSON.stringify(payload),
          'Nabux publish returned a body that is not JSON'
        );
      }

      const mapped = mapNabuxPublishResponse(body);
      if (mapped.ok === false) {
        throw new BadBody(
          this.identifier,
          JSON.stringify(body),
          JSON.stringify(payload),
          mapped.message
        );
      }

      results.push({
        id: post.id,
        postId: mapped.postId,
        releaseURL: mapped.releaseURL,
        status: mapped.status,
      });
    }

    return results;
  }
}

export class NabuxBaleProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('bale'));
  }
}

export class NabuxEitaaProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('eitaa'));
  }
}

export class NabuxRubikaProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('rubika'));
  }
}

export class NabuxSoroushProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('soroush'));
  }
}

export class NabuxWhatsappProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('whatsapp'));
  }
}

export class NabuxTelegramProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('telegram'));
  }
}

export class NabuxInstagramProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('instagram'));
  }
}

export class NabuxFacebookProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('facebook'));
  }
}

export class NabuxXProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('x'));
  }
}

export class NabuxLinkedinProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('linkedin'));
  }
}

export class NabuxThreadsProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('threads'));
  }
}

export class NabuxTiktokProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('tiktok'));
  }
}

export class NabuxYoutubeProvider extends NabuxProvider {
  constructor() {
    super(nabuxChannel('youtube'));
  }
}

export const nabuxSocialProviders: NabuxProvider[] = [
  new NabuxBaleProvider(),
  new NabuxEitaaProvider(),
  new NabuxRubikaProvider(),
  new NabuxSoroushProvider(),
  new NabuxWhatsappProvider(),
  new NabuxTelegramProvider(),
  new NabuxInstagramProvider(),
  new NabuxFacebookProvider(),
  new NabuxXProvider(),
  new NabuxLinkedinProvider(),
  new NabuxThreadsProvider(),
  new NabuxTiktokProvider(),
  new NabuxYoutubeProvider(),
];
