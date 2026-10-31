import { useEffect, useState } from "react";
import { pipelineApi, type Publication, type TikTokComposerData, type TikTokPrivacy } from "./api";

// "Post to TikTok" screen for the TikTok app review (feature flag: Ajustes → "Modo revisión TikTok").
// Follows TikTok's Content Sharing Guidelines for Direct Post: creator shown, privacy with no default,
// interactions unchecked by default and greyed out when the creator disabled them, commercial content
// disclosure, the consent declaration, the max duration check and a "processing" notice after posting.
// In English because TikTok reviews it.

const PRIVACY_LABEL: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BC_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export function TikTokComposer({ pub, onClose, onPosted }: { pub: Publication; onClose: () => void; onPosted: () => void }) {
  const [data, setData] = useState<TikTokComposerData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState([pub.title, pub.description].filter(Boolean).join("\n"));
  const [privacy, setPrivacy] = useState<TikTokPrivacy | "">("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    pipelineApi.tiktokComposer(pub.id).then(setData, (e: Error) => setLoadError(e.message));
  }, [pub.id]);

  // Branded content cannot be private.
  useEffect(() => {
    if (disclose && brandedContent && privacy === "SELF_ONLY") setPrivacy("");
  }, [disclose, brandedContent, privacy]);

  if (loadError) {
    return (
      <div className="tt-composer">
        <p className="error">Cannot post to TikTok right now: {loadError}</p>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (!data) return <p className="muted small">Loading your TikTok account…</p>;

  const { creator } = data;
  const tooLong = Boolean(data.videoDurationSec && creator.maxVideoPostDurationSec && data.videoDurationSec > creator.maxVideoPostDurationSec);
  const bc = disclose && brandedContent;
  const discloseIncomplete = disclose && !brandOrganic && !brandedContent;
  const canPost = !busy && !posted && !tooLong && privacy !== "" && !discloseIncomplete && title.trim().length > 0;

  async function post() {
    if (!privacy) return;
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.publishToTikTok(pub.id, {
        title: title.trim(),
        privacy,
        allowComment,
        allowDuet,
        allowStitch,
        brandOrganic: disclose && brandOrganic,
        brandedContent: disclose && brandedContent,
        consent: true,
      });
      setPosted(true);
      onPosted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (posted) {
    return (
      <div className="tt-composer">
        <p className="note">
          Your video is being posted to TikTok. It may take a few minutes to process and appear on your profile. The status of this
          publication updates here when TikTok finishes.
        </p>
        <button className="ghost" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="tt-composer" lang="en">
      <h4>Post to TikTok</h4>
      <div className="tt-grid">
        {data.videoUrl ? <video className="tt-preview" src={data.videoUrl} controls playsInline /> : <p className="muted small">No preview</p>}
        <div className="tt-form">
          <div className="tt-creator">
            {creator.avatarUrl && <img src={creator.avatarUrl} alt="" />}
            <div>
              <span className="small muted">Posting to</span>
              <strong>{creator.nickname || "TikTok account"}</strong>
              {creator.username && <span className="small muted">@{creator.username}</span>}
            </div>
          </div>

          <label className="field">
            <span>Title</span>
            <textarea rows={4} maxLength={2200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className="field">
            <span>Who can view this video</span>
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as TikTokPrivacy)}>
              <option value="" disabled>
                Select privacy
              </option>
              {creator.privacyOptions.map((p) => (
                <option key={p} value={p} disabled={bc && p === "SELF_ONLY"}>
                  {PRIVACY_LABEL[p] ?? p}
                  {bc && p === "SELF_ONLY" ? " — branded content visibility cannot be set to private" : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="tt-set">
            <legend>Allow users to</legend>
            <label className={`toggle ${creator.commentDisabled ? "disabled" : ""}`}>
              <input type="checkbox" checked={allowComment} disabled={creator.commentDisabled} onChange={(e) => setAllowComment(e.target.checked)} />
              <span>Comment</span>
            </label>
            <label className={`toggle ${creator.duetDisabled ? "disabled" : ""}`}>
              <input type="checkbox" checked={allowDuet} disabled={creator.duetDisabled} onChange={(e) => setAllowDuet(e.target.checked)} />
              <span>Duet</span>
            </label>
            <label className={`toggle ${creator.stitchDisabled ? "disabled" : ""}`}>
              <input type="checkbox" checked={allowStitch} disabled={creator.stitchDisabled} onChange={(e) => setAllowStitch(e.target.checked)} />
              <span>Stitch</span>
            </label>
          </fieldset>

          <fieldset className="tt-set">
            <legend>Content disclosure</legend>
            <label className="toggle">
              <input type="checkbox" checked={disclose} onChange={(e) => setDisclose(e.target.checked)} />
              <span>Disclose video content — this video promotes goods or services in exchange for something of value</span>
            </label>
            {disclose && (
              <div className="tt-sub">
                <label className="toggle">
                  <input type="checkbox" checked={brandOrganic} onChange={(e) => setBrandOrganic(e.target.checked)} />
                  <span>
                    <b>Your brand</b> — you are promoting yourself or your own business
                  </span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={brandedContent} onChange={(e) => setBrandedContent(e.target.checked)} />
                  <span>
                    <b>Branded content</b> — you are promoting another brand or a third party
                  </span>
                </label>
                {discloseIncomplete && <p className="warn small">You need to indicate if your content promotes yourself, a third party, or both.</p>}
                {brandedContent ? (
                  <p className="small muted">Your video will be labeled as "Paid partnership".</p>
                ) : brandOrganic ? (
                  <p className="small muted">Your video will be labeled as "Promotional content".</p>
                ) : null}
              </div>
            )}
          </fieldset>

          <p className="small muted">This video uses an AI voice and will be labeled as AI-generated content on TikTok.</p>
          {tooLong && (
            <p className="error small">
              This video is {Math.ceil(data.videoDurationSec!)} s long; your account can post videos up to {creator.maxVideoPostDurationSec} s.
            </p>
          )}

          <p className="small">
            By posting, you agree to TikTok's{" "}
            {bc && (
              <>
                <a href={BC_URL} target="_blank" rel="noreferrer">
                  Branded Content Policy
                </a>{" "}
                and{" "}
              </>
            )}
            <a href={MUSIC_URL} target="_blank" rel="noreferrer">
              Music Usage Confirmation
            </a>
            .
          </p>
          {error && <p className="error small">{error}</p>}
          <div className="actions">
            <button
              className="primary"
              disabled={!canPost}
              title={discloseIncomplete ? "You need to indicate if your content promotes yourself, a third party, or both." : privacy ? "" : "Select who can view this video"}
              onClick={post}
            >
              {busy ? "Posting…" : "Post"}
            </button>
            <button className="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
