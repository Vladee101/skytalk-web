import React, { useState } from 'react';
import type { Deck } from '../../types/deck';
import { Flashcard } from './Flashcard';

interface FlashcardSessionProps {
    lesson: Deck;
    onExit: () => void;
}

export const FlashcardSession: React.FC<FlashcardSessionProps> = ({ lesson, onExit }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [showCTA, setShowCTA] = useState(false);
    const [showToggles, setShowToggles] = useState(false);

    const [showCallsign, setShowCallsign] = useState(true);
    const [showRoute, setShowRoute] = useState(false);
    const [showPhase, setShowPhase] = useState(true);
    const [showTranslation, setShowTranslation] = useState(true);

    const steps = lesson.steps;
    const currentStepData = steps[currentStep]!;
    const isLastStep = currentStep === steps.length - 1;

    const handleNext = () => {
        if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
    };

    const handlePrev = () => {
        if (currentStep > 0) setCurrentStep(currentStep - 1);
    };

    const ToggleBtn = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
        <button
            type="button"
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${
                active
                    ? 'bg-sky-600 border-sky-500 text-white'
                    : 'bg-transparent border-slate-600 text-slate-400 hover:border-slate-500'
            }`}
        >
            {label}
        </button>
    );

    if (showCTA) {
        return (
            <div className="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 font-inter text-white">
                <div className="max-w-lg w-full text-center space-y-6">
                    <div className="text-5xl">✈️</div>
                    <h2 className="text-2xl font-bold text-white">Это было превью</h2>
                    <p className="text-slate-300 text-lg">
                        Готов отлетать урок с живым инструктором?
                    </p>
                    <div className="bg-slate-800 rounded-2xl p-6 text-left space-y-3 border border-slate-700">
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-4">Живая версия даёт:</p>
                        <div className="flex items-start gap-3">
                            <span className="text-sky-400 mt-0.5 shrink-0">🎙️</span>
                            <span className="text-slate-200">Реальный голосовой радиообмен с живым инструктором</span>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="text-sky-400 mt-0.5 shrink-0">📻</span>
                            <span className="text-slate-200">Real-time ATC с имитацией радиопомех и эффектами</span>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="text-sky-400 mt-0.5 shrink-0">🖥️</span>
                            <span className="text-slate-200">Настоящий кокпит с PFD, альтиметром и компасом</span>
                        </div>
                    </div>
                    <div className="space-y-3 pt-2">
                        <a
                            href="https://t.me/SkyTalk_Radio"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-center transition-colors"
                        >
                            Telegram: @SkyTalk_Radio
                        </a>
                        <a
                            href="mailto:skytalk101@proton.me"
                            className="block w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-center transition-colors"
                        >
                            skytalk101@proton.me
                        </a>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => { setShowCTA(false); setCurrentStep(0); }}
                            className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors text-sm"
                        >
                            Начать заново
                        </button>
                        <button
                            type="button"
                            onClick={onExit}
                            className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors text-sm"
                        >
                            Выход
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-slate-900 flex flex-col font-inter text-white">

            {/* Top Bar */}
            <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm z-10">
                <div className="flex items-center justify-between px-4 sm:px-8 h-14 sm:h-16">
                    {/* Mobile: gear icon to expand toggles */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="sm:hidden p-2 rounded text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors text-sm"
                            onClick={() => setShowToggles(!showToggles)}
                            aria-label="Настройки подсказок"
                        >
                            ⚙
                        </button>
                        {/* Desktop: toggles inline */}
                        <div className="hidden sm:flex items-center gap-3">
                            <span className="text-xs text-slate-500 uppercase tracking-widest font-bold mr-2">Подсказки:</span>
                            <ToggleBtn label="Callsign" active={showCallsign} onClick={() => setShowCallsign(!showCallsign)} />
                            <ToggleBtn label="Route" active={showRoute} onClick={() => setShowRoute(!showRoute)} />
                            <ToggleBtn label="Phase" active={showPhase} onClick={() => setShowPhase(!showPhase)} />
                            <div className="h-4 w-px bg-slate-700 mx-1" />
                            <ToggleBtn label="RU" active={showTranslation} onClick={() => setShowTranslation(!showTranslation)} />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                        <a
                            href="https://skytalk.website"
                            className="text-slate-500 hover:text-slate-300 transition-colors text-xs font-bold whitespace-nowrap"
                        >
                            skytalk.website
                        </a>
                        <div className="h-4 w-px bg-slate-700" />
                        <h2 className="text-slate-200 font-bold tracking-tight text-sm sm:text-base truncate max-w-[100px] xs:max-w-[140px] sm:max-w-none">
                            {lesson.lesson.name}
                        </h2>
                        {/* Persistent CTA — desktop only */}
                        <a
                            href="https://t.me/SkyTalk_Radio"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:block px-3 py-1.5 rounded-lg bg-sky-600/20 border border-sky-600/50 text-sky-400 hover:bg-sky-600/30 transition-colors text-xs font-bold whitespace-nowrap"
                        >
                            Живой урок →
                        </a>
                        <div className="h-4 w-px bg-slate-700 hidden sm:block" />
                        <button
                            type="button"
                            onClick={onExit}
                            className="text-slate-400 hover:text-white transition-colors text-sm font-bold whitespace-nowrap"
                        >
                            Выход
                        </button>
                    </div>
                </div>

                {/* Mobile toggles dropdown */}
                {showToggles && (
                    <div className="sm:hidden px-4 pb-3 pt-3 flex flex-wrap gap-2 border-t border-slate-800">
                        <span className="text-xs text-slate-500 uppercase tracking-widest font-bold w-full mb-1">Подсказки:</span>
                        <ToggleBtn label="Callsign" active={showCallsign} onClick={() => setShowCallsign(!showCallsign)} />
                        <ToggleBtn label="Route" active={showRoute} onClick={() => setShowRoute(!showRoute)} />
                        <ToggleBtn label="Phase" active={showPhase} onClick={() => setShowPhase(!showPhase)} />
                        <ToggleBtn label="RU" active={showTranslation} onClick={() => setShowTranslation(!showTranslation)} />
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-grow flex flex-col items-center justify-center p-4 sm:p-8 bg-gradient-to-b from-slate-900 to-slate-950">
                <Flashcard
                    key={currentStep}
                    atcText={currentStepData.atc}
                    readbackText={currentStepData.expected_readback}
                    atcTranslation={currentStepData.atc_translation_ru}
                    readbackTranslation={currentStepData.readback_translation_ru}
                    showCallsign={showCallsign}
                    showRoute={showRoute}
                    showPhase={showPhase}
                    showTranslation={showTranslation}
                    callsign={lesson.lesson.callsign}
                    phase={currentStepData.phase}
                    route={lesson.lesson.route}
                    stepIndex={currentStep}
                    totalSteps={steps.length}
                    onNext={handleNext}
                    onPrev={handlePrev}
                />

                {/* CTA trigger on last card */}
                {isLastStep && (
                    <button
                        type="button"
                        onClick={() => setShowCTA(true)}
                        className="mt-6 px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm transition-colors"
                    >
                        Завершить урок — хочу узнать о живой версии →
                    </button>
                )}
            </div>

        </div>
    );
};
