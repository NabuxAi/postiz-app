import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  NABUX_CHANNELS,
  NABUX_PUBLISH_PATH,
  buildNabuxPublishBody,
  mapNabuxPublishResponse,
  nabuxPublishUrl,
  nabuxPublicMediaUrl,
} from '@gitroom/nestjs-libraries/integrations/social/nabux/nabux.contract';
import {
  NabuxInstagramProvider,
  nabuxSocialProviders,
} from '@gitroom/nestjs-libraries/integrations/social/nabux/nabux.provider';

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as Response;
}

describe('Nabux providers', () => {
  const provider = new NabuxInstagramProvider();
  const stored = {
    baseUrl: 'https://social.nabuxai.com',
    accountKey: 'acct-1',
    token: 'secret-token-value',
  };
  const integration = {
    customInstanceDetails: JSON.stringify(stored),
    internalId: 'nabux-instagram:acct-1',
    providerIdentifier: 'nabux-instagram',
  } as Integration;

  beforeEach(() => {
    jest
      .spyOn(AuthService, 'fixedDecryption')
      .mockImplementation((value: string) => value);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers one provider per catalog entry', () => {
    expect(nabuxSocialProviders.map((item) => item.identifier)).toEqual(
      NABUX_CHANNELS.map((channel) => channel.identifier)
    );
    expect(nabuxSocialProviders.map((item) => item.platform)).toEqual(
      NABUX_CHANNELS.map((channel) => channel.platform)
    );
    expect(NABUX_PUBLISH_PATH).toBe(
      '/internal/v1/accounts/{accountKey}/publish'
    );
  });

  it('builds the publish URL and body with public media urls', () => {
    expect(nabuxPublishUrl('https://social.nabuxai.com/', 'acct-1')).toBe(
      'https://social.nabuxai.com/internal/v1/accounts/acct-1/publish'
    );

    process.env.FRONTEND_URL = 'https://postiz.nabuxai.com';
    process.env.UPLOAD_DIRECTORY = '/uploads';
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = '/uploads';

    const body = buildNabuxPublishBody({
      platform: 'instagram',
      postId: 'post-db-1',
      text: 'hello nabux',
      settings: { __type: 'nabux-instagram' },
      media: [
        { type: 'image', path: 'https://cdn.example/a.jpg' },
        {
          type: 'image',
          path: '/uploads/library/clip.mp4',
          url: 'https://postiz.nabuxai.com/uploads/library/clip.mp4',
        },
        { type: 'image', path: '/uploads/library/local.png' },
      ],
    });

    expect(body).toEqual({
      platform: 'instagram',
      text: 'hello nabux',
      media: [
        { url: 'https://cdn.example/a.jpg', type: 'image' },
        {
          url: 'https://postiz.nabuxai.com/uploads/library/clip.mp4',
          type: 'video',
        },
        {
          url: 'https://postiz.nabuxai.com/uploads/library/local.png',
          type: 'image',
        },
      ],
      settings: { __type: 'nabux-instagram' },
      postiz_post_id: 'post-db-1',
    });
    expect(
      nabuxPublicMediaUrl({ path: '/uploads/library/local.png' })
    ).toBe('https://postiz.nabuxai.com/uploads/library/local.png');
  });

  it('maps a successful publish response onto the Postiz post result', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, {
          id: 'ig-99',
          url: 'https://instagram.com/p/ig-99',
          status: 'published',
        })
      );

    const results = await provider.post(
      'internal',
      'ignored-when-stored',
      [
        {
          id: 'post-db-1',
          message: 'hello nabux',
          settings: { __type: 'nabux-instagram', caption: 'hello' },
          media: [
            { type: 'image', path: 'https://cdn.example/a.jpg' },
            { type: 'video', path: 'https://cdn.example/b.mp4' },
          ],
        },
      ],
      integration
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://social.nabuxai.com/internal/v1/accounts/acct-1/publish',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token-value',
          'Content-Type': 'application/json',
        }),
      })
    );
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(sent).toEqual({
      platform: 'instagram',
      text: 'hello nabux',
      media: [
        { url: 'https://cdn.example/a.jpg', type: 'image' },
        { url: 'https://cdn.example/b.mp4', type: 'video' },
      ],
      settings: { __type: 'nabux-instagram', caption: 'hello' },
      postiz_post_id: 'post-db-1',
    });
    expect(results).toEqual([
      {
        id: 'post-db-1',
        postId: 'ig-99',
        releaseURL: 'https://instagram.com/p/ig-99',
        status: 'published',
      },
    ]);
  });

  it('accepts a 201 and defaults a missing status to published', () => {
    expect(mapNabuxPublishResponse({ id: 15, url: 'https://example/p' })).toEqual(
      {
        ok: true,
        postId: '15',
        releaseURL: 'https://example/p',
        status: 'published',
      }
    );
  });

  it('turns an unauthorized publish into a refresh-token error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(401, { error: 'token expired' })
    );

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('turns a hub error body into a bad-body error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(400, { error: 'account is not connected' })
    );

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('account is not connected'),
      })
    );

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('rejects a pending publish instead of polling', async () => {
    expect(mapNabuxPublishResponse({ id: '1', url: '', status: 'pending' })).toEqual(
      {
        ok: false,
        message: expect.stringContaining('pending'),
      }
    );
    expect(
      mapNabuxPublishResponse({ id: '', status: 'published' }).ok
    ).toBe(false);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { id: '1', url: '', status: 'pending' }));

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('rejects a publish body that is not JSON and an invalid stored base URL', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, '<html>'));

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(BadBody);

    const broken = {
      ...integration,
      customInstanceDetails: JSON.stringify({
        ...stored,
        baseUrl: 'ftp://files.example',
      }),
    } as Integration;

    await expect(
      provider.post(
        'internal',
        stored.token,
        [{ id: 'post-db-1', message: 'hi', settings: {} }],
        broken
      )
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('uses the profile name when the hub returns one', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        name: 'Nabux Page',
        username: 'nabux',
        picture: 'https://cdn.example/avatar.jpg',
      })
    );

    const auth = await provider.authenticate({
      code: Buffer.from(JSON.stringify(stored)).toString('base64'),
      codeVerifier: 'verifier',
    });

    expect(auth).toMatchObject({
      id: 'nabux-instagram:acct-1',
      name: 'Nabux Page',
      username: 'nabux',
      picture: 'https://cdn.example/avatar.jpg',
      accessToken: stored.token,
    });
  });

  it('connects with the typed account key when the profile route is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(404, { error: 'nope' }));

    const auth = await provider.authenticate({
      code: Buffer.from(
        JSON.stringify({ ...stored, accountKey: 'channel-7' })
      ).toString('base64'),
      codeVerifier: 'verifier',
    });

    expect(auth).toMatchObject({
      id: 'nabux-instagram:channel-7',
      name: 'channel-7',
      username: 'channel-7',
      picture: '',
    });
  });

  it('refuses a rejected token instead of saving the channel', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(401, { message: 'bad token' }));

    const auth = await provider.authenticate({
      code: Buffer.from(JSON.stringify(stored)).toString('base64'),
      codeVerifier: 'verifier',
    });

    expect(auth).toBe('bad token');
  });

  it('classifies rate limits as retry and unknown accounts as bad-body', () => {
    expect(provider.handleErrors('{"error":"slow down"}', 429)).toEqual({
      type: 'retry',
      value: 'slow down',
    });
    expect(provider.handleErrors('{}', 404)).toEqual({
      type: 'bad-body',
      value: 'Nabux account was not found',
    });
    expect(provider.handleErrors('{"error":"token expired"}', 401)?.type).toBe(
      'refresh-token'
    );
  });
});
