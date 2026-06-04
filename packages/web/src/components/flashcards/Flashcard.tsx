import React, { useState } from 'react';

interface FlashcardProps {
    atcText: string;
    readbackText: string;
    atcTranslation?: string | undefined;
    readbackTranslation?: string | undefined;
    showCallsign: boolean;
    showRoute: boolean;
    showPhase: boolean;
    showTranslation: boolean;

    callsign: string;
    phase: string;
    route: string;

    stepIndex: number;
    totalSteps: number;
    onNext: () => void;
    onPrev: () => void;
}

export const Flashcard: React.FC<FlashcardProps> = ({
    atcText, readbackText, atcTranslation, readbackTranslation,
    showCallsign, showRoute, showPhase, showTranslation,
    callsign, phase, route,
    stepIndex, totalSteps, onNext, onPrev
}) => {
    const [isFlipped, setIsFlipped] = useState(false);

    return (
        <div className="flex flex-col items-center w-full max-w-2xl mx-auto h-[380px] sm:h-[450px] md:h-[540px]">

            {/* Card Container */}
            <div
                className="w-full flex-grow relative perspective-1000 cursor-pointer group"
                onClick={() => setIsFlipped(!isFlipped)}
            >
                <div
                    className={`w-full h-full relative transition-all duration-500 transform-style-3d shadow-2xl rounded-2xl ${isFlipped ? 'rotate-y-180' : ''}`}
                >

                    {/* FRONT (ATC) */}
                    <div className="absolute inset-0 w-full h-full bg-slate-800 border border-slate-700 rounded-2xl p-4 sm:p-8 flex flex-col backface-hidden">
                        {/* Header / Context */}
                        <div className="flex justify-between items-start mb-3 sm:mb-6 opacity-70 shrink-0">
                            <div className="flex gap-2 flex-wrap">
                                {showPhase && (
                                    <span className="px-2 py-1 bg-slate-700 rounded text-xs text-sky-400 font-mono tracking-wider">
                                        {phase}
                                    </span>
                                )}
                                {showRoute && (
                                    <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300 font-mono">
                                        {route}
                                    </span>
                                )}
                            </div>
                            <div className="text-slate-500 text-xs uppercase tracking-widest font-bold self-center">ДИСПЕТЧЕР</div>
                            <div className="text-right shrink-0 ml-2">
                                <span className="text-xs text-slate-500 font-bold">Карточка {stepIndex + 1} / {totalSteps}</span>
                                {showCallsign && (
                                    <div className="text-sm text-green-400 font-mono mt-1">{callsign}</div>
                                )}
                            </div>
                        </div>

                        {/* Content — min-h-0 lets it shrink; overflow-y-auto handles very long text */}
                        <div className="flex-grow min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center space-y-3 sm:space-y-5">
                            <div className="text-base sm:text-xl font-medium text-white leading-relaxed">
                                "{atcText}"
                            </div>
                            {showTranslation && atcTranslation && (
                                <div className="text-sm sm:text-base text-emerald-400 font-cyrillic italic border-t border-slate-700 pt-3 w-full">
                                    "{atcTranslation}"
                                </div>
                            )}
                        </div>

                        {/* Footer Prompt */}
                        <div className="shrink-0 mt-2 text-center text-slate-600 text-xs sm:text-sm animate-pulse">
                            Нажмите чтобы увидеть Ответ
                        </div>
                    </div>

                    {/* BACK (PILOT) */}
                    <div className="absolute inset-0 w-full h-full bg-slate-100 rounded-2xl p-4 sm:p-8 flex flex-col backface-hidden rotate-y-180">
                        {/* Header */}
                        <div className="flex justify-between items-center mb-3 sm:mb-6 border-b border-slate-300 pb-3 shrink-0">
                            <span className="text-slate-400 text-sm font-bold">Верный Ответ</span>
                            <span className="text-blue-600 text-xs uppercase tracking-widest font-bold">ПИЛОТ</span>
                            <span className="text-xs text-slate-400 font-bold">Карточка {stepIndex + 1} / {totalSteps}</span>
                        </div>

                        {/* Content */}
                        <div className="flex-grow min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center space-y-3 sm:space-y-5">
                            <div className="text-base sm:text-xl font-medium text-slate-800 leading-relaxed font-mono">
                                "{readbackText}"
                            </div>
                            {showTranslation && readbackTranslation && (
                                <div className="text-sm sm:text-base text-emerald-600 font-cyrillic italic border-t border-slate-200 pt-3 w-full">
                                    "{readbackTranslation}"
                                </div>
                            )}
                        </div>

                        {/* Footer Prompt */}
                        <div className="shrink-0 mt-2 text-center text-slate-400 text-xs sm:text-sm">
                            Нажмите чтобы увидеть Промпт
                        </div>
                    </div>

                </div>
            </div>

            {/* Navigation Controls */}
            <div className="flex items-center gap-6 sm:gap-8 mt-6 sm:mt-8">
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setIsFlipped(false); onPrev(); }}
                    disabled={stepIndex === 0}
                    className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-full bg-slate-800 text-white hover:bg-sky-600 disabled:opacity-30 disabled:hover:bg-slate-800 transition-colors font-bold flex items-center gap-2 text-sm sm:text-base"
                >
                    ← Prev
                </button>

                <div className="text-slate-500 font-mono text-sm">
                    {stepIndex + 1} of {totalSteps}
                </div>

                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setIsFlipped(false); onNext(); }}
                    disabled={stepIndex === totalSteps - 1}
                    className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-full bg-slate-800 text-white hover:bg-sky-600 disabled:opacity-30 disabled:hover:bg-slate-800 transition-colors font-bold flex items-center gap-2 text-sm sm:text-base"
                >
                    Next →
                </button>
            </div>

        </div>
    );
};
