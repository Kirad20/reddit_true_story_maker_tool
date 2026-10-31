# TikTok app review

Material for the TikTok for Developers review form. Products and scopes this app uses
(remove any other product or scope in the portal before submitting):

| Product | Scope | Used for |
| --- | --- | --- |
| Login Kit | `user.info.basic` | Connect the creator's account and show its name and avatar |
| Content Posting API (Direct Post) | `video.publish` | Publish the video the user approved to their TikTok |

## "Explain how each product and scope works" (paste into the form, max 1000 characters)

```text
TrueStoryMaker (the web app at this URL) turns text stories into vertical videos with AI voice and captions, and lets users publish them to their own TikTok account.

Login Kit (user.info.basic): in Settings > Publishing accounts the user clicks Connect on TikTok and authorizes via OAuth. We read open_id, display_name and avatar_url to show which account is connected. Tokens stay on our server; Disconnect deletes them.

Content Posting API (video.publish): in Publications the user previews the video, edits the caption and approves it. Before each post we query creator_info for the allowed privacy levels, call video/init with the chosen privacy and is_aigc=true (AI-generated label), upload the MP4 and poll status/fetch to show the result in the app. Only approved videos are posted. We read no other TikTok data.
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
