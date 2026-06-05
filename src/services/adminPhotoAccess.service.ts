import { apiPost } from './api';

type PhotoUrlResponse = {
  ok?: boolean;
  url?: string;
  error?: string;
};

export async function refreshAdminPhotoUrl(photoUrl: string): Promise<string> {
  const trimmed = String(photoUrl || '').trim();
  if (!trimmed) throw new Error('photo_url_empty');
  const response = await apiPost<PhotoUrlResponse>('/uploads/photo-url', { photoUrl: trimmed });
  if (!response.ok || !response.url) {
    throw new Error(response.error || 'photo_url_refresh_failed');
  }
  return response.url;
}
