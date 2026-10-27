# Nabux channel providers

Postiz in this fork can publish through Nabux Social MCP instead of (or in addition to) a platform's native OAuth app. Each Nabux channel is a normal Postiz provider. Connecting it does not change any existing provider.

The publish contract below is the one the hub must implement. It is defined in code as `NABUX_PUBLISH_PATH` and `NABUX_PROFILE_PATH` in `libraries/nestjs-libraries/src/integrations/social/nabux/nabux.contract.ts`.

There is no `v2.25.3` tag in this repository. These providers were added on `main` (`version.txt` is `v1.47.0`). Rebase them onto a future Postiz release before building an image that is meant to replace the production `v2.25.3` container, and re-check the files listed at the bottom.

## Channels

| Postiz identifier | Name in the channel list | `platform` sent on publish | Composer limit |
| --- | --- | --- | --- |
| `nabux-bale` | Bale | `bale` | 4096 |
| `nabux-eitaa` | Eitaa | `eitaa` | 4096 |
| `nabux-rubika` | Rubika | `rubika` | 4096 |
| `nabux-soroush` | Soroush | `soroush` | 4096 |
| `nabux-whatsapp` | WhatsApp | `whatsapp` | 4096 |
| `nabux-telegram` | Nabux Telegram | `telegram` | 4096 |
| `nabux-instagram` | Nabux Instagram | `instagram` | 2200 |
| `nabux-facebook` | Nabux Facebook | `facebook` | 63206 |
| `nabux-x` | Nabux X | `x` | 280 |
| `nabux-linkedin` | Nabux LinkedIn | `linkedin` | 3000 |
| `nabux-threads` | Nabux Threads | `threads` | 500 |
| `nabux-tiktok` | Nabux TikTok | `tiktok` | 2000 |
| `nabux-youtube` | Nabux YouTube | `youtube` | 5000 |

Platforms Postiz already supports keep their native provider. The Nabux copy is a second channel that posts through the MCP. Names for those copies are prefixed with "Nabux" so the add-channel screen can tell them apart. Snapchat is not registered: SnapChatMCP has no publish API, and it was not in the required identifier list.

Scheduled posts for every `nabux-*` identifier run on the Temporal task queue `nabux` (Postiz uses the segment before the first hyphen). The orchestrator starts that worker only when these providers are registered.

## Connect a channel

1. In Postiz, open **Add channel**.
2. Pick the Nabux platform (for example **Bale** or **Nabux Instagram**).
3. Submit the form. There is no OAuth redirect.

| Field | Required | Default | Stored as |
| --- | --- | --- | --- |
| Nabux base URL | yes | `https://social.nabuxai.com` | encrypted `Integration.customInstanceDetails` |
| Account key | yes, 1–200 chars, no spaces or slashes | none | same encrypted JSON, and the integration `internalId` is `{identifier}:{accountKey}` |
| API token | yes, at least 8 characters | none | same encrypted JSON, and the integration `token` column (bearer used at publish time) |

`customInstanceDetails` is encrypted with `AuthService.fixedEncryption` (AES-256-CBC keyed from `JWT_SECRET`). That is the same path Lemmy, Listmonk and WordPress use for form credentials. The bearer token is also written to `token`, which is how those providers keep the secret they send on later requests. Neither value is returned by the connect response.

On connect, Postiz calls the profile route below. A display name, username and picture from a successful response become the channel name and avatar. If the route is missing (`404`, `405`, `501`), the hub is unreachable, or the body is not JSON, the channel is still saved and the account key is used as the name and username. `401` and `403` abort the connect and the token is not saved.

## Profile request

```http
GET {baseUrl}/internal/v1/accounts/{accountKey}
Authorization: Bearer {token}
Accept: application/json
```

`{accountKey}` is URL-encoded. `{baseUrl}` has no trailing slash.

Success (`200` or any other 2xx):

```json
{
  "id": "optional, ignored for the Postiz channel id",
  "name": "Display name",
  "username": "handle",
  "picture": "https://example.com/avatar.jpg"
}
```

`display_name` is accepted as an alias of `name`. `handle` is accepted as an alias of `username`. `avatar` and `avatar_url` are accepted as aliases of `picture`. Unknown extra fields are ignored.

## Publish request

```http
POST {baseUrl}/internal/v1/accounts/{accountKey}/publish
Authorization: Bearer {token}
Content-Type: application/json
Accept: application/json
```

```json
{
  "platform": "instagram",
  "text": "Plain text already stripped by Postiz",
  "media": [
    { "url": "https://postiz.example/uploads/photo.jpg", "type": "image" },
    { "url": "https://postiz.example/uploads/clip.mp4", "type": "video" }
  ],
  "settings": { "__type": "nabux-instagram" },
  "postiz_post_id": "the Postiz post id"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `platform` | string | One of the `platform` values in the table above. The hub uses this to choose the downstream MCP. |
| `text` | string | Post body. May be empty when media is present. Editor HTML is already converted to plain text. |
| `media` | array | Zero or more items, in the order the user attached them. `type` is `image` or `video`. `url` is a URL the hub can fetch (the public upload URL Postiz already generated). Local disk paths are not sent. |
| `settings` | object | The Postiz settings object for that post, including `__type`. Nabux channels have no extra settings fields. The hub may ignore this. |
| `postiz_post_id` | string | Postiz's own post id, for logs and idempotency. It is not a platform id. |

A Postiz post is one request. Thread comments are not sent; these channels do not implement `comment`.

### Publish response

`200` or `201`, JSON:

```json
{
  "id": "platform-post-id",
  "url": "https://platform.example/p/platform-post-id",
  "status": "published"
}
```

| Field | Maps to |
| --- | --- |
| `id` | Postiz `postId` (required, non-empty; numbers are stringified) |
| `url` | Postiz `releaseURL` (optional; stored as an empty string when omitted) |
| `status` | Postiz result `status` |

`status` must be one of `published`, `success`, `completed`, `ok`, `posted`. When `status` is omitted it is treated as `published`.

`pending`, `processing` and `queued` are rejected. Postiz would otherwise poll a status endpoint these providers do not implement. The hub has to finish the publish inside this HTTP call.

Any other status is a failure, even on HTTP 200. Include `error` or `message` with the reason.

### Publish errors

Postiz uses the shared provider `fetch` helper, so the behaviour matches the other channels.

| HTTP | JSON body | Postiz result |
| --- | --- | --- |
| 401 | `{ "error": "..." }` or `{ "message": "..." }` | Refresh-token failure. The channel is marked as needing reconnect. The message is shown to the user. |
| 400, 403, 404, 422, other 4xx | `{ "error": "..." }` or `{ "message": "..." }` or `{ "detail": "..." }` | Bad-body failure. The post is not retried. `404` with no message becomes "Nabux account was not found". |
| 429 | optional `{ "error": "..." }` | Retried up to 3 times, 5 seconds apart, then bad-body. |
| 500 | optional body | Retried up to 3 times when the body is not classified above, then bad-body. |
| 200/201 with a non-success `status`, missing `id`, or a non-JSON body | | Bad-body. The post is not marked published. |

The bearer token is sent only in the `Authorization` header. It is not written to the URL, so it does not land in Temporal heartbeat details.

## Environment variables

No new variable is required.

| Variable | Required | Effect |
| --- | --- | --- |
| `NABUX_SOCIAL_BASE_URL` | no | Default value of the connect form, and the base URL used at publish time when the stored channel has none. Defaults to `https://social.nabuxai.com`. |
| `JWT_SECRET` | already required by Postiz | Encrypts `customInstanceDetails`. |
| `FRONTEND_URL` | already required | Used to turn a local upload path into a public media URL. |
| `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` | no | Public path prefix for local uploads. Defaults to `/uploads`. |
| `UPLOAD_DIRECTORY` | already used for local storage | Stripped off disk paths before the public URL is built. |
| `DISABLE_SSRF_PROTECTION` | no | Existing Postiz switch. Leave unset when the hub is public. Set to `true` only if the base URL is on a private network; otherwise the connect and publish requests are blocked. |
| `HIDDEN_PROVIDERS` | no | Existing Postiz switch. Example: `nabux-x,nabux-instagram` hides those channels from the add-channel screen. |

## Build the image

The workflow `.github/workflows/nabux-image.yml` builds and pushes the image. It does not deploy to a server.

- Pushing any git tag builds `ghcr.io/nabuxai/postiz-app:nabux-<tag>` (a tag that already starts with `nabux-` is not prefixed twice).
- Manual run: Actions → **Nabux image** → **Run workflow**, and set `version` (for example `v2.25.3`). The pushed tag is `nabux-v2.25.3`.

The image is `linux/amd64`, built from `Dockerfile.dev` (the same Dockerfile the upstream container workflow uses). `NEXT_PUBLIC_VERSION` is set to the image tag.

Local build, from the repository root:

```bash
docker build -f Dockerfile.dev \
  --build-arg NEXT_PUBLIC_VERSION=nabux-dev \
  -t ghcr.io/nabuxai/postiz-app:nabux-dev .
```

Publishing that image to GHCR from a workstation is a separate `docker push`. The GitHub Action uses `GITHUB_TOKEN` and needs the repository permission **Packages: write**.

## What the hub still has to implement

SocialMCP does not expose this contract today. Its current publish path is the opposite direction: the hub calls `POST {platform MCP}/internal/v1/accounts/{key}/publish`. Postiz now calls that same shape on the base URL saved on the channel (the hub, by default).

Still to build on the hub side:

1. `POST /internal/v1/accounts/{accountKey}/publish` accepting the JSON body in this document, with `Authorization: Bearer` equal to the token the user pastes into Postiz.
2. Dispatch on `platform` to the downstream MCP, then return `{ "id", "url", "status": "published" }` only after the platform has accepted the post.
3. Optional `GET /internal/v1/accounts/{accountKey}` for the channel name and avatar. Until it exists, Postiz still connects and shows the account key.
4. **Bale, Eitaa, Rubika and Soroush.** There is no MCP, container or publish route for them. Those four Postiz channels will fail at publish until a service implements this contract for `platform` `bale`, `eitaa`, `rubika` and `soroush`.
5. The existing platform MCPs do not all implement this generic route. Instagram publishes on `/publish/image`, `/publish/carousel`, `/publish/reel` and `/publish/story`. X, Threads, TikTok, YouTube and LinkedIn have their own internal routes. Telegram and WhatsApp are messaging tools and have no internal publish route. The hub (or each MCP, if a channel's base URL points directly at it) has to adapt those routes to this body.
6. Snapchat was not added. Its MCP is ads and analytics only.

## Files that have to move together on a rebase

- `libraries/nestjs-libraries/src/integrations/social/nabux/`
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` (one import, providers appended)
- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/all.providers.settings.ts` (the `__type` allow-list)
- `libraries/nestjs-libraries/src/temporal/temporal.module.ts` (the `nabux` activity queue)
- `apps/frontend/src/components/new-launch/providers/nabux/nabux.provider.tsx`
- `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx`
- `apps/frontend/public/icons/platforms/nabux-*.png`
- `docs/nabux-providers.md`
- `.github/workflows/nabux-image.yml`
- `libraries/nestjs-libraries/jest.config.cjs` and the root `jest.config.ts` project entry
