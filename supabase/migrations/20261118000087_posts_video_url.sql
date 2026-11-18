-- Beauty Vlog trên website: bài viết có thể gắn 1 video (TikTok / YouTube)
alter table public.posts add column if not exists video_url text
  check (video_url is null or video_url ~* '^https?://');
comment on column public.posts.video_url is 'Link video TikTok/YouTube gắn vào bài (hiện ở Beauty Vlog trên website và trang bài viết trong app)';
