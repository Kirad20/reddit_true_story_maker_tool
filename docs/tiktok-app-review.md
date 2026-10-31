# TikTok app review

Material for the TikTok for Developers review form. Products and scopes this app uses
(remove any other product or scope in the portal before submitting):

| Product | Scope | Used for |
| --- | --- | --- |
| Login Kit | `user.info.basic` | Connect the creator's account and show its name and avatar |
| Content Posting API (Direct Post) | `video.publish` | Publish the video the user approved to their TikTok |

## "Explain how each product and scope works" (paste into the form, max 1000 characters)

```text
TrueStoryMaker (the web app at this URL) turns text stories into vertical videos with AI voice and captions, and lets users post them to their own TikTok account.

Login Kit (user.info.basic): in Settings the user clicks Connect on TikTok and authorizes via OAuth. We show the connected account's display name and avatar. Tokens stay on our server; Disconnect deletes them.

Content Posting API (video.publish): in Publications the user clicks "Post to TikTok". We query creator_info and show the creator's nickname, a video preview, an editable title, privacy options (no default), Comment/Duet/Stitch toggles, commercial content disclosure and the Music Usage Confirmation. On Post we call video/init with those choices and is_aigc=true, upload the MP4 and poll status/fetch to show the result. Nothing is posted without the user's action.
```

## Demo video script (sandbox)

First turn on the feature flag: **Ajustes → Publicar → "Modo revisión TikTok"** and save. With it on, every
TikTok publication waits for the **Post to TikTok** screen (it never posts automatically), and that screen follows
TikTok's Content Sharing Guidelines. With it off the app works as before.

Record the screen of the real deployment (same domain as the website URL in the form), using the sandbox
app's client key/secret and a TikTok account added as a sandbox target user. One take, 2–4 minutes, no cuts
in the authorization step.

1. Open `https://<your-domain>/` showing the address bar. Sign in.
2. **Ajustes → Cuentas para publicar → TikTok**: click **Conectar**.
3. TikTok's authorization page: show the requested permissions (`user.info.basic`, `video.publish`), sign in
   with the sandbox target user and click **Authorize**.
4. Back in the app the card shows the connected account name (`user.info.basic`).
5. Create a video (or use one already rendered) and queue it for TikTok; open **Publicaciones**.
6. Click **Post to TikTok** and, slowly, show each part of the screen:
   - "Posting to" with the creator's nickname (from `creator_info`);
   - the video preview and the editable title (edit it);
   - "Who can view this video" starts empty: open it and choose **Only me** (the only option before the audit);
   - Comment / Duet / Stitch unchecked by default (greyed out if disabled in the creator's TikTok settings):
     tick Comment;
   - Content disclosure: turn it on, show "Your brand" / "Branded content" and the label each one adds, show
     that Branded content disables "Only me", then turn disclosure off again;
   - the AI-generated label notice and the Music Usage Confirmation text.
7. Click **Post**: the app says the video may take a few minutes to process; wait until the card shows
   **Publicada** and click **Abrir publicación**.
8. Show the new private video on TikTok with that account, with the edited title and the AI-generated label.
9. Back in **Ajustes**, click **Desconectar** on TikTok.

The Post to TikTok screen is in English; add English captions to the video for the Spanish parts of the UI.
