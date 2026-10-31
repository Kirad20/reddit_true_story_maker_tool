// OAuth scopes each platform needs to publish. Shared by the publishers and auth.ts (no imports: avoids cycles).
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_video"];
export const TIKTOK_API = "https://open.tiktokapis.com/v2";
