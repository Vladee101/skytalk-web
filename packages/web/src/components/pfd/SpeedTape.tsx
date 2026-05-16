

interface Props {
    speed: number;   // Current Speed
    target?: number; // Target/Bug Speed
}

export default function SpeedTape({ speed, target: _target = 0 }: Props) {
    // Height of one unit (knot) in pixels.
    // 10 knots = 50px? 
    const SCALE_FACTOR = 8; // Pixels per knot

    // Display range: Current speed is centered.
    // We want to render a tape from (Speed - 40) to (Speed + 40)
    // Actually better to render a huge tape and translate it?
    // Or render just the visible ticks dynamically.

    // Dynamic rendering optimization:
    // Determine visible start/end
    const VISIBLE_RANGE = 60; // +/- 60 knots visible
    const centerSpeed = Math.floor(speed);
    const minSpeed = Math.max(0, centerSpeed - VISIBLE_RANGE);
    const maxSpeed = centerSpeed + VISIBLE_RANGE;

    // Find nearest multiple of 10
    const startTick = Math.ceil(minSpeed / 10) * 10;
    const ticks = [];
    for (let s = startTick; s <= maxSpeed; s += 10) {
        ticks.push(s);
    }

    // Offset: How far is the current speed from the startTick?
    // We want 'speed' to be exactly at center (WINDOW_HEIGHT / 2)
    // Position of tick 's' relative to center:
    // dy = (s - speed) * SCALE_FACTOR
    // In CSS top: (WINDOW_HEIGHT / 2) - dy

    return (
        <div className="absolute left-0 top-[10%] bottom-[10%] w-16 bg-[#222]/80 border-r-2 border-gray-600 overflow-hidden clip-path-tape">
            {/* Speed Bugs? */}

            {/* Moving Tape */}
            {ticks.map(val => {
                const offset = (val - speed) * SCALE_FACTOR; // Negative means below, Positive above
                // In DOM, y increases downwards. 
                // Higher speed should be HIGHER up (lower y).
                // So dy = -offset.

                return (
                    <div
                        key={val}
                        className="absolute w-full border-t border-white right-0 flex items-center justify-end pr-1"
                        style={{ top: `${50}%`, transform: `translateY(${-offset}px)` }}
                    >
                        <span className="text-white text-sm font-bold bg-[#222]/50 px-1">{val}</span>
                    </div>
                );
            })}

            {/* Current Value Box (Fixed Center) */}
            <div className="absolute top-1/2 left-0 right-[-5px] -translate-y-1/2 h-8 bg-black border-2 border-yellow-400 z-10 flex items-center justify-center shadow-lg">
                <span className="text-green-400 font-bold text-lg">{Math.round(speed)}</span>
                {/* Triangle Pointer */}
                {/* <div className="absolute right-[-10px] w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-yellow-400"></div> */}
            </div>

            {/* Label */}
            <div className="absolute top-[-20px] left-0 w-full text-center text-xs text-green-500 font-bold">SPD</div>
        </div>
    );
}
