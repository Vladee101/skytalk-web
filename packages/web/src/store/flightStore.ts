import { create } from 'zustand'; // Fix import
import { validateFlightJson, validateInput } from '@skytalk/core';
import type { FlightLesson } from '@skytalk/core';

// Annex B: Strict States
export type StudentState =
    | 'IDLE'
    | 'LISTENING'
    | 'INPUT_REQUIRED'
    | 'INPUT_NOT_REQUIRED'
    | 'READY_TO_ADVANCE'
    | 'COMPLETED';

export type InputFeedback = 'NONE' | 'CORRECT' | 'ERROR';

interface FlightStore {
    lesson: FlightLesson | null; // Null if no lesson loaded
    currentStepIndex: number;
    currentInputIndex: number; // For multi-input steps
    state: StudentState;

    // UI State
    inputLocked: boolean; // Driven by Spacebar (PTT)
    inputFeedback: InputFeedback;

    // Actions
    loadLesson: (data: unknown) => { success: boolean; error?: string };
    restartLesson: () => void;
    resetLesson: () => void;

    handleSpacebar: (pressed: boolean) => void;
    submitInput: (value: string) => void;
    // PFD State
    pfd: {
        speed: number;
        altitude: number;
        heading: number;
        pitch: number;
        roll: number;
        verticalSpeed: number;
    };
    // Radio State
    radio: {
        com1: string; // e.g. "118.700"
        transponder: string; // e.g. "4721"
    };

    updateSimulation: (dt: number) => void;
    advanceStep: () => void;
}

// Target values for each phase (Defaults)
const PHASE_TARGETS: Record<string, { speed: number; alt: number; pitch: number; vs: number }> = {
    'PREFLIGHT': { speed: 0, alt: 0, pitch: 0, vs: 0 },
    'PUSHBACK': { speed: 5, alt: 0, pitch: 0, vs: 0 },
    'TAXI': { speed: 15, alt: 0, pitch: 0, vs: 0 },
    'LINE-UP': { speed: 0, alt: 0, pitch: 0, vs: 0 },
    'TAKEOFF': { speed: 180, alt: 500, pitch: 15, vs: 2000 },
    'CLIMB': { speed: 250, alt: 5000, pitch: 10, vs: 1500 },
    'ENROUTE': { speed: 280, alt: 35000, pitch: 2, vs: 0 },
    'DESCENT': { speed: 280, alt: 10000, pitch: -1, vs: -1500 },
    'APPROACH': { speed: 180, alt: 3000, pitch: -2, vs: -700 },
    'LANDING': { speed: 140, alt: 0, pitch: 5, vs: -300 },
    'TAXI-IN': { speed: 0, alt: 0, pitch: 0, vs: 0 },
};

// Lerp helper
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

export const useFlightStore = create<FlightStore>((set, get) => {
    // Helper to simulate Tutor speaking time (e.g. 2 seconds) 
    // and then transition to INPUT state.
    const simulateTutorSpeech = (lesson: FlightLesson, stepIndex: number): void => {
        setTimeout(() => {
            const step = lesson.steps[stepIndex];
            if (!step) return;
            // Check required_inputs array. If present and has items > 0, we need input.
            const requiredInputs = step.required_inputs;
            const hasInput = requiredInputs && requiredInputs.length > 0 && (requiredInputs[0]?.type as string) !== 'none';

            set({
                state: hasInput ? 'INPUT_REQUIRED' : 'INPUT_NOT_REQUIRED',
                inputLocked: false
            });
        }, 2000); // 2 second "speaking" time
    };

    return {
        lesson: null,
        currentStepIndex: 0,
        currentInputIndex: 0,
        state: 'IDLE',
        inputLocked: true,
        inputFeedback: 'NONE',

        // PFD Init
        pfd: {
            speed: 0,
            altitude: 0,
            heading: 360,
            pitch: 0,
            roll: 0,
            verticalSpeed: 0,
        },
        radio: {
            com1: '122.800', // Default UNICOM
            transponder: '2000', // Default IFR/VFR
        },

        updateSimulation: (dt: number) => {
            const { lesson, currentStepIndex } = get();
            if (!lesson) return;

            const currentStep = lesson.steps[currentStepIndex];
            if (!currentStep) return;
            const phaseDefaults = PHASE_TARGETS[currentStep.phase] || { speed: 0, alt: 0, pitch: 0, vs: 0 };
            const defaults = { ...phaseDefaults };

            set((state: FlightStore) => {
                // Physics Logic using phase defaults
                const targetSpeed = defaults.speed;
                const newSpeed = lerp(state.pfd.speed, targetSpeed, dt * 0.5);

                // Altitude integration
                let newAlt = state.pfd.altitude + (state.pfd.verticalSpeed / 60) * dt;

                // Ground Physics: Clamp to 0
                if (newAlt < 0) newAlt = 0;

                // Ground Snap
                if (defaults.alt === 0 && defaults.vs === 0) {
                    newAlt = lerp(state.pfd.altitude, 0, dt * 5);
                    if (newAlt < 1) newAlt = 0;
                }

                // Pitch / Roll / VS move towards target
                const newPitch = lerp(state.pfd.pitch, defaults.pitch, dt);
                const newVS = lerp(state.pfd.verticalSpeed, defaults.vs, dt);
                const newRoll = lerp(state.pfd.roll, 0, dt);

                return {
                    pfd: {
                        ...state.pfd,
                        speed: newSpeed,
                        altitude: newAlt,
                        pitch: newPitch,
                        verticalSpeed: newVS,
                        roll: newRoll,
                    }
                };
            });
        },

        loadLesson: (data: unknown) => {
            const result = validateFlightJson(data);
            if (!result.valid) {
                console.error("Schema Validation Failed", result);
                return { success: false, error: 'Invalid flight lesson schema' };
            }

            set({
                lesson: result.lesson,
                currentStepIndex: 0,
                currentInputIndex: 0,
                state: 'LISTENING',
                inputLocked: true,
                inputFeedback: 'NONE',
                // Reset PFD
                pfd: { speed: 0, altitude: 0, heading: 360, pitch: 0, roll: 0, verticalSpeed: 0 },
                radio: { com1: '122.800', transponder: '2000' }
            });

            // Trigger simulation
            simulateTutorSpeech(result.lesson, 0);

            return { success: true };
        },

        restartLesson: () => {
            const { lesson, loadLesson } = get();
            if (lesson) {
                // Re-load the current lesson to reset all state
                loadLesson(lesson);
            }
        },

        resetLesson: () => {
            set({
                lesson: null,
                currentStepIndex: 0,
                currentInputIndex: 0,
                state: 'IDLE',
                inputLocked: true,
                inputFeedback: 'NONE',
                pfd: { speed: 0, altitude: 0, heading: 360, pitch: 0, roll: 0, verticalSpeed: 0 },
                radio: { com1: '122.800', transponder: '2000' }
            });
        },

        handleSpacebar: (pressed: boolean) => {
            const { state } = get();

            if (pressed) {
                set({ inputLocked: true });
            } else {
                if (state === 'INPUT_REQUIRED' || state === 'INPUT_NOT_REQUIRED') {
                    set({ inputLocked: false });
                }
            }
        },

        submitInput: (value: string) => {
            const { state, lesson, currentStepIndex, currentInputIndex } = get();
            if (state !== 'INPUT_REQUIRED' || !lesson) return;

            const currentStep = lesson.steps[currentStepIndex];
            if (!currentStep) return;
            const requiredInputs = currentStep.required_inputs || [];

            // Safety check
            if (currentInputIndex >= requiredInputs.length) return;

            const currentReqInput = requiredInputs[currentInputIndex];
            if (!currentReqInput || (currentReqInput.type as string) === 'none') {
                // If type is none, we shouldn't really be here, but just in case
                return;
            }

            const expected = currentReqInput.value || "";
            const isValid = validateInput(currentReqInput.type, expected, value);

            if (isValid) {
                // UPDATE COCKPIT PARAMETERS
                const type = currentReqInput.type as string;
                set((prev: FlightStore) => {
                    const next = { ...prev };

                    if (type === 'com_frequency') {
                        next.radio = { ...prev.radio, com1: value };
                    } else if (type === 'squawk') {
                        next.radio = { ...prev.radio, transponder: value };
                    } else if (type === 'heading') {
                        const hdg = parseFloat(value);
                        if (!isNaN(hdg)) next.pfd = { ...prev.pfd, heading: hdg };
                    } else if (type === 'altitude') {
                        const alt = parseFloat(value);
                        if (!isNaN(alt)) next.pfd = { ...prev.pfd, altitude: alt };
                    }

                    return next;
                });

                // CHECK PROGRESSION
                const isLastInput = currentInputIndex >= requiredInputs.length - 1;

                if (isLastInput) {
                    set({
                        state: 'READY_TO_ADVANCE',
                        inputFeedback: 'CORRECT',
                        inputLocked: true
                    });
                    setTimeout(() => set({ inputFeedback: 'NONE' }), 2000); // Wait 2s before allowing advance (handled by user, but feedback clear)
                } else {
                    // Move to next input
                    set({
                        currentInputIndex: currentInputIndex + 1,
                        inputFeedback: 'CORRECT',
                        // Keep input unlocked for next entry? Or quick flash?
                        // Let's keep it unlocked but flash green.
                    });
                    // We need the UI to clear the field. 
                    // We can use the 'inputFeedback' state to signal the component to clear it?
                    // Or just rely on the component detecting the index change.

                    setTimeout(() => set({ inputFeedback: 'NONE' }), 1000);
                }

            } else {
                set({ inputFeedback: 'ERROR' });
                setTimeout(() => set({ inputFeedback: 'NONE' }), 1000);
            }
        },

        advanceStep: () => {
            const { state, lesson, currentStepIndex } = get();
            const canAdvance = state === 'READY_TO_ADVANCE' || state === 'INPUT_NOT_REQUIRED';

            if (!canAdvance || !lesson) return;

            const nextIndex = currentStepIndex + 1;
            if (nextIndex >= lesson.steps.length) {
                set({ state: 'COMPLETED', inputLocked: true });
            } else {
                set({
                    currentStepIndex: nextIndex,
                    currentInputIndex: 0, // Reset for next step
                    state: 'LISTENING',
                    inputFeedback: 'NONE',
                    inputLocked: true
                });

                // Trigger simulation for next step
                simulateTutorSpeech(lesson, nextIndex);
            }
        },
    };
});