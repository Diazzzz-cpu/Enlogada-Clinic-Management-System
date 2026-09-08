import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { toastSuccess, toastError } from '../lib/toast';
import { Camera, Loader2 } from 'lucide-react';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3MB, matches backend/src/config/upload.js

// UI/UX Modernization Phase 8: self-service profile photo, scoped to the My Account/Profile
// page only — the initials-circle avatars elsewhere in the app (sidebar, public header) are
// left as-is (see database/migrations.md [1.9.0] for the scope reasoning).
const AvatarUpload = () => {
  const { user, updateAvatarFlag } = useAuth();
  const [objectUrl, setObjectUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchAvatar = useCallback(async () => {
    if (!user?.hasAvatar) return;
    try {
      const res = await api.get('/auth/me/avatar', { responseType: 'blob' });
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(res.data);
      });
    } catch (err) {
      console.error('Failed to load avatar:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.hasAvatar]);

  useEffect(() => {
    fetchAvatar();
  }, [fetchAvatar]);

  // Revoke the blob URL on unmount only — fetchAvatar itself revokes the previous one whenever
  // it creates a new one, so cleaning up here too would double-revoke a URL still in use.
  useEffect(() => () => {
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return prev;
    });
  }, []);

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toastError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toastError('Image must be 3MB or smaller.');
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);
    setUploading(true);
    try {
      await api.post('/auth/me/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      updateAvatarFlag(true);
      await fetchAvatar();
      toastSuccess('Profile photo updated.');
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await api.delete('/auth/me/avatar');
      updateAvatarFlag(false);
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      toastSuccess('Profile photo removed.');
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to remove photo.');
    } finally {
      setUploading(false);
    }
  };

  const initial = user?.firstName ? user.firstName.charAt(0).toUpperCase() : 'U';

  return (
    <div className="flex items-center space-x-4">
      <div className="relative w-16 h-16 flex-shrink-0">
        <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl overflow-hidden border-2 border-surface shadow-md">
          {objectUrl ? (
            <img src={objectUrl} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Change profile photo"
          className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 hover:text-brand-600 hover:border-brand-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-700 m-0">Profile Photo</p>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-fine font-bold text-brand-600 hover:underline bg-transparent border-0 p-0 cursor-pointer disabled:opacity-50"
          >
            {objectUrl ? 'Change' : 'Upload'}
          </button>
          {objectUrl && (
            <>
              <span className="text-gray-300">&middot;</span>
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="text-fine font-bold text-red-600 hover:underline bg-transparent border-0 p-0 cursor-pointer disabled:opacity-50"
              >
                Remove
              </button>
            </>
          )}
        </div>
        <p className="text-meta text-gray-400 m-0">JPEG, PNG, or WebP. Max 3MB.</p>
      </div>
    </div>
  );
};

export default AvatarUpload;
