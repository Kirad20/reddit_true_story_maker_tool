# TikTok app review

Material for the TikTok for Developers review form. Products and scopes this app uses
(remove any other product or scope in the portal before submitting):

| Product | Scope | Used for |
| --- | --- | --- |
| Login Kit | `user.info.basic` | Connect the creator's account and show its name and avatar |
| Content Posting API (Direct Post) | `video.publish` | Publish the video the user approved to their TikTok |

## "Explain how each product and scope works" (paste into the form)

```text
TrueStoryMaker is a web app (the URL in this submission) that turns short text stories into vertical videos
with an AI voice and word-by-word captions. Users can publish a finished video to their own TikTok account.
Access is private: users sign in with an account created by the administrator.

Login Kit — user.info.basic
In Settings > Publishing accounts the user clicks "Connect" on the TikTok card. We redirect to TikTok's
authorization page (Login Kit, OAuth 2.0 with our registered redirect URI). After the user authorizes, we read
open_id, display_name and avatar_url with /v2/user/info/ to show which TikTok account is connected ("Connected
as <display name>"). The access and refresh tokens are stored on our server only and are never sent to the
browser. The user can click "Disconnect" at any time, which deletes the stored tokens.

Content Posting API (Direct Post) — video.publish
In the Publications tab the user reviews each generated video before it is posted: they watch the preview,
edit the caption, and approve it. Only approved videos are published. Before every post we call
/v2/post/publish/creator_info/query/ to get the creator's allowed privacy levels and settings, then call
/v2/post/publish/video/init/ with the chosen privacy level, the caption and is_aigc=true (every video is
labeled as AI-generated content), upload the MP4 to the returned upload_url, and poll
/v2/post/publish/status/fetch/ to show the result ("Published" with a link, or the error) in the app.
We do not read the user's existing videos, followers, messages or any other TikTok data, and we never post
anything the user has not approved.
```

## Demo video script (sandbox)

Record the screen of the real deployment (same domain as the website URL in the form), using the sandbox
app's client key/secret and a TikTok account added as a sandbox target user. One take, 2–4 minutes, no cuts
in the authorization step.

1. Open `https://<your-domain>/` and show the address bar. Sign in.
2. **Ajustes → Cuentas para publicar → TikTok**: show the sandbox client key is configured, click
   **Conectar**.
3. TikTok's authorization page opens: show the app name and the requested permissions
   (`user.info.basic`, `video.publish`), sign in with the sandbox target user and click **Authorize**.
4. Back in the app the card shows **Connected as <display name>** (this is `user.info.basic`).
5. Create a video (paste a short story in **Panel**), wait for it to finish, and play the preview.
6. **Publicaciones**: open the TikTok publication, show the preview, edit the caption, pick the privacy
   level ("Solo yo" — the only one allowed before the audit) and click **Aprobar** / publish.
7. Wait for the status to change to **Publicada** and open the link.
8. Open the TikTok app or tiktok.com with the same account and show the new private video with the caption
   and the "AI-generated" label (this is `video.publish`).
9. Back in **Ajustes**, click **Desconectar** on TikTok to show the user can revoke access.

Keep the UI in English if you can, or add short captions to the video explaining each step in English.
