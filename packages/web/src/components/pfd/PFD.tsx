
import { useFlightStore } from '../../store/flightStore';
import ArtificialHorizon from './ArtificialHorizon';
import SpeedTape from './SpeedTape';
import AltitudeTape from './AltitudeTape';
import Compass from './Compass';

export default function PFD() {
    const { pfd } = useFlightStore();
    const { speed, altitude, heading, pitch, roll } = pfd;

    return (
        <div className="w-[80vh] h-[80vh] relative bg-black rounded-xl overflow-hidden shadow-2xl border-4 border-slate-800">
            {/* Layer 1: Horizon (Background) */}
            <ArtificialHorizon pitch={pitch} roll={roll} />

            {/* Layer 2: Tapes (Overlay) */}
            <SpeedTape speed={speed} />
            <AltitudeTape altitude={altitude} />
            <Compass heading={heading} />

            {/* Layer 3: FMA / Top Bar (Optional) */}
            <div className="absolute top-0 w-full h-10 flex justify-between px-4 pt-1 pointer-events-none">
                <span className="text-green-400 font-bold text-sm">SPD</span>
                <span className="text-green-400 font-bold text-sm">NAV</span>
                <span className="text-white font-bold text-sm">AP1</span>
                <span className="text-green-400 font-bold text-sm">ALT</span>
            </div>
        </div>
    );
}
