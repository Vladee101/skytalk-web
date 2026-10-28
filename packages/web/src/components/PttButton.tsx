interface PttButtonProps {
  pressed: boolean;
  onPress: () => void;
  onRelease: () => void;
  disabled?: boolean;
  className?: string;
}

/** Hold-to-talk button for touch and mouse. Space key PTT is handled by usePTT. */
export default function PttButton({ pressed, onPress, onRelease, disabled, className = '' }: PttButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      // Pointer capture keeps pointerup on this button even if the finger slides off
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onLostPointerCapture={onRelease}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboard activation would fire click, not press/hold — Space is already PTT
      onKeyDown={(e) => e.preventDefault()}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      className={[
        'rounded-xl font-semibold tracking-widest uppercase select-none transition-colors',
        'disabled:opacity-40',
        pressed
          ? 'bg-sky-600 text-white ring-4 ring-sky-400/40'
          : 'bg-gray-900 border-2 border-sky-800 text-sky-300 active:bg-sky-900',
        className,
      ].join(' ')}
    >
      {pressed ? 'Transmitting…' : 'Hold to talk'}
      <span className="hidden sm:inline text-[10px] font-normal normal-case tracking-normal opacity-60">
        {' '}
        (or Space)
      </span>
    </button>
  );
}
