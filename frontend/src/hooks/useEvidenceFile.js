import { useState, useEffect, useCallback } from 'react';
import { prepareCardImage } from '../lib/cardImage';

/**
 * One file a patient attaches as evidence for an HMO claim: the card, or since [1.106.0] the
 * doctor's signed request. Lifted out of BookingDialog when the second one arrived, so the two
 * cannot drift — they were going to be the same forty lines twice.
 *
 * Holds the prepared file, a preview URL for an image, the error from preparing it, and whether
 * that is still running. `pick` is the input's onChange; `clear` drops everything.
 *
 * @param {object} [options]  passed to prepareCardImage: `name` and `maxEdge`
 */
export function useEvidenceFile(options) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);

  const clear = useCallback(() => {
    setFile(null);
    setError('');
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return '';
    });
  }, []);

  // Nothing renders the object URL after unmount, so release it rather than leaking one per
  // abandoned booking.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (e) => {
    const picked = e.target.files?.[0];
    // Clearing the input lets the same file be re-picked after a rejection; the accepted file is
    // deliberately NOT cleared, so cancelling a re-pick keeps the photo already chosen.
    e.target.value = '';
    if (!picked) return;

    setError('');
    setPreparing(true);
    try {
      const prepared = await prepareCardImage(picked, options);
      setFile(prepared);
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return prepared.type === 'application/pdf' ? '' : URL.createObjectURL(prepared);
      });
    } catch (err) {
      setError(err.message);
      setFile(null);
    } finally {
      setPreparing(false);
    }
  };

  return { file, preview, error, preparing, pick, clear };
}
