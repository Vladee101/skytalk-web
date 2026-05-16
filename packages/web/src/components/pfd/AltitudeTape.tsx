

interface Props {
    altitude: number; // Feet
    target?: number; // Target Alt
    std?: boolean; // QNH Standard?
}

export default function AltitudeTape({ altitude, target: _target = 0 }: Props) {
    const PIXELS_PER_100FT = 50;

    // Range
    const VISIBLE_RANGE_FT = 600;
    const centerAlt = Math.floor(altitude);
    const minAlt = Math.max(0, centerAlt - VISIBLE_RANGE_FT);
    const maxAlt = centerAlt + VISIBLE_RANGE_FT;

    const startTick = Math.ceil(minAlt / 100) * 100;
    const ticks = [];
    for (let a = startTick; a <= maxAlt; a += 100) {
        ticks.push(a);
    }

    return (
        <div className="absolute right-0 top-[10%] bottom-[10%] w-20 bg-[#222]/80 border-l-2 border-gray-600 overflow-hidden">
            {/* Label */}
            <div className="absolute top-[-20px] left-0 w-full text-center text-xs text-green-500 font-bold">ALT</div>

            {/* Moving Tape */}
            {ticks.map(val => {
                const diff = val - altitude;
                // Higher altitude -> Higher up (Negative Y)
                const offset = (diff / 100) * PIXELS_PER_100FT;

                return (
                    <div
                        key={val}
                        className="absolute w-full border-t border-white left-0 flex items-center pl-1"
                        style={{ top: '50%', transform: `translateY(${-offset}px)` }}
                    >
                        <span className="text-white text-sm font-bold bg-[#222]/50 px-1">{val}</span>
                    </div>
                );
            })}

            {/* Current Value Box (Fixed Center) */}
            <div className="absolute top-1/2 right-0 left-[-5px] -translate-y-1/2 h-10 bg-black border-2 border-yellow-400 z-10 flex items-center justify-center shadow-lg pl-2">
                <span className="text-green-400 font-bold text-lg tracking-widest">
                    {Math.round(altitude).toString().padStart(3, '0')}
                    {/* Could add rolling digit logic here later */}
                </span>
            </div>

            {/* QNH */}
            <div className="absolute bottom-2 w-full text-center text-cyan-400 text-sm font-mono">
                QNH <span className="font-bold">1013</span>
            </div>
        </div>
    );
}
