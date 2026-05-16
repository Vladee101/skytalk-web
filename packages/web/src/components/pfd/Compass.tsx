

interface Props {
    heading: number; // 0-360
}

export default function Compass({ heading }: Props) {
    // Horizontal Tape
    // 10 degrees = 50px
    const PIXELS_PER_DEG = 5;

    // Normalized heading 0-360
    const normHdg = ((heading % 360) + 360) % 360;

    // Generate ticks covering the visible range, wrapping around 360
    const centerHdg = Math.round(normHdg);
    const ticks = [];

    // We render a wide range to handle wrap-around easily or simple math
    // Let's just render range [center - 40, center + 40]
    for (let h = centerHdg - 50; h <= centerHdg + 50; h += 10) {
        ticks.push(h);
    }

    return (
        <div className="absolute bottom-0 left-[20%] right-[20%] h-16 bg-[#222]/80 border-t-2 border-white overflow-hidden flex justify-center">
            {/* Tape Container */}
            <div className="relative w-full h-full">
                {ticks.map(val => {
                    // Normalize display value (0-359)
                    let displayVal = ((val % 360) + 360) % 360;
                    // North is N
                    let label = displayVal.toString();
                    if (displayVal === 0) label = "N";
                    if (displayVal === 90) label = "E";
                    if (displayVal === 180) label = "S";
                    if (displayVal === 270) label = "W";

                    // Leading zeros for numbers
                    if (label.length < 3 && !isNaN(Number(label))) {
                        // Airbus style: 30, 31, 32, 33... but usually just 10s.
                        label = displayVal.toString();
                    }

                    const offset = (val - heading) * PIXELS_PER_DEG;

                    return (
                        <div
                            key={val}
                            className="absolute top-0 bottom-0 flex flex-col items-center justify-start pt-1"
                            style={{ left: '50%', transform: `translateX(${offset}px)` }}
                        >
                            <div className="w-[1px] h-2 bg-white mb-1"></div>
                            <span className="text-white text-md font-bold">{label}</span>
                        </div>
                    );
                })}
            </div>

            {/* Current Heading Triangle (Fixed Center) */}
            <div className="absolute top-0 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[12px] border-t-yellow-400 z-10"></div>

            {/* Digital Readout */}
            <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/60 border border-white px-2 rounded z-20">
                <span className="text-green-400 font-bold font-mono tracking-wider text-xl">
                    {Math.round(normHdg).toString().padStart(3, '0')}
                </span>
            </div>
        </div>
    );
}
