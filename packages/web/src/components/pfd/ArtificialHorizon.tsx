

interface Props {
    pitch: number;
    roll: number;
}

export default function ArtificialHorizon({ pitch, roll }: Props) {
    // 1 degree of pitch = X pixels of translation. 
    // Standard PFD: ~4mm per degree. In SVG pixels, let's say 4px per degree.
    const PITCH_FACTOR = 6;

    // Translation for pitch:
    // Positive pitch (nose up) -> Horizon moves DOWN.
    const translateY = pitch * PITCH_FACTOR;

    return (
        <div className="absolute inset-0 overflow-hidden bg-black rounded-lg clip-path-pfd">
            {/* Rotating Layer (Roll) */}
            <div
                className="w-full h-full relative origin-center transition-transform duration-75 will-change-transform"
                style={{ transform: `rotate(${-roll}deg)` }}
            >
                {/* Horizon Layer (Pitch) */}
                <div
                    className="absolute inset-[-100%] w-[300%] h-[300%] flex flex-col transition-transform duration-75 will-change-transform origin-center"
                    style={{ transform: `translateY(${translateY}px)` }}
                >
                    {/* Sky */}
                    <div className="flex-1 bg-[#007AC9] border-b-2 border-white relative">
                        {/* Pitch Ladder (Sky Positive) */}
                        {/* 10, 20, 30 degrees */}
                        {[10, 20, 30].map(deg => (
                            <div key={deg} className="absolute bottom-0 w-full flex justify-center items-end" style={{ bottom: `${deg * PITCH_FACTOR}px` }}>
                                <div className="flex items-center gap-1">
                                    <div className="w-8 h-[2px] bg-white"></div>
                                    <span className="text-white text-xs font-bold">{deg}</span>
                                    <div className="w-8 h-[2px] bg-white"></div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Ground */}
                    <div className="flex-1 bg-[#6A3F28] border-t-2 border-white relative">
                        {/* Pitch Ladder (Ground Negative) */}
                        {[10, 20, 30].map(deg => (
                            <div key={deg} className="absolute top-0 w-full flex justify-center items-start" style={{ top: `${deg * PITCH_FACTOR}px` }}>
                                <div className="flex items-center gap-1">
                                    <div className="w-8 h-[2px] bg-white"></div>
                                    <span className="text-white text-xs font-bold">{deg}</span>
                                    <div className="w-8 h-[2px] bg-white"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Aircraft Symbol (Fixed) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Black/Yellow Aircraft Reference */}
                <svg width="200" height="40" viewBox="0 0 200 40">
                    {/* Left Wing */}
                    <path d="M40 20 H80 V30 H45 L40 20" fill="transparent" stroke="#FFF" strokeWidth="3" />
                    <path d="M40 20 H80 V30 H45 L40 20" fill="#000" />
                    <rect x="40" y="20" width="30" height="10" fill="#FFCC00" />

                    {/* Right Wing */}
                    <path d="M120 20 H160 V30 H155 L160 20" fill="transparent" stroke="#FFF" strokeWidth="3" />
                    <path d="M120 20 H160 V30 H155 L160 20" fill="#000" />
                    <rect x="130" y="20" width="30" height="10" fill="#FFCC00" />

                    {/* Center Dot */}
                    <rect x="98" y="18" width="4" height="4" fill="#FFCC00" stroke="#000" />
                </svg>
            </div>

            {/* Roll Scale (Top) */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-40 h-40 pointer-events-none">
                {/* Arc */}
                <svg width="100%" height="100%" viewBox="0 0 100 100" className="overflow-visible">
                    <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="white" strokeWidth="2" />
                    {/* Tick marks would go here */}
                    <rect x="48" y="8" width="4" height="8" fill="#FFCC00" /> {/* Center Sky Pointer */}
                </svg>
            </div>

            {/* Roll Pointer (Moving) */}
            <div
                className="absolute top-4 left-1/2 -translate-x-1/2 w-4 h-4 transition-transform duration-75 will-change-transform origin-[50%_40px]" // Pivot around arc center
                style={{ transform: `translateY(10px) rotate(${-roll}deg)` }}
            >
                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[10px] border-t-white"></div>
            </div>
        </div>
    );
}
