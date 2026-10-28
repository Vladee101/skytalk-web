interface AudioUnlockOverlayProps {
  onUnlock: () => void;
}

/**
 * Browsers keep audio muted until the user interacts with the page. Without this tap
 * the student hears nothing until their first PTT press — and on a phone there's no Space key.
 */
export default function AudioUnlockOverlay({ onUnlock }: AudioUnlockOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-6">
      <button
        type="button"
        onClick={onUnlock}
        className="w-full max-w-xs rounded-2xl bg-sky-600 px-6 py-6 text-center text-white shadow-xl hover:bg-sky-500 active:bg-sky-700"
      >
        <span className="block text-lg font-bold">Tap to enable audio</span>
        <span className="mt-1 block text-xs text-sky-100">Browsers keep sound off until you tap the page</span>
      </button>
    </div>
  );
}
